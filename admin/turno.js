import { supabase, ensureSupabase } from '../database.js';

let dataRender = []; // Cache of waiting list turns for reordering
let enAtencionCache = []; // Cache de turnos en atención para validaciones rápidas
let turnoEnAtencionActual = null; // Variable Global de Estado Maestro
let HORA_APERTURA = "08:00";
let HORA_LIMITE_TURNOS = "23:00";
let LIMITE_TURNOS = 50;
let ALLOWED_DAYS = [1, 2, 3, 4, 5, 6];
let activeTurnIntervals = {};
let serviciosCache = {};
let isRefreshing = false; // Bandera para evitar ejecuciones simultáneas
let citasHoy = [];
let citasFuturas = [];
let barberosMap = {};
let clientesMap = {};
let barberosActivosList = []; // Cache para lógica de disponibilidad
let __pushSubsCount = 0;

/**
 * Obtiene el ID del negocio desde el atributo `data-negocio-id` en el body.
 * @returns {string|null} El ID del negocio o null si no está presente.
 */



function getNegocioId() {
    const id = document.body.dataset.negocioId;
    if (!id) {
        console.error('Error crítico: Atributo data-negocio-id no encontrado en el body.');
        alert('Error de configuración: No se pudo identificar el negocio.');
    }
    return id;
}

const negocioId = getNegocioId();

// CONSTANTES DE ESTADO CENTRALIZADAS
const ESTADOS = {
    ESPERA: 'En espera',
    ATENCION: 'En atención',
    ATENDIDO: 'Atendido',
    CANCELADO: 'Cancelado',
    DEVUELTO: 'Devuelto',
    CITA_PROGRAMADA: 'Programada',
    CITA_CANCELADA: 'Cancelada',
    CITA_ATENDIDA: 'Atendida'
};

// --- MÁQUINA DE ESTADOS CENTRALIZADA ---
async function cambiarEstadoTurno(turnoId, nuevoEstado, extraData = {}) {
    if (!turnoId) {
        mostrarNotificacion("ID de turno inválido", "error");
        return false;
    }

    const updateData = {
        estado: nuevoEstado,
        ...extraData
    };

    try {
        const { error } = await supabase
            .from("turnos")
            .update(updateData)
            .eq("id", turnoId);

        if (error) throw error;

        mostrarNotificacion(`Turno actualizado a: ${nuevoEstado}`, "success");
        refrescarUI(); // Actualizar toda la interfaz
        return true;
    } catch (error) {
        console.error("Error cambiando estado:", error);
        mostrarNotificacion("Error al actualizar el turno: " + error.message, "error");
        return false;
    }
}

/**
 * Obtiene el siguiente turno en espera de forma segura.
 * Reemplaza a la variable global propensa a errores 'turnoActual'.
 */
function getSiguienteTurno() {
    return dataRender.find(t => t.estado === ESTADOS.ESPERA) || null;
}

function iniciarTimerParaTurno(turno) {
    const timerEl = document.getElementById(`timer-${turno.id}`);
    const duracionMin = (serviciosCache && serviciosCache[turno.servicio]) ? Number(serviciosCache[turno.servicio]) : 30; // fallback 30 min

    if (!timerEl) return;

    // Fallback robusto para start: si no hay started_at aún (race), usa created_at o ahora
    let startTs = null;
    if (turno.started_at) {
        const d = new Date(turno.started_at);
        if (!isNaN(d)) startTs = d.getTime();
    }
    if (!startTs && turno.created_at) {
        const d2 = new Date(turno.created_at);
        if (!isNaN(d2)) startTs = d2.getTime();
    }
    if (!startTs) startTs = Date.now();

    const endTime = startTs + duracionMin * 60 * 1000;

    const updateTimer = () => {
        const ahora = Date.now();
        const restanteMs = Math.max(0, endTime - ahora);

        const minutos = Math.floor(restanteMs / 60000);
        const segundos = Math.floor((restanteMs % 60000) / 1000);
        timerEl.textContent = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

        if (restanteMs === 0) {
            if (activeTurnIntervals[turno.id]) {
                clearInterval(activeTurnIntervals[turno.id]);
                delete activeTurnIntervals[turno.id];
            }
        }
    };

    // Reset si ya había uno
    if (activeTurnIntervals[turno.id]) {
        clearInterval(activeTurnIntervals[turno.id]);
        delete activeTurnIntervals[turno.id];
    }

    updateTimer();
    activeTurnIntervals[turno.id] = setInterval(updateTimer, 1000);
}

let __refreshTimer = null;
let refreshTimeout = null;
function safeRefresh() {
    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(() => {
        refrescarUI();
    }, 300);
}
function refrescarUI() {
    // Si ya se está ejecutando una carga, o hay un timer pendiente, controlamos la saturación
    if (__refreshTimer) return;
    
    __refreshTimer = setTimeout(async () => {
        if (isRefreshing) {
            // Si ya está cargando datos, reprogramamos el intento para después
            __refreshTimer = null;
            refrescarUI(); 
            return;
        }
        
        isRefreshing = true;
        try {
            await Promise.all([
                cargarClientesMap(),
                cargarTurnos()
            ]);
        } catch (error) {
            console.error("Error en refrescarUI:", error);
        } finally {
            isRefreshing = false;
            __refreshTimer = null;
        }
    }, 500); // Aumentado a 500ms para mayor estabilidad
}

async function cargarServicios() {
    if (!negocioId) {
        console.warn("No se pudo obtener el negocioId, no se cargarán los servicios.");
        return;
    }
    try {
        const { data, error } = await supabase
            .from('servicios')
            .select('nombre,duracion_min')
            .eq('negocio_id', negocioId)
            .eq('activo', true);
        if (error) throw error;
        serviciosCache = {};
        (data || []).forEach(s => { serviciosCache[s.nombre] = s.duracion_min; });
        const sel = document.getElementById('servicio');
        if (sel && data && data.length) {
            sel.innerHTML = '<option value="">Seleccione un servicio</option>' +
                data.map(s => `<option value="${s.nombre}">${s.nombre}</option>`).join('');
        }
    } catch (e) {
        console.error('Error crítico al cargar servicios:', e);
    }
}

async function cargarHoraLimite() {
    if (!negocioId) return;
    try {
        const { data } = await supabase
            .from('configuracion_negocio')
            .select('hora_apertura, hora_cierre, limite_turnos, dias_operacion')
            .eq('negocio_id', negocioId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (data) {
            if (data.hora_apertura) HORA_APERTURA = data.hora_apertura;
            if (data.hora_cierre) HORA_LIMITE_TURNOS = data.hora_cierre;
            if (typeof data.limite_turnos === 'number') LIMITE_TURNOS = data.limite_turnos;
            if (Array.isArray(data.dias_operacion)) ALLOWED_DAYS = data.dias_operacion.map(n => Number(n)).filter(n => !Number.isNaN(n));
        }
    } catch (e) {
        console.warn('No se pudo cargar horario, usando valores por defecto.', e);
    }
}

async function cargarBarberosMap() {
    const { data } = await supabase
        .from('barberos')
        .select('id,nombre,usuario,activo')
        .eq('negocio_id', negocioId);
    barberosMap = {};
    barberosActivosList = [];
    (data || []).forEach(b => { 
        barberosMap[b.id] = b.nombre || b.usuario; 
        if(b.activo) barberosActivosList.push(b);
    });
}

async function cargarClientesMap() {
    if (!negocioId) return;
    try {
        const { data } = await supabase
            .from('clientes')
            .select('telefono, nombre')
            .eq('negocio_id', negocioId);
        clientesMap = {};
        (data || []).forEach(c => { if (c.telefono) clientesMap[c.telefono] = c.nombre; });
    } catch (e) {
        console.warn('Error cargando mapa de clientes:', e);
    }
}

async function cargarPushSubsCount() {
    try {
        const { count } = await supabase
            .from('push_subscriptions')
            .select('*', { count: 'exact', head: true })
            .eq('negocio_id', negocioId);
        __pushSubsCount = count || 0;
    } catch (e) {
        __pushSubsCount = 0;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await ensureSupabase();
    if (!negocioId) return;
    initThemeToggle();
    actualizarFechaHora();
    setInterval(actualizarFechaHora, 60000);
    await cargarHoraLimite();
    await cargarServicios();
    await cargarBarberosMap();
    await cargarClientesMap();
    await cargarPushSubsCount();
    refrescarUI();
    document.getElementById('refrescar-turnos')?.addEventListener('click', () => {
        refrescarUI();
        mostrarNotificacion('Turnos actualizados', 'success');
    });
    setupSidebar();

    const listaEspera = document.getElementById('listaEspera');
    if (listaEspera) {
        listaEspera.addEventListener('dblclick', handleDoubleClickDelete);
        listaEspera.addEventListener('dragstart', handleDragStart);
        listaEspera.addEventListener('dragover', handleDragOver);
        listaEspera.addEventListener('drop', handleDrop);
        listaEspera.addEventListener('dragend', handleDragEnd);
    }
    document.getElementById('listaAtencion')?.addEventListener('click', (e) => {
        const card = e.target.closest('.turn-card-atencion');
        if (card && card.dataset.id) {
            abrirModalPago(card.dataset.id);
        }
    });
    document.getElementById('formPago')?.addEventListener('submit', guardarPago);
    suscribirseTurnos();
    suscribirseCitas();
    // Suscripción a cambios de push_subscriptions para mantener el conteo actualizado
    supabase
        .channel(`push-subs-${negocioId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'push_subscriptions', filter: `negocio_id=eq.${negocioId}` },
            async () => { await cargarPushSubsCount(); }
        )
        .subscribe();
    iniciarActualizadorMinutos();
    supabase
        .channel('config-turno-admin')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'configuracion_negocio', filter: `negocio_id=eq.${negocioId}` },
            async () => {
                await cargarHoraLimite();
                refrescarUI();
            }
        )
        .subscribe();

    // Event Listeners para botones (Arquitectura SaaS)
    document.getElementById('btnDevolver')?.addEventListener('click', devolverTurno);
    document.getElementById('btnAtender')?.addEventListener('click', atenderAhora);
    document.getElementById('btnTomarTurnoManual')?.addEventListener('click', abrirModal);
    document.getElementById('formTurno')?.addEventListener('submit', tomarTurno);

    // 5. Limpieza de canales al salir (Evitar fugas de memoria)
    window.addEventListener('beforeunload', () => {
        supabase.removeAllChannels();
    });
});

function setupSidebar() {
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const closeSidebar = document.getElementById('closeSidebar');
    const sidebarTexts = document.querySelectorAll('.sidebar-text');

    if (!sidebar) return;

    const toggleMobile = () => {
        sidebar.classList.toggle('-translate-x-full');
        if (overlay) {
            overlay.classList.toggle('opacity-0');
            overlay.classList.toggle('pointer-events-none');
        }
    };

    const toggleDesktop = () => {
        sidebar.classList.toggle('w-64');
        sidebar.classList.toggle('w-20');
        sidebarTexts.forEach(t => t.classList.toggle('hidden'));
    };

    if (mobileMenuButton) mobileMenuButton.addEventListener('click', toggleMobile);
    if (overlay) overlay.addEventListener('click', toggleMobile);
    if (closeSidebar) closeSidebar.addEventListener('click', toggleMobile);
    if (toggleBtn) toggleBtn.addEventListener('click', toggleDesktop);
}

let draggedItem = null;

function handleDragStart(event) {
    const target = event.target.closest('.turn-card-espera');
    if (!target) {
        event.preventDefault();
        return;
    }
    draggedItem = target;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', target.dataset.id);
    setTimeout(() => {
        draggedItem.classList.add('opacity-50');
    }, 0);
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target = event.target.closest('.turn-card-espera');
    if (target && target !== draggedItem) {
        const container = target.parentNode;
        const rect = target.getBoundingClientRect();
        const isAfter = event.clientY > rect.top + rect.height / 2;
        if (isAfter) {
            container.insertBefore(draggedItem, target.nextSibling);
        } else {
            container.insertBefore(draggedItem, target);
        }
    }
}

async function handleDrop(event) {
    event.preventDefault();
    if (!draggedItem) return;

    const item = draggedItem;
    item.classList.remove('opacity-50');
    draggedItem = null; // Limpiar referencia global inmediatamente

    const container = document.getElementById('listaEspera');
    const cards = Array.from(container.querySelectorAll('.turn-card-espera'));
    
    // Guardar estado anterior para rollback en caso de error
    const previousDataRender = [...dataRender];

    const turnUpdates = cards.map((card, index) => ({
        id: card.dataset.id,
        orden: index
    }));

    // Actualización Optimista de la UI (Optimistic UI Update)
    dataRender = turnUpdates.map(update => {
        const originalTurn = previousDataRender.find(t => t.id == update.id);
        return originalTurn ? { ...originalTurn, orden: update.orden } : null;
    }).filter(Boolean).sort((a, b) => a.orden - b.orden);

    try {
        // 1. Verificar sesión antes de escribir
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) {
            throw new Error('AUTH_JWT_EXPIRED');
        }

        // 2. Ejecutar actualización atómica vía RPC
        const { error: rpcError } = await supabase.rpc('reordenar_turnos', {
            updates: turnUpdates
        });
        
        if (rpcError) {
            throw rpcError;
        }

        mostrarNotificacion('Turnos reordenados con éxito.', 'success');
    } catch (error) {
        console.error('Error al reordenar turnos:', error);
        
        // Revertir estado local (Rollback)
        dataRender = previousDataRender;
        
        // Manejo específico de errores de autenticación
        if (error.message === 'AUTH_JWT_EXPIRED' || (error.message && error.message.includes('JWT'))) {
            mostrarNotificacion('Tu sesión ha expirado. Recargando...', 'error');
            setTimeout(() => window.location.reload(), 1500);
        } else {
            mostrarNotificacion('No se pudo guardar el orden. Revertiendo...', 'error');
            await refrescarUI(); // Sincronizar con servidor
        }
    }
}

function handleDragEnd(event) {
    if (draggedItem) {
        draggedItem.classList.remove('opacity-50');
        draggedItem = null;
    }
}


function initThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    const htmlElement = document.documentElement;
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        htmlElement.classList.add('dark');
    } else {
        htmlElement.classList.remove('dark');
    }
    themeToggle?.addEventListener('click', () => {
        htmlElement.classList.toggle('dark');
        const isDark = htmlElement.classList.contains('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });
}

let __elapsedTimer = null;
function iniciarActualizadorMinutos() {
    if (__elapsedTimer) clearInterval(__elapsedTimer);
    actualizarMinuteros();
    __elapsedTimer = setInterval(actualizarMinuteros, 30000);
}

function actualizarMinuteros() {
    try {
        const spans = document.querySelectorAll('.esperando-min');
        const ahora = Date.now();
        spans.forEach(sp => {
            const iso = sp.getAttribute('data-creado-iso');
            if (!iso) return;
            const t = new Date(iso);
            const mins = Math.max(0, Math.floor((ahora - t.getTime()) / 60000));
            sp.textContent = String(mins);
        });
        const tEst = document.getElementById('tiempo-estimado');
        if (tEst && tEst.dataset && tEst.dataset.startedIso) {
            const inicio = new Date(tEst.dataset.startedIso);
            if (!isNaN(inicio)) {
                const trans = Math.max(0, Math.floor((Date.now() - inicio.getTime()) / 60000));
                tEst.textContent = `En atención · ${trans} min`;
            }
        }
    } catch (e) {
        console.warn('Error actualizando minuteros', e);
    }
}

function actualizarFechaHora() {
    const ahora = new Date();
    const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const fechaFormateada = ahora.toLocaleDateString('es-ES', opciones);
    const horaFormateada = ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const letraHoy = obtenerLetraDelDia();
    document.getElementById('fecha-actual').innerHTML = `${fechaFormateada.charAt(0).toUpperCase() + fechaFormateada.slice(1)} <span class="text-blue-600 dark:text-blue-400 font-bold">(Serie ${letraHoy})</span>`;
    document.getElementById('hora-actual').textContent = horaFormateada;
}

function getDiaOperacionIndex(date = new Date()) {
    return date.getDay();
}

function esDiaOperativo(date = new Date()) {
    const idx = getDiaOperacionIndex(date);
    if (!Array.isArray(ALLOWED_DAYS) || ALLOWED_DAYS.length === 0) return true;
    return ALLOWED_DAYS.includes(idx);
}

async function tomarTurno(event) {
    event.preventDefault();
    
    // 3️⃣ Seguridad al Insertar Turno
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        mostrarNotificacion("Sesión expirada", "error");
        return;
    }

    await cargarHoraLimite();
    if (!esDiaOperativo(new Date())) {
        mostrarNotificacion('Hoy no es un día operacional.', 'error');
        return;
    }
    
    // 4. Comparación de horas robusta (Minutos del día)
    const ahora = new Date();
    const minutosActuales = ahora.getHours() * 60 + ahora.getMinutes();
    const [hAp, mAp] = HORA_APERTURA.split(':').map(Number);
    const minutosApertura = hAp * 60 + mAp;
    const [hCi, mCi] = HORA_LIMITE_TURNOS.split(':').map(Number);
    const minutosCierre = hCi * 60 + mCi;

    const horaStr = ahora.toLocaleTimeString('es-ES', { hour12: false });
    
    if (minutosActuales < minutosApertura) {
        mostrarNotificacion(`Aún no hemos abierto. Horario: ${HORA_APERTURA} - ${HORA_LIMITE_TURNOS}`, 'error');
        return;
    }
    if (minutosActuales >= minutosCierre) {
        mostrarNotificacion('Ya no se pueden tomar turnos a esta hora. Intenta mañana.', 'warning');
        return;
    }
    const nombre = document.getElementById('nombre').value.trim();
    const telefono = document.getElementById('telefono').value.trim();
    if (!nombre || !/^[A-Za-zÁÉÍÓÚáéíóúÑñ ]{2,40}$/.test(nombre)) {
        mostrarNotificacion('El nombre solo debe contener letras y espacios (2 a 40 caracteres).', 'error');
        return;
    }
    if (!/^\d{8,15}$/.test(telefono)) {
        mostrarNotificacion('El teléfono debe contener solo números (8 a 15 dígitos).', 'error');
        return;
    }
    const servicio = document.getElementById('servicio').value;
    
    // --- MEJORA DE LÓGICA: Verificar si hay tiempo antes de la próxima cita ---
    // Esto evita que un turno manual se tome justo antes de una cita, creando retrasos.
    const duracionServicio = serviciosCache[servicio] || 30;
    const asignacion = obtenerBarberoSugerido(duracionServicio);
    
    if (!asignacion) {
        // Si no hay barbero sugerido, significa que todos están ocupados o tienen citas próximas
        // Verificamos si es por citas
        const hayCitasProximas = citasHoy.some(c => {
            const start = new Date(c.start_at);
            const diffMin = (start - new Date()) / 60000;
            return diffMin > 0 && diffMin < duracionServicio + 10; // 10 min buffer
        });
        
        if (hayCitasProximas) {
            const confirmar = await Swal.fire({
                title: '⚠️ Agenda apretada',
                text: 'Hay citas programadas próximamente y este servicio podría causar retrasos. ¿Registrar de todos modos?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Sí, registrar',
                cancelButtonText: 'Cancelar'
            });
            if (!confirmar.isConfirmed) return;
        }
    }
    // -----------------------------------------------------------------------

    const fechaHoy = new Date().toISOString().slice(0, 10);
    
    // 1. Eliminado cálculo manual de 'orden' para evitar Race Condition.
    // Se delega al trigger de base de datos 'trg_set_turno_orden'.

    const { count: totalHoy, error: countError } = await supabase
        .from('turnos')
        .select('id', { count: 'exact', head: true })
        .eq('negocio_id', negocioId)
        .eq('fecha', fechaHoy);
    if (countError) {
        mostrarNotificacion('No se pudo validar el límite de turnos.', 'error');
        return;
    }
    if ((totalHoy || 0) >= LIMITE_TURNOS) {
        mostrarNotificacion(`Se alcanzó el límite de ${LIMITE_TURNOS} turnos para hoy.`, 'warning');
        return;
    }
    const turnoGenerado = await generarNuevoTurno();
    let nuevoTurno = turnoGenerado;
    
    // 2. Reemplazo de while(true) por for loop seguro
    let turnoUnico = false;
    for (let i = 0; i < 10; i++) {
            const hoyCheck = new Date().toISOString().slice(0, 10);
            const { data: existe } = await supabase
                .from('turnos')
                .select('id')
                .eq('negocio_id', negocioId)
                .eq('fecha', hoyCheck)
                .eq('turno', nuevoTurno)
                .limit(1);
            
            if (!existe || !existe.length) {
                turnoUnico = true;
                break;
            }
            const num = parseInt(nuevoTurno.substring(1) || '0', 10) + 1;
            nuevoTurno = nuevoTurno[0] + String(num).padStart(2, '0');
    }
    if (!turnoUnico) {
        mostrarNotificacion('Error al generar ID de turno único. Intente nuevamente.', 'error');
        return;
    }

    const hoy = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from('turnos').insert([{
        negocio_id: negocioId,
        turno: nuevoTurno,
        nombre: nombre,
        telefono: telefono,
        servicio: servicio,
        estado: ESTADOS.ESPERA,
        hora: horaStr, // Se mantiene hora string para visualización
        fecha: hoy
        // orden: OMITIDO - El trigger DB lo asignará atómicamente
    }]);
    if (error) {
        mostrarNotificacion('Error al guardar turno: ' + error.message, 'error');
        console.error(error);
        return;
    }
    cerrarModal();
    mostrarNotificacion(`Turno ${nuevoTurno} registrado para ${nombre}`, 'success');
    
    // Notificar al cliente que su turno fue tomado
    await notificarTurnoTomado(telefono, nombre, nuevoTurno);
    
    refrescarUI();
}

async function calcularTiempoEstimadoTotal(turnoObjetivo = null) {
    // --- CÁLCULO INTELIGENTE DE TIEMPO (Lógica Oficial TurnoRD) ---
    const hoy = new Date().toISOString().slice(0, 10);
    const ahora = new Date();
    
    // 1. Obtener datos frescos (Snapshot del estado actual)
    let enAtencion = [];
    let cola = [];
    
    try {
        const resAtencion = await supabase
            .from('turnos')
            .select('barber_id, servicio, started_at')
            .eq('negocio_id', negocioId)
            .eq('fecha', hoy)
            .eq('estado', ESTADOS.ATENCION);
        enAtencion = resAtencion.data || [];

        const resCola = await supabase
            .from('turnos')
            .select('turno, servicio')
            .eq('negocio_id', negocioId)
            .eq('estado', ESTADOS.ESPERA)
            .order('orden', { ascending: true })
            .order('created_at', { ascending: true });
        cola = resCola.data || [];
    } catch (e) {
        console.warn('Error fetching data for estimation:', e);
        return 0;
    }

    let tiempoTotalPendiente = 0;

    // PASO 1: Calcular tiempo restante real de turnos en atención
    enAtencion.forEach(t => {
        const duracion = serviciosCache[t.servicio] || 30;
        const inicio = t.started_at ? new Date(t.started_at) : new Date();
        const transcurrido = (Date.now() - inicio.getTime()) / 60000;
        const restante = Math.max(0, duracion - transcurrido);
        tiempoTotalPendiente += restante;
    });

    // PASO 2: Sumar duración de turnos en espera
    // Si buscamos para un turno específico, solo sumamos los que están antes
    let colaFiltrada = cola;
    if (turnoObjetivo) {
        const index = cola.findIndex(t => t.turno === turnoObjetivo);
        if (index !== -1) {
            colaFiltrada = cola.slice(0, index);
        } else {
            // Si el turno no está en espera (quizás ya en atención), retornamos 0 o lógica especial
            // Asumimos que si se llama esta función es para un turno en espera o nuevo
        }
    }

    colaFiltrada.forEach(t => {
        const duracion = serviciosCache[t.servicio] || 30;
        tiempoTotalPendiente += duracion;
    });

    // PASO 3: Dividir entre barberos activos
    const barberosActivos = Math.max(1, barberosActivosList.length);
    const tiempoEstimado = tiempoTotalPendiente / barberosActivos;

    return Math.ceil(tiempoEstimado);
}

function obtenerLetraDelDia() {
    const hoy = new Date();
    const fechaBase = new Date('2024-08-23');
    const diferenciaDias = Math.floor((hoy - fechaBase) / (1000 * 60 * 60 * 24));
    const indiceDia = diferenciaDias % 26;
    const letra = String.fromCharCode(65 + Math.abs(indiceDia));
    return letra;
}

async function generarNuevoTurno() {
    const letraHoy = obtenerLetraDelDia();
    const fechaHoy = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
        .from('turnos')
        .select('turno')
        .eq('negocio_id', negocioId)
        .eq('fecha', fechaHoy)
        .like('turno', `${letraHoy}%`)
        .order('created_at', { ascending: false })
        .limit(1);
    if (error) {
        console.error('Error al generar turno:', error.message);
        return `${letraHoy}01`;
    }
    if (!data || data.length === 0 || !data[0].turno) {
        return `${letraHoy}01`;
    }
    const ultimo = data[0].turno;
    const numero = parseInt(ultimo.substring(1)) + 1;
    const nuevoTurno = `${letraHoy}${numero.toString().padStart(2, '0')}`;
    return nuevoTurno;
}

async function cargarTurnos() {
    // 8. Limpieza al recargar turnos
    if (__elapsedTimer) clearInterval(__elapsedTimer);
    iniciarActualizadorMinutos();

    const hoy = new Date().toISOString().slice(0, 10);
    
    // Carga de datos
    // Robustez: Fallback si faltan columnas (started_at, orden) o tabla citas
    let enAtencion = [];
    try {
        const resAtencion = await supabase
            .from('turnos')
            .select('*')
            .eq('estado', ESTADOS.ATENCION)
            .eq('negocio_id', negocioId)
            .eq('fecha', hoy)
            .order('started_at', { ascending: true });
        
        if (resAtencion.error) throw resAtencion.error;
        enAtencionCache = resAtencion.data || []; // Actualizar cache global
        enAtencion = enAtencionCache;
    } catch (e) {
        // Fallback sin ordenar por started_at
        const resAtencionFallback = await supabase
            .from('turnos')
            .select('*')
            .eq('estado', ESTADOS.ATENCION)
            .eq('negocio_id', negocioId)
            .eq('fecha', hoy);
        enAtencionCache = resAtencionFallback.data || [];
        enAtencion = enAtencionCache;
    }

    // Actualizar estado maestro
    turnoEnAtencionActual = enAtencion.length > 0 ? enAtencion[0] : null;

    // --- CÁLCULO DE INGRESOS HOY ---
    const { data: atendidosHoy } = await supabase
        .from('turnos')
        .select('monto_cobrado')
        .eq('negocio_id', negocioId)
        .eq('fecha', hoy)
        .eq('estado', ESTADOS.ATENDIDO);
    const totalIngresos = atendidosHoy?.reduce((sum, t) => sum + (t.monto_cobrado || 0), 0) || 0;
    const indicadorIngresos = document.getElementById('total-ingresos-hoy');
    if (indicadorIngresos) indicadorIngresos.textContent = `RD$ ${totalIngresos.toLocaleString('es-DO', {minimumFractionDigits: 2})}`;

    let data = [], error = null;
    try {
        const resEspera = await supabase
            .from('turnos')
            .select('*')
            .eq('estado', ESTADOS.ESPERA)
            .eq('negocio_id', negocioId)
            .eq('fecha', hoy)
            .order('orden', { ascending: true })
            .order('created_at', { ascending: true });
        
        if (resEspera.error) throw resEspera.error;
        data = resEspera.data || [];
    } catch (e) {
        console.warn('Fallo carga ordenada (posible falta de columna "orden"), reintentando simple...', e);
        const resEsperaFallback = await supabase
            .from('turnos')
            .select('*')
            .eq('estado', ESTADOS.ESPERA)
            .eq('negocio_id', negocioId)
            .eq('fecha', hoy)
            .order('created_at', { ascending: true });
        
        data = resEsperaFallback.data || [];
        error = resEsperaFallback.error;
    }

    if (error) {
        mostrarNotificacion('Error al cargar turnos', 'error');
        return;
    }

    const inicioHoy = new Date();
    inicioHoy.setHours(0,0,0,0);
    const finHoy = new Date();
    finHoy.setHours(23,59,59,999);
    
    let citasDia = [], citasRes = [];
    try {
        const resCitas = await supabase
            .from('citas')
            .select('*')
            .eq('negocio_id', negocioId)
            .gte('start_at', inicioHoy.toISOString())
            .lte('start_at', finHoy.toISOString())
            .order('start_at', { ascending: true });
        
        if (resCitas.error) throw resCitas.error;
        citasDia = resCitas.data || [];

        const resCitasFut = await supabase
            .from('citas')
            .select('*')
            .eq('negocio_id', negocioId)
            .gt('start_at', finHoy.toISOString())
            .order('start_at', { ascending: true });
        
        if (resCitasFut.error) throw resCitasFut.error;
        citasRes = resCitasFut.data || [];
    } catch (e) {
        console.warn('No se pudo cargar citas (tabla inexistente o error):', e);
    }

    citasHoy = citasDia;
    citasFuturas = citasRes;

    // Limpiar intervalos SOLO cuando tenemos los datos nuevos listos para evitar parpadeos vacíos
    Object.values(activeTurnIntervals).forEach(clearInterval);
    activeTurnIntervals = {};

    const listaOriginal = data || [];
    const seenTurnos = new Set();
    dataRender = [];
    for (const t of listaOriginal) {
        if (!t || !t.turno) continue;
        if (!seenTurnos.has(t.turno)) {
            seenTurnos.add(t.turno);
            dataRender.push(t);
        }
    }

    const lista = document.getElementById('listaEspera');
    const sinTurnos = document.getElementById('sin-turnos');
    const contadorEspera = document.getElementById('contador-espera');
    const turnosEsperaElement = document.getElementById('turnos-espera');
    lista.innerHTML = '';
    if (contadorEspera) {
        contadorEspera.textContent = `${dataRender.length} turno${dataRender.length !== 1 ? 's' : ''}`;
    }
    if (turnosEsperaElement) {
        turnosEsperaElement.textContent = dataRender.length;
    }
    const cargaEspera = document.getElementById('carga-espera');
    if (cargaEspera) {
        // Cálculo de saturación basado en capacidad (aprox 2 turnos por barbero = 100% "cómodo")
        const capacidadOptima = Math.max(1, barberosActivosList.length * 2);
        const porcentaje = Math.min((dataRender.length / capacidadOptima) * 100, 100);
        cargaEspera.style.width = `${porcentaje}%`;
        // Cambio de color según saturación
        cargaEspera.className = `h-2.5 rounded-full transition-all duration-500 ${porcentaje > 80 ? 'bg-red-600' : porcentaje > 50 ? 'bg-yellow-500' : 'bg-green-500'}`;
    }
    if (dataRender.length === 0 && sinTurnos) {
        sinTurnos.classList.remove('hidden');
    } else if (sinTurnos) {
        sinTurnos.classList.add('hidden');
    }

    // Pre-calcular tiempo estimado para cada turno en la lista usando el modelo PRO
    // Esto es solo visual para la lista, el cálculo real se hace bajo demanda o en background si es costoso
    const tiempoTotalCola = await calcularTiempoEstimadoTotal(); // Calcula para el final de la cola
    
    // --- MODO CONCENTRACIÓN ---
    const containerEspera = document.getElementById('contenedor-lista-espera');
    const btnFinalizar = document.getElementById('btnFinalizarGlobal');
    const btnAtender = document.getElementById('btnAtender');

    if (enAtencion.length > 0) {
        // Hay turno activo: Ocultar espera, mostrar finalizar
        if (containerEspera) containerEspera.style.display = 'none';
        if (btnFinalizar) {
            btnFinalizar.classList.remove('hidden');
            btnFinalizar.onclick = () => abrirModalPago(enAtencion[0].id); // Asume single-flow por ahora
        }
        if (btnAtender) btnAtender.classList.add('hidden');
    } else {
        if (containerEspera) containerEspera.style.display = 'block';
        if (btnFinalizar) btnFinalizar.classList.add('hidden');
        if (btnAtender) btnAtender.classList.remove('hidden');
    }

    // Renderizar solo los primeros 20 (Optimización de rendimiento)
    const turnosVisibles = dataRender.slice(0, 20);
    const divisor = dataRender.length || 1; // Protección contra división por cero
    for (let index = 0; index < turnosVisibles.length; index++) {
        const t = turnosVisibles[index];
        const div = document.createElement('div');
        div.className = 'turn-card-espera bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg shadow-sm border border-blue-100 dark:border-blue-800 transition-all hover:shadow-md cursor-grab';
        div.dataset.id = t.id;
        div.dataset.nombre = t.nombre;
        div.draggable = true;
        div.dataset.turno = t.turno;
        const horaCreacion = new Date(`${t.fecha}T${t.hora}`);
        const ahora = new Date();
        const minutosEsperaReal = Math.floor((ahora - horaCreacion) / 60000);
        
        // Nota: Para la lista individual, mostrar un estimado simple o llamar a calcularTiempoEstimadoTotal(t.turno)
        // Para rendimiento, aquí mostramos un aproximado simple basado en posición, 
        // pero el sistema global usa el cálculo PRO.
        const tiempoAprox = Math.round(tiempoTotalCola * ((index + 1) / divisor));

        div.innerHTML = `
      <div class="flex justify-between items-start">
        <span class="text-2xl font-bold text-blue-700 dark:text-blue-400">${t.turno}</span>
        <span class="text-xs bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded-full">${t.hora.slice(0, 5)}</span>
      </div>
      <p class="text-gray-700 dark:text-gray-300 font-medium mt-2 truncate">${t.nombre || 'Cliente'}</p>
      <div class="flex justify-between items-center mt-3">
        <span class="text-xs text-gray-500 dark:text-gray-400">${t.servicio || 'Servicio'}</span>
        <div class="text-right">
          <span class="text-xs text-gray-500 dark:text-gray-400 block">Esperando: <span class="esperando-min" data-creado-iso="${t.fecha}T${t.hora}">${minutosEsperaReal}</span> min</span>
          <span class="text-xs text-blue-600 dark:text-blue-400 font-medium">ETA: ~${tiempoAprox} min</span>
        </div>
      </div>
      <div class="mt-2 flex justify-end space-x-2">
      </div>`;
        lista.appendChild(div);
    }
    const listaAtencion = document.getElementById('listaAtencion');
    if (listaAtencion) {
        listaAtencion.innerHTML = '';
        (enAtencion || []).forEach(t => {
            const div = document.createElement('div');
            div.className = 'turn-card-atencion bg-green-50 dark:bg-green-900/30 p-4 rounded-lg shadow-sm border border-green-100 dark:border-green-800 transition-all cursor-pointer hover:shadow-md';
            div.dataset.id = t.id;
            div.innerHTML = `
        <div class="flex justify-between items-center">
          <span class="text-2xl font-bold text-green-700 dark:text-green-400">${t.turno}</span>
          <div id="timer-${t.id}" class="text-lg font-bold text-red-500 bg-red-100 dark:bg-red-900/50 px-2 py-0.5 rounded-lg">--:--</div>
        </div>
        <p class="text-gray-700 dark:text-gray-300 font-medium mt-2 truncate">${t.nombre || 'Cliente'}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${t.servicio || 'Servicio'}</p>`;
            listaAtencion.appendChild(div);
            iniciarTimerParaTurno(t);
        });
    }
    
    // UI: El display muestra el último llamado o el siguiente si no hay nadie
    const siguiente = getSiguienteTurno();
    const displayTurno = (enAtencion && enAtencion.length > 0) ? enAtencion[enAtencion.length - 1] : siguiente;
    document.getElementById('turnoActual').textContent = displayTurno ? displayTurno.turno : '--';
    const clienteActual = document.getElementById('cliente-actual');
    if (clienteActual) {
        clienteActual.textContent = displayTurno ? displayTurno.nombre : '-';
    }
    const tiempoEstimado = document.getElementById('tiempo-estimado');
    if (tiempoEstimado) {
        const turnoParaEstimar = displayTurno;
        if (turnoParaEstimar) {
            if (turnoParaEstimar.estado === ESTADOS.ATENCION) {
                const inicio = turnoParaEstimar.started_at ? new Date(turnoParaEstimar.started_at) : null;
                if (inicio) {
                    const trans = Math.max(0, Math.floor((Date.now() - inicio.getTime()) / 60000));
                    tiempoEstimado.dataset.startedIso = turnoParaEstimar.started_at;
                    tiempoEstimado.textContent = `En atención · ${trans} min`;
                } else {
                    tiempoEstimado.dataset.startedIso = '';
                    tiempoEstimado.textContent = `En atención`;
                }
            } else {
                const mins = (serviciosCache && serviciosCache[turnoParaEstimar.servicio]) ? serviciosCache[turnoParaEstimar.servicio] : 25;
                delete tiempoEstimado.dataset.startedIso;
                tiempoEstimado.textContent = `${mins} min`;
            }
        } else {
            delete tiempoEstimado.dataset.startedIso;
            tiempoEstimado.textContent = '-';
        }
    }
    if (dataRender.length > 0) {
        const tiempoPromedio = document.getElementById('tiempo-promedio');
        if (tiempoPromedio) {
            const promedio = dataRender.length > 0 ? tiempoTotalCola / dataRender.length : 0;
            tiempoPromedio.textContent = `${Math.round(promedio)} min`;
        }
    }
    renderCitas();
    renderPorBarbero(enAtencion || [], dataRender || [], citasHoy || []);
    
    // --- ALERTA VISUAL DE PRÓXIMA CITA ---
    const ahora = new Date();
    const proximaCitaInminente = citasHoy.find(c => {
        if (c.estado === ESTADOS.CITA_CANCELADA || c.estado === ESTADOS.CITA_ATENDIDA || c.estado === ESTADOS.ATENCION) return false;
        const start = new Date(c.start_at);
        const diffMin = (start - ahora) / 60000;
        return diffMin > 0 && diffMin <= 15; // Citas en los próximos 15 min
    });

    if (proximaCitaInminente) {
        const alertaDiv = document.getElementById('alerta-cita-proxima') || document.createElement('div');
        alertaDiv.id = 'alerta-cita-proxima';
        alertaDiv.className = 'fixed bottom-4 right-4 bg-yellow-500 text-white px-6 py-4 rounded-xl shadow-2xl z-50 animate-bounce cursor-pointer';
        alertaDiv.innerHTML = `<strong>⚠️ Cita Inminente</strong><br>${clientesMap[proximaCitaInminente.cliente_telefono] || 'Cliente'} - ${new Date(proximaCitaInminente.start_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
        alertaDiv.onclick = () => atenderAhora(); // Clic para ir directo a atender
        if (!document.getElementById('alerta-cita-proxima')) document.body.appendChild(alertaDiv);
    } else {
        const alerta = document.getElementById('alerta-cita-proxima');
        if (alerta) alerta.remove();
    }
}

function renderPorBarbero(enAtencionList, enEsperaList, citasHoyList) {
    const cont = document.getElementById('barberos-contenedor');
    if (!cont) return;
    cont.innerHTML = '';
    const ids = Object.keys(barberosMap);
    ids.forEach(idStr => {
        const id = Number(idStr);
        const nombre = barberosMap[id];
        const misAtencion = (enAtencionList || []).filter(t => t.barber_id === id);
        const misEspera = (enEsperaList || []).filter(t => t.barber_id === id);
        const misCitasHoy = (citasHoyList || []).filter(c => c.barber_id === id);
        const card = document.createElement('div');
        card.className = 'bg-white dark:bg-gray-800 p-5 rounded-xl shadow-md border border-gray-200 dark:border-gray-700';
        card.innerHTML = `
          <div class="flex justify-between items-center mb-3">
            <h3 class="text-lg font-semibold">${nombre}</h3>
            <span class="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full text-gray-600 dark:text-gray-300">
              Turnos: ${misEspera.length + misAtencion.length} · Citas: ${misCitasHoy.length}
            </span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <p class="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">En atención</p>
              <div class="space-y-2">
                ${(misAtencion.length ? misAtencion : []).map(t => `
                  <div class="text-sm bg-green-50 dark:bg-green-900/20 p-2 rounded-lg border border-green-100 dark:border-green-800">
                    <span class="font-bold text-green-700 dark:text-green-300">${t.turno}</span>
                    <span class="ml-2 text-gray-600 dark:text-gray-300">${t.nombre || ''}</span>
                  </div>
                `).join('')}
                ${misAtencion.length === 0 ? '<div class="text-xs text-gray-500">Sin turnos</div>' : ''}
              </div>
            </div>
            <div>
              <p class="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">En espera</p>
              <div class="space-y-2">
                ${(misEspera.length ? misEspera : []).map(t => `
                  <div class="text-sm bg-blue-50 dark:bg-blue-900/20 p-2 rounded-lg border border-blue-100 dark:border-blue-800">
                    <span class="font-bold text-blue-700 dark:text-blue-300">${t.turno}</span>
                    <span class="ml-2 text-gray-600 dark:text-gray-300">${t.nombre || ''}</span>
                  </div>
                `).join('')}
                ${misEspera.length === 0 ? '<div class="text-xs text-gray-500">Sin turnos</div>' : ''}
              </div>
            </div>
            <div>
              <p class="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Citas de hoy</p>
              <div class="space-y-2">
                ${(misCitasHoy.length ? misCitasHoy : []).map(c => {
                    const start = new Date(c.start_at);
                    const end = new Date(c.end_at);
                    return `
                      <div class="text-sm bg-emerald-50 dark:bg-emerald-900/20 p-2 rounded-lg border border-emerald-100 dark:border-emerald-800">
                        <span class="font-bold text-emerald-700 dark:text-emerald-300">${start.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</span>
                        <span class="ml-2 text-gray-600 dark:text-gray-300">hasta ${end.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</span>
                      </div>`;
                }).join('')}
                ${misCitasHoy.length === 0 ? '<div class="text-xs text-gray-500">Sin citas</div>' : ''}
              </div>
            </div>
          </div>
        `;
        cont.appendChild(card);
    });
}

let canalTurnos = null;
async function suscribirseTurnos() {
    if (canalTurnos) {
        await supabase.removeChannel(canalTurnos);
        canalTurnos = null;
    }
    canalTurnos = supabase
        .channel(`turnos-admin-${negocioId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'turnos', filter: `negocio_id=eq.${negocioId}` },
            () => { safeRefresh(); }
        )
        .subscribe();
}

let canalCitas = null;
async function suscribirseCitas() {
    if (canalCitas) {
        await supabase.removeChannel(canalCitas);
        canalCitas = null;
    }
    canalCitas = supabase
        .channel(`citas-admin-${negocioId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'citas', filter: `negocio_id=eq.${negocioId}` },
            () => { safeRefresh(); }
        )
        .subscribe();
}

function abrirModal() {
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('modal').classList.add('flex');
    document.getElementById('nombre').focus();
}

function cerrarModal() {
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('modal').classList.remove('flex');
    document.getElementById('formTurno').reset();
}

let activeTurnIdForPayment = null;
function abrirModalPago(turnId) {
    activeTurnIdForPayment = turnId;
    const modal = document.getElementById('modalPago');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.getElementById('montoCobrado').focus();
    }
}

function cerrarModalPago() {
    const modal = document.getElementById('modalPago');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.getElementById('formPago').reset();
        activeTurnIdForPayment = null;
    }
}

/**
 * Notifica a todos los clientes en espera cuando avanza la fila
 */
async function notificarAvanceFila() {
    if (__pushSubsCount === 0) return;
    if (!Array.isArray(dataRender)) return;
    // Optimización: Solo notificar a los primeros 5 de la fila para evitar rate limits y costos
    const turnosEnEspera = dataRender.filter(turno => turno.estado === ESTADOS.ESPERA).slice(0, 5);
    
    if (turnosEnEspera.length === 0) {
        console.log('No hay turnos en espera para notificar avance de fila');
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || supabase.supabaseKey;

    // Notificar a todos los clientes en espera sobre el avance
    const promesas = turnosEnEspera.map(async (turno, i) => {
        const posicionEnFila = i + 1;
        const turnosDelante = i;

        try {
            let mensaje = '';
            if (posicionEnFila === 1) {
                mensaje = '¡Es tu turno! Dirígete al local ahora.';
            } else if (posicionEnFila === 2) {
                mensaje = '¡Prepárate! Queda 1 persona antes que tú. Dirígete al local.';
            } else {
                mensaje = `La fila avanzó. Quedan ${turnosDelante} personas antes que tú. Estamos más cerca de tu turno.`;
            }

            let data, error;
            try {
                ({ data, error } = await supabase.functions.invoke('send-push-notification', {
                    body: {
                        telefono: turno.telefono,
                        negocio_id: negocioId,
                        title: `Turno ${turno.turno} - ${turno.nombre}`,
                        body: mensaje
                    }
                }));
            } catch (eInvoke) {
                try {
                    const url = 'https://wjvwjirhxenotvdewbmm.supabase.co/functions/v1/send-push-notification';
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            telefono: turno.telefono,
                            negocio_id: negocioId,
                            title: `Turno ${turno.turno} - ${turno.nombre}`,
                            body: mensaje
                        })
                    });
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    data = await res.json().catch(() => ({ success: true }));
                    error = null;
                } catch (eFetch) {
                    error = eFetch;
                }
            }

            if (error) {
                console.error(`Error notificando a ${turno.nombre}:`, error.message);
            } else if (data && data.success) {
                console.log(`Notificación enviada a ${turno.nombre} (posición ${posicionEnFila})`);
            }
        } catch (error) {
            console.error(`Error al notificar a ${turno.nombre}:`, error);
        }
    });

    await Promise.all(promesas);

    mostrarNotificacion(`Notificaciones de avance enviadas a ${turnosEnEspera.length} clientes.`, 'info');
}

async function notificarSiguienteEnCola() {
    if (__pushSubsCount === 0) return;
    if (!Array.isArray(dataRender)) return;
    // dataRender es el array de turnos en espera, ya ordenado.
    // El turno que se acaba de llamar estaba en el índice 0. El siguiente es el del índice 1.
    const siguienteTurno = dataRender.length > 1 ? dataRender[1] : null;

    if (!siguienteTurno || !siguienteTurno.telefono) {
        console.log('No hay siguiente turno en la cola para notificar.');
        return;
    }

    try {
        console.log(`Intentando notificar al siguiente en cola: ${siguienteTurno.nombre} (${siguienteTurno.telefono})`);

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || supabase.supabaseKey;

        let data, error;
        try {
            ({ data, error } = await supabase.functions.invoke('send-push-notification', {
                body: {
                    telefono: siguienteTurno.telefono,
                    negocio_id: negocioId,
                    title: `¡Es tu turno, ${siguienteTurno.nombre}!`,
                    body: 'Dirígete al local ahora. Es tu momento.'
                }
            }));
        } catch (eInvoke) {
            try {
                const url = 'https://wjvwjirhxenotvdewbmm.supabase.co/functions/v1/send-push-notification';
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        telefono: siguienteTurno.telefono,
                        negocio_id: negocioId,
                        title: `¡Es tu turno, ${siguienteTurno.nombre}!`,
                        body: 'Dirígete al local ahora. Es tu momento.'
                    })
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                data = await res.json().catch(() => ({ success: true }));
                error = null;
            } catch (eFetch) {
                error = eFetch;
            }
        }

        if (error) {
            console.error('Error devuelto por la función de notificación:', error.message);
            mostrarNotificacion(`No se pudo notificar a ${siguienteTurno.nombre}.`, 'warning');
            return;
        }

        if (data && data.success) {
            mostrarNotificacion(`Notificación push enviada a ${siguienteTurno.nombre}.`, 'info');
        } else {
             mostrarNotificacion(`Fallo al enviar notificación a ${siguienteTurno.nombre}: ${data.error}`, 'warning');
        }

    } catch (invokeError) {
        console.error('Error al invocar la función de notificación push:', invokeError);
        mostrarNotificacion('Error de red al intentar enviar la notificación push.', 'error');
    }
}

/**
 * Notifica a un cliente específico cuando se toma un turno
 * @param {string} telefono - Teléfono del cliente
 * @param {string} nombre - Nombre del cliente
 * @param {string} turno - Número de turno
 */
async function notificarTurnoTomado(telefono, nombre, turno) {
    if (__pushSubsCount === 0) return;
    if (!telefono) {
        console.log('No se puede notificar: teléfono no disponible');
        return;
    }

    try {
        console.log(`Notificando turno tomado a: ${nombre} (${telefono})`);

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || supabase.supabaseKey;

        let data, error;
        try {
            ({ data, error } = await supabase.functions.invoke('send-push-notification', {
                body: {
                    telefono: telefono,
                    negocio_id: negocioId,
                    title: `¡Turno confirmado, ${nombre}!`,
                    body: `Tu turno ${turno} ha sido registrado exitosamente. Te notificaremos cuando sea tu momento.`
                }
            }));
        } catch (eInvoke) {
            try {
                const url = 'https://wjvwjirhxenotvdewbmm.supabase.co/functions/v1/send-push-notification';
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        telefono: telefono,
                        negocio_id: negocioId,
                        title: `¡Turno confirmado, ${nombre}!`,
                        body: `Tu turno ${turno} ha sido registrado exitosamente. Te notificaremos cuando sea tu momento.`
                    })
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                data = await res.json().catch(() => ({ success: true }));
                error = null;
            } catch (eFetch) {
                error = eFetch;
            }
        }

        if (error) {
            console.error('Error al notificar turno tomado:', error.message);
            return;
        }

        if (data && data.success) {
            console.log(`Notificación de turno tomado enviada a ${nombre}`);
        } else {
            console.error(`Error al enviar notificación de turno tomado: ${data.error}`);
        }

    } catch (invokeError) {
        console.error('Error al invocar notificación de turno tomado:', invokeError);
    }
}

function barberoDisponible(barberId) {
    // 1. Verificar si tiene turno en atención (usando cache actualizado en cargarTurnos)
    const tieneTurnoActivo = enAtencionCache.some(t => t.barber_id === barberId);
    if (tieneTurnoActivo) return false;
    
    // 2. Verificar si tiene cita en el momento actual
    const ahora = new Date();
    const conflictoCita = citasHoy.find(c => {
        if (c.barber_id !== barberId) return false;
        if (c.estado === ESTADOS.CITA_CANCELADA || c.estado === ESTADOS.CITA_ATENDIDA) return false;
        const start = new Date(c.start_at);
        const end = new Date(c.end_at);
        return (ahora >= start && ahora < end);
    });
    
    return !conflictoCita;
}

/**
 * Verifica si un barbero tiene tiempo suficiente para atender un servicio antes de su próxima cita.
 */
function barberoTieneTiempo(barberId, duracionMinutos) {
    const ahora = new Date();
    // Buffer de seguridad automático (Mejora #4)
    const bufferSeguridad = 5; 
    const finTurnoEstimado = new Date(ahora.getTime() + (duracionMinutos + bufferSeguridad) * 60000);
    
    // Buscar la próxima cita programada para este barbero hoy
    const proximaCita = citasHoy
        .filter(c => {
            if (c.barber_id !== barberId) return false;
            if (c.estado === ESTADOS.CITA_CANCELADA || c.estado === ESTADOS.CITA_ATENDIDA || c.estado === ESTADOS.ATENCION) return false;
            const start = new Date(c.start_at);
            return start > ahora;
        })
        .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))[0];

    if (!proximaCita) return true; // No hay citas futuras hoy que bloqueen

    const inicioCita = new Date(proximaCita.start_at);
    return finTurnoEstimado <= inicioCita;
}

function obtenerBarberoSugerido(duracionTurno = 30) {
    // Busca el primer barbero activo que esté disponible Y tenga tiempo antes de su próxima cita
    return barberosActivosList.find(b => barberoDisponible(b.id) && barberoTieneTiempo(b.id, duracionTurno)) || null;
}

async function atenderAhora() {
    // 5. Seguridad: Evitar doble clic en "Atender"
    if (window.__atendiendo) return;
    window.__atendiendo = true;

    const turnoParaAtender = getSiguienteTurno();
    if (!turnoParaAtender) {
        mostrarNotificacion('No hay turno en espera.', 'warning');
        window.__atendiendo = false;
        return;
    }
    let barberId = null;
    let confirmado = false; // Validación de cierre de modal
    
    // Obtener duración del servicio del turno a atender
    const duracionServicio = serviciosCache[turnoParaAtender.servicio] || 30;

    // Auto-asignación inteligente si hay un barbero libre sugerido
    const barberoSugerido = obtenerBarberoSugerido(duracionServicio);
    
    try {
        // Usamos la lista cacheada de barberos activos
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
        const box = document.createElement('div');
        box.className = 'bg-white dark:bg-gray-800 p-6 rounded-xl w-full max-w-md';
        box.innerHTML = `
          <h3 class="text-lg font-bold mb-4">Seleccionar Barbero</h3>
          <select id="selBarberoAtencion" class="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white mb-4">
            <option value="">-- Seleccionar --</option>
            ${barberosActivosList.map(b => {
                const disponible = barberoDisponible(b.id);
                const tieneTiempo = barberoTieneTiempo(b.id, duracionServicio);
                
                let estadoStr = '🟢 Disponible';
                if (!disponible) estadoStr = '🔴 Ocupado';
                else if (!tieneTiempo) estadoStr = '⚠️ Cita próxima';

                const selected = (barberoSugerido && b.id === barberoSugerido.id) ? 'selected' : '';
                return `<option value="${b.id}" ${selected}>${b.nombre || b.usuario} (${estadoStr})</option>`;
            }).join('')}
          </select>
          <div class="flex gap-3 justify-end">
            <button id="confirmBarbero" class="px-4 py-2 bg-gray-900 text-white rounded">Confirmar</button>
            <button id="cancelBarbero" class="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded">Cancelar</button>
          </div>
        `;
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        await new Promise((resolve, reject) => {
            document.getElementById('confirmBarbero').addEventListener('click', () => {
                const sel = document.getElementById('selBarberoAtencion');
                barberId = Number(sel.value);
                confirmado = true;
                document.body.removeChild(overlay);
                resolve();
            });
            document.getElementById('cancelBarbero').addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve();
            });
        });
    } catch {}

    // Si el usuario canceló el modal (no confirmó), salimos para evitar estados inconsistentes
    if (!confirmado) {
        window.__atendiendo = false;
        return;
    }
    
    // Validación de disponibilidad del barbero seleccionado
    if (barberId && !barberoDisponible(barberId)) {
        mostrarNotificacion('El barbero seleccionado tiene una cita en curso.', 'warning');
        window.__atendiendo = false;
        return;
    }
    
    // Validación de solapamiento con citas futuras
    if (barberId && !barberoTieneTiempo(barberId, duracionServicio)) {
        if (!confirm('⚠️ El barbero seleccionado tiene una cita próxima y este turno podría superponerse. ¿Asignar de todos modos?')) {
            window.__atendiendo = false;
            return;
        }
    }

    const ahora = new Date();
    const ventanaMin = 20; // Aumentado a 20 min para dar prioridad absoluta a citas
    let citaPrioritaria = null;
    if (barberId) {
        citaPrioritaria = (citasHoy || []).find(c => {
            const start = new Date(c.start_at);
            const end = new Date(c.end_at);
            const inicioVentana = new Date(start.getTime() - ventanaMin * 60000);
            return c.barber_id === barberId && ahora >= inicioVentana && ahora <= end && (c.estado === ESTADOS.CITA_PROGRAMADA || !c.estado);
        });
    } else {
        // Si es asignación automática, buscar CUALQUIER cita prioritaria
        citaPrioritaria = (citasHoy || []).find(c => {
            const start = new Date(c.start_at);
            const inicioVentana = new Date(start.getTime() - ventanaMin * 60000);
            // Solo si el barbero de la cita está libre (o es el que se va a liberar)
            return ahora >= inicioVentana && (c.estado === ESTADOS.CITA_PROGRAMADA || !c.estado);
        });
    }

    if (citaPrioritaria) {
        const nombreCliente = clientesMap[citaPrioritaria.cliente_telefono] || 'Cliente Cita';
        const horaCita = new Date(citaPrioritaria.start_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        
        const confirmacion = await Swal.fire({
            title: '📅 Cita Programada Detectada',
            html: `Hay una cita para <strong>${nombreCliente}</strong> a las <strong>${horaCita}</strong>.<br>Por política de "No Filas", las citas tienen prioridad.`,
            icon: 'info',
            showCancelButton: true,
            confirmButtonText: '✅ Atender Cita Ahora',
            cancelButtonText: 'Saltar y tomar turno (No recomendado)',
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#6b7280'
        });

        if (confirmacion.isConfirmed) {
        // CORRECCIÓN CRÍTICA: Usar RPC para convertir la cita en turno real
        // Esto asegura que el tiempo de la cita se sume a la cola de espera
        try {
            await procesarAtencionCita(citaPrioritaria.id, negocioId);
            mostrarNotificacion('Atendiendo cita programada (Turno generado)', 'success');
        } catch (e) {
            mostrarNotificacion('Error al atender cita: ' + e.message, 'error');
        }
        
        // Notificar avance de fila (ahora sí detectará el nuevo turno en atención)
        await notificarAvanceFila();
        
        refrescarUI();
        window.__atendiendo = false;
        return;
    }
    }
    
    const payloadUpdate = { started_at: new Date().toISOString() };
    if (barberId) payloadUpdate.barber_id = barberId;
    
    const exito = await cambiarEstadoTurno(turnoParaAtender.id, ESTADOS.ATENCION, payloadUpdate);
    
    if (!exito) {
        window.__atendiendo = false;
        return;
    }
    mostrarNotificacion(`Atendiendo turno ${turnoParaAtender.turno}`, 'success');

    // Notificar avance de fila a todos los clientes en espera
    await notificarAvanceFila();

    window.__atendiendo = false;
}

function renderCitas() {
    const contHoy = document.getElementById('listaCitasHoy');
    const contFut = document.getElementById('listaCitasFuturas');
    const cntHoy = document.getElementById('contador-citas-hoy');
    const cntFut = document.getElementById('contador-citas-futuras');

    const citasHoyPendientes = (citasHoy || []).filter(c => !c.estado || c.estado === ESTADOS.CITA_PROGRAMADA);
    const citasFuturasPendientes = (citasFuturas || []).filter(c => !c.estado || c.estado === ESTADOS.CITA_PROGRAMADA);

    if (cntHoy) cntHoy.textContent = `${citasHoyPendientes.length} citas`;
    if (cntFut) cntFut.textContent = `${citasFuturasPendientes.length} citas`;
    if (contHoy) {
        contHoy.innerHTML = '';
        citasHoyPendientes.forEach(c => {
            const start = new Date(c.start_at);
            const end = new Date(c.end_at);
            const dur = Math.max(0, Math.round((end - start) / 60000));
            const bName = barberosMap[c.barber_id] || `#${c.barber_id}`;
            const clientName = clientesMap[c.cliente_telefono] || 'Cliente';
            const card = document.createElement('div');
            card.className = 'bg-emerald-50 dark:bg-emerald-900/30 p-4 rounded-lg shadow-sm border border-emerald-100 dark:border-emerald-800 transition-all cursor-pointer hover:shadow-md hover:scale-[1.02]';
            card.ondblclick = () => abrirModalAccionesCita(c.id, `Cita: ${clientName} - ${start.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}`);
            card.innerHTML = `
              <div class="flex justify-between items-start">
                <span class="text-2xl font-bold text-emerald-700 dark:text-emerald-400">${start.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</span>
                <span class="text-xs bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded-full">${bName}</span>
              </div>
              <p class="text-gray-900 dark:text-white font-bold mt-2 truncate">${clientName}</p>
              <p class="text-gray-500 dark:text-gray-400 text-xs truncate">${c.cliente_telefono || ''}</p>
              <div class="flex justify-between items-center mt-3">
                <span class="text-xs text-gray-500 dark:text-gray-400">Hasta ${end.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</span>
                <span class="text-xs text-gray-500 dark:text-gray-400">${dur} min</span>
              </div>`;
            contHoy.appendChild(card);
        });
    }
    if (contFut) {
        contFut.innerHTML = '';
        citasFuturasPendientes.forEach(c => {
            const start = new Date(c.start_at);
            const end = new Date(c.end_at);
            const bName = barberosMap[c.barber_id] || `#${c.barber_id}`;
            const clientName = clientesMap[c.cliente_telefono] || 'Cliente';
            const card = document.createElement('div');
            card.className = 'bg-violet-50 dark:bg-violet-900/30 p-4 rounded-lg shadow-sm border border-violet-100 dark:border-violet-800 transition-all';
            card.innerHTML = `
              <div class="flex justify-between items-start">
                <span class="text-2xl font-bold text-violet-700 dark:text-violet-400">${start.toLocaleDateString('es-ES')} ${start.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</span>
                <span class="text-xs bg-violet-200 dark:bg-violet-800 text-violet-800 dark:text-violet-200 px-2 py-0.5 rounded-full">${bName}</span>
              </div>
              <p class="text-gray-900 dark:text-white font-bold mt-2 truncate">${clientName}</p>
              <p class="text-gray-500 dark:text-gray-400 text-xs truncate">${c.cliente_telefono || ''}</p>`;
            contFut.appendChild(card);
        });
    }
}

async function guardarPago(event) {
    event.preventDefault();
    if (!activeTurnIdForPayment) return;
    
    // 1. Error potencial: metodo_pago no existe en memoria inicial
    const metodoSeleccionado = document.querySelector('input[name="metodo_pago"]:checked');
    if (!metodoSeleccionado) {
       mostrarNotificacion('Seleccione un método de pago.', 'warning');
       return;
    }
    const metodoPago = metodoSeleccionado.value;

    // 2. Evitar NaN en monto cobrado
    const montoInput = document.getElementById('montoCobrado').value;
    const monto = parseFloat(montoInput);

    if (isNaN(monto) || monto < 0) {
       mostrarNotificacion('Ingrese un monto válido.', 'warning');
       return;
    }

    const exito = await cambiarEstadoTurno(activeTurnIdForPayment, ESTADOS.ATENDIDO, {
        monto_cobrado: monto,
        metodo_pago: metodoPago,
        ended_at: new Date().toISOString()
    });

    if (!exito) {
        return;
    }
    cerrarModalPago();
    mostrarNotificacion(`Turno finalizado con cobro de RD$${monto}`, 'success');
    
    // Notificar avance de fila después de completar un turno
    await notificarAvanceFila();
}

async function devolverTurno() {
    const turnoParaDevolver = getSiguienteTurno();
    if (!turnoParaDevolver) {
        mostrarNotificacion('No hay turno que devolver.', 'warning');
        return;
    }
    if (!confirm(`¿Enviar el turno ${turnoParaDevolver.turno} al final de la cola?`)) {
        return;
    }
    
    try {
        // RPC atómica para mover turno al final y evitar condiciones de carrera
        const { error } = await supabase.rpc('devolver_turno', {
            p_turno_id: turnoParaDevolver.id,
            p_negocio_id: negocioId
        });

        if (error) throw error;

        mostrarNotificacion(`Turno ${turnoParaDevolver.turno} enviado al final de la cola`, 'info');
        refrescarUI();
    } catch (error) {
        console.error('Error al devolver turno:', error);
        mostrarNotificacion('Error al devolver turno: ' + error.message, 'error');
    }
}

// --- Lógica Modal Acciones Cita ---
let selectedCitaId = null;

function abrirModalAccionesCita(id, info) {
    selectedCitaId = id;
    const infoEl = document.getElementById('infoCitaModal');
    if(infoEl) infoEl.textContent = info || 'Gestionar cita seleccionada';
    const modal = document.getElementById('modalAccionesCita');
    if(modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function cerrarModalAccionesCita() {
    selectedCitaId = null;
    const modal = document.getElementById('modalAccionesCita');
    if(modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function confirmarAtenderCita() {
    if (!selectedCitaId) return;
    try {
        // FIX: Reemplazo de RPC por lógica cliente
        await procesarAtencionCita(selectedCitaId, negocioId);

        mostrarNotificacion('Cita pasada a atención correctamente', 'success');
        cerrarModalAccionesCita();
        refrescarUI();
    } catch (e) {
        console.error(e);
        mostrarNotificacion('Error al atender cita: ' + e.message, 'error');
    }
}

async function procesarAtencionCita(citaId, negocioId) {
    // 1. Obtener la cita
    const { data: cita, error: errCita } = await supabase
        .from('citas')
        .select('*')
        .eq('id', citaId)
        .single();
    if (errCita) throw new Error('Cita no encontrada');

    // 2. Obtener nombre del cliente
    let nombreCliente = 'Cliente Cita';
    if (cita.cliente_telefono) {
        const { data: cliente } = await supabase
            .from('clientes')
            .select('nombre')
            .eq('negocio_id', negocioId)
            .eq('telefono', cita.cliente_telefono)
            .maybeSingle();
        if (cliente) nombreCliente = cliente.nombre;
    }

    // 3. Crear el turno
    const { data: resTurno, error: errTurno } = await supabase.rpc('registrar_turno', {
        p_negocio_id: negocioId,
        p_nombre: nombreCliente,
        p_telefono: cita.cliente_telefono || '0000000000',
        p_servicio: 'Cita Programada',
        p_barber_id: cita.barber_id
    });

    let turnoId = null;
    if (errTurno) throw errTurno;

    if (!resTurno.success) {
        // Si ya tiene turno, buscamos el activo para actualizarlo
        if (resTurno.message && resTurno.message.includes('activo')) {
             const { data: turnoExistente } = await supabase.from('turnos').select('id').eq('negocio_id', negocioId).eq('telefono', cita.cliente_telefono).in('estado', ['En espera', 'En atención']).maybeSingle();
             if (turnoExistente) turnoId = turnoExistente.id;
             else throw new Error(resTurno.message);
        } else {
            throw new Error(resTurno.message);
        }
    } else {
        turnoId = resTurno.id;
    }

    // 4. Actualizar estados
    const { error: errUpdTurno } = await supabase.from('turnos').update({ estado: 'En atención', started_at: new Date().toISOString(), barber_id: cita.barber_id }).eq('id', turnoId);
    if (errUpdTurno) throw errUpdTurno;
    const { error: errUpdCita } = await supabase.from('citas').update({ estado: 'Atendida' }).eq('id', citaId);
    if (errUpdCita) throw errUpdCita;
}

async function confirmarCancelarCita() {
    if (!selectedCitaId) return;
    if (!confirm('¿Seguro que deseas cancelar esta cita?')) return;
    try {
        const { error } = await supabase.from('citas').update({ estado: ESTADOS.CITA_CANCELADA }).eq('id', selectedCitaId);
        if (error) throw error;
        mostrarNotificacion('Cita cancelada', 'info');
        cerrarModalAccionesCita();
        refrescarUI();
    } catch (e) {
        mostrarNotificacion('Error al cancelar: ' + e.message, 'error');
    }
}

window.abrirModalAccionesCita = abrirModalAccionesCita;
window.cerrarModalAccionesCita = cerrarModalAccionesCita;
window.confirmarAtenderCita = confirmarAtenderCita;
window.confirmarCancelarCita = confirmarCancelarCita;

function mostrarNotificacion(mensaje, tipo = 'info') {
    const iconos = { success: 'success', error: 'error', warning: 'warning', info: 'info' };
    Swal.fire({
        title: tipo === 'error' ? 'Error' : tipo === 'success' ? 'Éxito' : 'Información',
        text: mensaje,
        icon: iconos[tipo] || 'info',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        didOpen: (toast) => {
            toast.addEventListener('mouseenter', Swal.stopTimer);
            toast.addEventListener('mouseleave', Swal.resumeTimer);
        }
    });
}

window.tomarTurno = tomarTurno;
window.abrirModal = abrirModal;
window.cerrarModal = cerrarModal;
window.cerrarModalPago = cerrarModalPago;
window.devolverTurno = devolverTurno;
window.atenderAhora = atenderAhora;

let recognition = null;
let isRecognizing = false;

function iniciarReconocimientoVoz() {
    const voiceCommandButton = document.getElementById('voice-command-button');
    const micIcon = document.getElementById('mic-icon');
    if (!voiceCommandButton) return;
    const micLoading = document.getElementById('mic-loading');
    const voiceCommandText = document.getElementById('voice-command-text');

    if (isRecognizing) {
        if (recognition) {
            recognition.stop();
        }
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        mostrarNotificacion('Tu navegador no soporta el reconocimiento de voz.', 'error');
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
        isRecognizing = true;
        micIcon.classList.add('hidden');
        micLoading.classList.remove('hidden');
        voiceCommandText.textContent = 'Escuchando...';
        voiceCommandButton.classList.add('bg-red-500', 'hover:bg-red-600');
        voiceCommandButton.classList.remove('bg-purple-600', 'hover:bg-purple-700');
    };

    recognition.onend = () => {
        isRecognizing = false;
        micIcon.classList.remove('hidden');
        micLoading.classList.add('hidden');
        voiceCommandText.textContent = 'Comando de Voz';
        voiceCommandButton.classList.remove('bg-red-500', 'hover:bg-red-600');
        voiceCommandButton.classList.add('bg-purple-600', 'hover:bg-purple-700');
        recognition = null; // Clean up
    };

    recognition.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'audio-capture' || event.error === 'not-allowed') {
            mostrarNotificacion('No se pudo iniciar el reconocimiento. Revisa los permisos del micrófono.', 'warning');
        } else {
            mostrarNotificacion('Error en el reconocimiento de voz: ' + event.error, 'error');
        }
    };

    // 7. Protección de reconocimiento de voz
    recognition.onnomatch = () => {
       mostrarNotificacion('No se entendió el audio.', 'warning');
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim().toLowerCase();
        procesarComandoVoz(transcript);
    };

    recognition.start();
}

window.iniciarReconocimientoVoz = iniciarReconocimientoVoz;

function hablar(texto) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(texto);
        utterance.lang = 'es-ES';
        utterance.rate = 1;
        utterance.pitch = 1;

        let voices = window.speechSynthesis.getVoices();
        const spanishVoice = voices.find(voice => voice.lang === 'es-ES' || voice.lang.startsWith('es-'));
        if (spanishVoice) {
            utterance.voice = spanishVoice;
        } else {
             window.speechSynthesis.onvoiceschanged = () => {
                voices = window.speechSynthesis.getVoices();
                const spanishVoice = voices.find(voice => voice.lang === 'es-ES' || voice.lang.startsWith('es-'));
                if (spanishVoice) {
                    utterance.voice = spanishVoice;
                }
            };
        }

        window.speechSynthesis.speak(utterance);
    } else {
        console.warn('La síntesis de voz no es soportada en este navegador.');
    }
}

function procesarComandoVoz(transcript) {
    mostrarNotificacion(`Comando recibido: "${transcript}"`, 'info');

    const comandosSiguiente = ['siguiente turno', 'cuál turno sigue', 'quién sigue', 'próximo turno'];
    const comandosAtender = ['pasar turno', 'atender turno', 'pase el turno', 'siguiente', 'atender', 'pasar'];

    if (comandosSiguiente.some(cmd => transcript.includes(cmd))) {
        const siguiente = getSiguienteTurno();
        if (siguiente && siguiente.nombre) {
            const texto = `El siguiente turno es de ${siguiente.nombre}.`;
            hablar(texto);
            mostrarNotificacion(texto, 'success');
        } else {
            const texto = 'No hay más turnos en espera.';
            hablar(texto);
            mostrarNotificacion(texto, 'warning');
        }
    } else if (comandosAtender.some(cmd => transcript.includes(cmd))) {
        const siguiente = getSiguienteTurno();
        if (siguiente) {
            hablar(`Atendiendo a ${siguiente.nombre}.`);
            if (!window.__atendiendo) atenderAhora();
        } else {
            const texto = 'No hay turnos para atender.';
            hablar(texto);
            mostrarNotificacion(texto, 'warning');
        }
    } else {
        const texto = 'No se reconoció un comando válido.';
        hablar(texto);
        mostrarNotificacion(texto, 'error');
    }
}


async function handleDoubleClickDelete(event) {
    if (!event) return;
    event.preventDefault();
    const card = event.target.closest('.turn-card-espera');
    if (!card) return;
    event.stopPropagation();

    const turnId = card.dataset.id;
    const turnNombre = card.dataset.nombre;
    const turnNumero = card.dataset.turno;

    if (!turnId || !turnNombre || !turnNumero) return;

    Swal.fire({
        title: '¿Eliminar Turno?',
        html: `¿Estás seguro de que quieres eliminar el turno <strong>${turnNumero}</strong> de <strong>${turnNombre}</strong>?<br>Esta acción no se puede deshacer.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'No, cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const { error } = await supabase
                    .from('turnos')
                    .update({ estado: ESTADOS.CANCELADO })
                    .eq('id', turnId)
                    .eq('negocio_id', negocioId);

                if (error) throw error;

                if (card && card.parentElement) {
                    card.parentElement.removeChild(card);
                }

                mostrarNotificacion('Turno cancelado con éxito.', 'success');
                refrescarUI();
            } catch (error) {
                console.error('Error al eliminar turno:', error);
                mostrarNotificacion('Error al eliminar el turno.', 'error');
            }
        }
    });
}
