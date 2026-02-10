import { supabase, ensureSupabase } from '../database.js';

let turnoActual = null;
let dataRender = []; // Cache of waiting list turns for reordering
let HORA_APERTURA = "08:00";
let HORA_LIMITE_TURNOS = "23:00";
let LIMITE_TURNOS = 50;
let chart = null;
let ALLOWED_DAYS = [1, 2, 3, 4, 5, 6];
let activeTurnIntervals = {};
let serviciosCache = {};
let isRefreshing = false; // Bandera para evitar ejecuciones simultáneas
let citasHoy = [];
let citasFuturas = [];
let barberosMap = {};
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

function iniciarTimerParaTurno(turno) {
    const timerEl = document.getElementById(`timer-${turno.id}`);
    const duracionMin = serviciosCache[turno.servicio];

    if (!timerEl || !duracionMin || !turno.started_at) {
        if (timerEl) timerEl.textContent = '--:--';
        return;
    }

    const startTime = new Date(turno.started_at).getTime();
    const endTime = startTime + duracionMin * 60 * 1000;

    const updateTimer = () => {
        const ahora = Date.now();
        const restanteMs = Math.max(0, endTime - ahora);

        if (restanteMs === 0) {
            timerEl.textContent = '00:00';
            if (activeTurnIntervals[turno.id]) {
                clearInterval(activeTurnIntervals[turno.id]);
                delete activeTurnIntervals[turno.id];
            }
            return;
        }

        const minutos = Math.floor(restanteMs / 60000);
        const segundos = Math.floor((restanteMs % 60000) / 1000);
        timerEl.textContent = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
    };

    updateTimer();
    activeTurnIntervals[turno.id] = setInterval(updateTimer, 1000);
}

let __refreshTimer = null;
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
            await cargarTurnos();
            await cargarEstadisticas();
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
        .select('id,nombre,usuario')
        .eq('negocio_id', negocioId);
    barberosMap = {};
    (data || []).forEach(b => { barberosMap[b.id] = b.nombre || b.usuario; });
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
    await cargarPushSubsCount();
    refrescarUI();
    document.getElementById('refrescar-turnos')?.addEventListener('click', () => {
        refrescarUI();
        mostrarNotificacion('Turnos actualizados', 'success');
    });
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebar = document.getElementById('sidebar');
    const listaEspera = document.getElementById('listaEspera');
    const overlay = document.getElementById('sidebar-overlay');
    const mainContent = document.querySelector('.flex-1'); // Contenedor principal

    function toggleMobile() {
        sidebar.classList.toggle('-translate-x-full');
        overlay.classList.toggle('opacity-0');
        overlay.classList.toggle('pointer-events-none');
    }

    function toggleDesktop() {
        sidebar.classList.toggle('w-64');
        sidebar.classList.toggle('w-20');
        // Ocultar textos en modo colapsado
        const texts = sidebar.querySelectorAll('.sidebar-text');
        texts.forEach(t => t.classList.toggle('hidden'));
    }

    mobileMenuButton?.addEventListener('click', toggleMobile);
    overlay?.addEventListener('click', toggleMobile);
    toggleBtn?.addEventListener('click', toggleDesktop);

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
});

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
    await cargarHoraLimite();
    if (!esDiaOperativo(new Date())) {
        mostrarNotificacion('Hoy no es un día operacional.', 'error');
        return;
    }
    const ahora = new Date();
    const horaActual = ahora.toTimeString().slice(0, 5);
    const horaStr = ahora.toLocaleTimeString('es-ES', { hour12: false });
    if (horaActual < HORA_APERTURA) {
        mostrarNotificacion(`Aún no hemos abierto. Horario: ${HORA_APERTURA} - ${HORA_LIMITE_TURNOS}`, 'error');
        return;
    }
    if (horaActual >= HORA_LIMITE_TURNOS) {
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
    const fechaHoy = new Date().toISOString().slice(0, 10);
    
    // 9. Campo orden al crear turno: Calcular nuevo orden
    const { data: ultimo } = await supabase
        .from('turnos')
        .select('orden')
        .eq('negocio_id', negocioId)
        .eq('fecha', fechaHoy)
        .order('orden', { ascending: false })
        .limit(1);
    const nuevoOrden = (ultimo?.[0]?.orden || 0) + 1;

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
    try {
        while (true) {
            const hoyCheck = new Date().toISOString().slice(0, 10);
            const { data: existe } = await supabase
                .from('turnos')
                .select('id')
                .eq('negocio_id', negocioId)
                .eq('fecha', hoyCheck)
                .eq('turno', nuevoTurno)
                .limit(1);
            if (!existe || !existe.length) break;
            const num = parseInt(nuevoTurno.substring(1) || '0', 10) + 1;
            nuevoTurno = nuevoTurno[0] + String(num).padStart(2, '0');
        }
    } catch (e) {
        console.warn('No se pudo verificar duplicidad del turno, se usará el generado.');
    }
    const hoy = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from('turnos').insert([{
        negocio_id: negocioId,
        turno: nuevoTurno,
        nombre: nombre,
        telefono: telefono,
        servicio: servicio,
        estado: 'En espera',
        hora: horaStr,
        fecha: hoy,
        orden: nuevoOrden
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
    const hoy = new Date().toISOString().slice(0, 10);
    let tiempoTotal = 0;
    try {
        const { data: enAtencion } = await supabase
            .from('turnos')
            .select('servicio, started_at')
            .eq('negocio_id', negocioId)
            .eq('fecha', hoy)
            .eq('estado', 'En atención')
            .order('started_at', { ascending: true })
            .limit(1);
        if (enAtencion && enAtencion.length) {
            const servicio = enAtencion[0].servicio;
            const duracionTotal = serviciosCache[servicio] || 25;
            const inicio = enAtencion[0].started_at ? new Date(enAtencion[0].started_at) : null;
            if (inicio) {
                const transcurrido = Math.floor((Date.now() - inicio.getTime()) / 60000);
                tiempoTotal = Math.max(duracionTotal - transcurrido, 0);
            } else {
                tiempoTotal = duracionTotal;
            }
        }
    } catch (error) {
        console.warn('Error calculando tiempo de atención:', error);
    }
    try {
        const { data: cola } = await supabase
            .from('turnos')
            .select('turno, servicio')
            .eq('negocio_id', negocioId)
            .eq('estado', 'En espera')
            .order('orden', { ascending: true })
            .order('created_at', { ascending: true });
        if (cola && cola.length) {
            const limite = turnoObjetivo ?
                cola.findIndex(t => t.turno === turnoObjetivo) :
                cola.length;
            const turnosASumar = limite === -1 ? cola : cola.slice(0, limite);
            for (const turno of turnosASumar) {
                const duracionServicio = serviciosCache[turno.servicio] || 25;
                tiempoTotal += duracionServicio;
            }
        }
    } catch (error) {
        console.warn('Error calculando tiempo de cola:', error);
    }
    return tiempoTotal;
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
            .eq('estado', 'En atención')
            .eq('negocio_id', negocioId)
            .eq('fecha', hoy)
            .order('started_at', { ascending: true });
        
        if (resAtencion.error) throw resAtencion.error;
        enAtencion = resAtencion.data || [];
    } catch (e) {
        // Fallback sin ordenar por started_at
        const resAtencionFallback = await supabase
            .from('turnos')
            .select('*')
            .eq('estado', 'En atención')
            .eq('negocio_id', negocioId)
            .eq('fecha', hoy);
        enAtencion = resAtencionFallback.data || [];
    }

    let data = [], error = null;
    try {
        const resEspera = await supabase
            .from('turnos')
            .select('*')
            .eq('estado', 'En espera')
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
            .eq('estado', 'En espera')
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
        const porcentaje = Math.min(dataRender.length * 10, 100);
        cargaEspera.style.width = `${porcentaje}%`;
    }
    if (dataRender.length === 0 && sinTurnos) {
        sinTurnos.classList.remove('hidden');
    } else if (sinTurnos) {
        sinTurnos.classList.add('hidden');
    }

    // 3. Optimización grande: Calcular tiempos en memoria (evita N+1 consultas)
    let tiempoBase = 0;
    if (enAtencion && enAtencion.length > 0) {
        // Usamos el primero en atención para calcular el remanente, similar a calcularTiempoEstimadoTotal
        const current = enAtencion[0]; 
        const duracion = serviciosCache[current.servicio] || 25;
        const inicio = current.started_at ? new Date(current.started_at) : null;
        if (inicio) {
            const transcurrido = Math.floor((Date.now() - inicio.getTime()) / 60000);
            tiempoBase = Math.max(duracion - transcurrido, 0);
        } else {
            tiempoBase = duracion;
        }
    }
    let acumuladoEspera = 0;

    for (let index = 0; index < dataRender.length; index++) {
        const t = dataRender[index];
        const div = document.createElement('div');
        div.className = 'turn-card-espera bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg shadow-sm border border-blue-100 dark:border-blue-800 transition-all hover:shadow-md cursor-grab';
        div.dataset.id = t.id;
        div.dataset.nombre = t.nombre;
        div.draggable = true;
        div.dataset.turno = t.turno;
        const horaCreacion = new Date(`${t.fecha}T${t.hora}`);
        const ahora = new Date();
        const minutosEsperaReal = Math.floor((ahora - horaCreacion) / 60000);
        
        // Cálculo optimizado
        const tiempoEstimadoHasta = tiempoBase + acumuladoEspera;
        acumuladoEspera += (serviciosCache[t.servicio] || 25);

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
          <span class="text-xs text-blue-600 dark:text-blue-400 font-medium">ETA: ${tiempoEstimadoHasta} min</span>
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
    const turnoActualDisplay = (enAtencion && enAtencion.length > 0) ? enAtencion[enAtencion.length - 1] : null;
    // 4. Bug oculto: turnoActual puede ser incorrecto (priorizar el que está en atención)
    turnoActual = turnoActualDisplay || ((dataRender.length > 0) ? dataRender[0] : null);
    document.getElementById('turnoActual').textContent = turnoActualDisplay ? turnoActualDisplay.turno : (turnoActual ? turnoActual.turno : '--');
    const clienteActual = document.getElementById('cliente-actual');
    if (clienteActual) {
        clienteActual.textContent = turnoActualDisplay ? turnoActualDisplay.nombre : (turnoActual ? turnoActual.nombre : '-');
    }
    const tiempoEstimado = document.getElementById('tiempo-estimado');
    if (tiempoEstimado) {
        const turnoParaEstimar = turnoActualDisplay || turnoActual;
        if (turnoParaEstimar) {
            if (turnoParaEstimar.estado === 'En atención') {
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
            const tiempoTotalCola = await calcularTiempoEstimadoTotal();
            const promedio = dataRender.length > 0 ? tiempoTotalCola / dataRender.length : 0;
            tiempoPromedio.textContent = `${Math.round(promedio)} min`;
        }
    }
    renderCitas();
    renderPorBarbero(enAtencion || [], dataRender || [], citasHoy || []);
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

async function cargarEstadisticas() {
    if (!negocioId) return;
    const hoy = new Date().toISOString().slice(0, 10);
    
    try {
        // Cargar datos en paralelo para eficiencia
        const [resAtendidos, resDevueltos, resEspera] = await Promise.all([
            supabase.from('turnos').select('*').eq('estado', 'Atendido').eq('negocio_id', negocioId).eq('fecha', hoy),
            supabase.from('turnos').select('*').eq('estado', 'Devuelto').eq('negocio_id', negocioId).eq('fecha', hoy),
            supabase.from('turnos').select('*').eq('estado', 'En espera').eq('negocio_id', negocioId).eq('fecha', hoy)
        ]);

        if (resAtendidos.error) throw resAtendidos.error;
        if (resDevueltos.error) throw resDevueltos.error;
        if (resEspera.error) throw resEspera.error;

        const turnosAtendidos = resAtendidos.data || [];
        const turnosDevueltos = resDevueltos.data || [];
        const turnosEspera = resEspera.data || [];

        // Actualizar UI de contadores
        const turnosAtendidosElement = document.getElementById('turnos-atendidos');
        if (turnosAtendidosElement) turnosAtendidosElement.textContent = turnosAtendidos.length;

        const ingresos = turnosAtendidos.reduce((total, turno) => total + (turno.monto_cobrado || 0), 0);
        const ingresosHoy = document.getElementById('ingresos-hoy');
        if (ingresosHoy) ingresosHoy.textContent = `RD$${ingresos.toFixed(2)}`;

        const promedioCobro = document.getElementById('promedio-cobro');
        if (promedioCobro && turnosAtendidos.length > 0) {
            const promedio = ingresos / turnosAtendidos.length;
            promedioCobro.textContent = `RD$${promedio.toFixed(2)}`;
        }

        // Preparar datos para el gráfico
        const ctx = document.getElementById('estadisticasChart');
        if (!ctx) return;

        const turnosPorHora = {};
        const horasDelDia = [];
        for (let i = 8; i <= 20; i++) {
            const hora = i < 10 ? `0${i}:00` : `${i}:00`;
            horasDelDia.push(hora);
            turnosPorHora[hora] = { atendidos: 0, devueltos: 0, espera: 0 };
        }

        const procesarTurnos = (lista, tipo) => {
            lista.forEach(turno => {
                const hora = turno.hora.slice(0, 5);
                const horaRedondeada = `${hora.slice(0, 2)}:00`;
                if (turnosPorHora[horaRedondeada]) {
                    turnosPorHora[horaRedondeada][tipo]++;
                }
            });
        };

        procesarTurnos(turnosAtendidos, 'atendidos');
        procesarTurnos(turnosDevueltos, 'devueltos');
        procesarTurnos(turnosEspera, 'espera');

        const datosAtendidos = horasDelDia.map(hora => turnosPorHora[hora].atendidos);
        const datosDevueltos = horasDelDia.map(hora => turnosPorHora[hora].devueltos);
        const datosEspera = horasDelDia.map(hora => turnosPorHora[hora].espera);

        if (chart) chart.destroy();
        
        chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: horasDelDia,
                datasets: [
                    { label: 'Atendidos', data: datosAtendidos, backgroundColor: 'rgba(34, 197, 94, 0.5)', borderColor: 'rgb(34, 197, 94)', borderWidth: 1 },
                    { label: 'Devueltos', data: datosDevueltos, backgroundColor: 'rgba(239, 68, 68, 0.5)', borderColor: 'rgb(239, 68, 68)', borderWidth: 1 },
                    { label: 'En Espera', data: datosEspera, backgroundColor: 'rgba(245, 158, 11, 0.5)', borderColor: 'rgb(245, 158, 11)', borderWidth: 1 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { color: document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#374151' } },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    x: { ticks: { color: document.documentElement.classList.contains('dark') ? '#9ca3af' : '#4b5563' }, grid: { color: document.documentElement.classList.contains('dark') ? 'rgba(75, 85, 99, 0.2)' : 'rgba(209, 213, 219, 0.2)' } },
                    y: { beginAtZero: true, ticks: { precision: 0, color: document.documentElement.classList.contains('dark') ? '#9ca3af' : '#4b5563' }, grid: { color: document.documentElement.classList.contains('dark') ? 'rgba(75, 85, 99, 0.2)' : 'rgba(209, 213, 219, 0.2)' } }
                }
            }
        });

    } catch (error) {
        console.error('Error al cargar estadísticas:', error.message);
        // Evitar spam de alertas si es error de JWT, solo loguear
        if (error.message && (error.message.includes('JWT') || error.code === '401')) {
            console.warn('Sesión expirada en estadísticas, esperando recarga...');
        }
    }
}

let canalTurnos = null;
function suscribirseTurnos() {
    if (canalTurnos) {
        supabase.removeChannel(canalTurnos);
    }
    canalTurnos = supabase
        .channel(`turnos-admin-${negocioId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'turnos', filter: `negocio_id=eq.${negocioId}` },
            () => { refrescarUI(); }
        )
        .subscribe();
}

let canalCitas = null;
function suscribirseCitas() {
    if (canalCitas) {
        supabase.removeChannel(canalCitas);
    }
    canalCitas = supabase
        .channel(`citas-admin-${negocioId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'citas', filter: `negocio_id=eq.${negocioId}` },
            () => { refrescarUI(); }
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
    const turnosEnEspera = dataRender.filter(turno => turno.estado === 'En espera');
    
    if (turnosEnEspera.length === 0) {
        console.log('No hay turnos en espera para notificar avance de fila');
        return;
    }

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

            const { data, error } = await supabase.functions.invoke('send-push-notification', {
                body: {
                    telefono: turno.telefono,
                    negocio_id: negocioId,
                    message: {
                        title: `Turno ${turno.turno} - ${turno.nombre}`,
                        body: mensaje,
                        data: {
                            url: '/usuario_barberia005.html',
                            posicion: posicionEnFila,
                            turno: turno.turno
                        }
                    }
                }
            });

            if (error) {
                console.error(`Error notificando a ${turno.nombre}:`, error.message);
            } else if (data.success) {
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
    // dataRender es el array de turnos en espera, ya ordenado.
    // El turno que se acaba de llamar estaba en el índice 0. El siguiente es el del índice 1.
    const siguienteTurno = dataRender.length > 1 ? dataRender[1] : null;

    if (!siguienteTurno || !siguienteTurno.telefono) {
        console.log('No hay siguiente turno en la cola para notificar.');
        return;
    }

    try {
        console.log(`Intentando notificar al siguiente en cola: ${siguienteTurno.nombre} (${siguienteTurno.telefono})`);

        const { data, error } = await supabase.functions.invoke('send-push-notification', {
            body: {
                telefono: siguienteTurno.telefono,
                negocio_id: negocioId,
                message: {
                    title: `¡Es tu turno, ${siguienteTurno.nombre}!`,
                    body: 'Dirígete al local ahora. Es tu momento.',
                    data: {
                        url: '/usuario_barberia005.html',
                        turno: siguienteTurno.turno
                    }
                }
            }
        });

        if (error) {
            console.error('Error devuelto por la función de notificación:', error.message);
            mostrarNotificacion(`No se pudo notificar a ${siguienteTurno.nombre}.`, 'warning');
            return;
        }

        if (data.success) {
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

        const { data, error } = await supabase.functions.invoke('send-push-notification', {
            body: {
                telefono: telefono,
                negocio_id: negocioId,
                message: {
                    title: `¡Turno confirmado, ${nombre}!`,
                    body: `Tu turno ${turno} ha sido registrado exitosamente. Te notificaremos cuando sea tu momento.`
                }
            }
        });

        if (error) {
            console.error('Error al notificar turno tomado:', error.message);
            return;
        }

        if (data.success) {
            console.log(`Notificación de turno tomado enviada a ${nombre}`);
        } else {
            console.error(`Error al enviar notificación de turno tomado: ${data.error}`);
        }

    } catch (invokeError) {
        console.error('Error al invocar notificación de turno tomado:', invokeError);
    }
}

async function atenderAhora() {
    // 5. Seguridad: Evitar doble clic en "Atender"
    if (window.__atendiendo) return;
    window.__atendiendo = true;

    if (!turnoActual) {
        mostrarNotificacion('No hay turno en espera.', 'warning');
        window.__atendiendo = false;
        return;
    }
    let barberId = null;
    try {
        const { data } = await supabase
            .from('barberos')
            .select('id,nombre,usuario,activo')
            .eq('negocio_id', negocioId)
            .eq('activo', true)
            .order('nombre', { ascending: true });
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
        const box = document.createElement('div');
        box.className = 'bg-white dark:bg-gray-800 p-6 rounded-xl w-full max-w-md';
        box.innerHTML = `
          <h3 class="text-lg font-bold mb-4">Seleccionar Barbero</h3>
          <select id="selBarberoAtencion" class="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white mb-4">
            ${(data || []).map(b => `<option value="${b.id}">${b.nombre || b.usuario}</option>`).join('')}
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
                document.body.removeChild(overlay);
                resolve();
            });
            document.getElementById('cancelBarbero').addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve();
            });
        });
    } catch {}
    const ahora = new Date();
    const ventanaMin = 10;
    let citaPrioritaria = null;
    if (barberId) {
        citaPrioritaria = (citasHoy || []).find(c => {
            const start = new Date(c.start_at);
            const end = new Date(c.end_at);
            const inicioVentana = new Date(start.getTime() - ventanaMin * 60000);
            return c.barber_id === barberId && ahora >= inicioVentana && ahora <= end && (c.estado === 'Programada' || !c.estado);
        });
    }
    if (citaPrioritaria) {
        const { error } = await supabase
            .from('citas')
            .update({ estado: 'En atención', updated_at: new Date().toISOString() })
            .eq('id', citaPrioritaria.id)
            .eq('estado', 'Programada');
        if (error) {
            mostrarNotificacion('Error al atender cita: ' + error.message, 'error');
            window.__atendiendo = false;
            return;
        }
        mostrarNotificacion('Atendiendo cita programada', 'success');
        refrescarUI();
        window.__atendiendo = false;
        return;
    }
    const payloadUpdate = { estado: 'En atención', started_at: new Date().toISOString() };
    if (barberId) payloadUpdate.barber_id = barberId;
    const { error } = await supabase
        .from('turnos')
        .update(payloadUpdate)
        .eq('id', turnoActual.id)
        .eq('estado', 'En espera');
    if (error) {
        mostrarNotificacion('Error al atender: ' + error.message, 'error');
        window.__atendiendo = false;
        return;
    }
    mostrarNotificacion(`Atendiendo turno ${turnoActual.turno}`, 'success');

    // Notificar avance de fila a todos los clientes en espera
    await notificarAvanceFila();

    refrescarUI();
    window.__atendiendo = false;
}

function renderCitas() {
    const contHoy = document.getElementById('listaCitasHoy');
    const contFut = document.getElementById('listaCitasFuturas');
    const cntHoy = document.getElementById('contador-citas-hoy');
    const cntFut = document.getElementById('contador-citas-futuras');
    if (cntHoy) cntHoy.textContent = `${(citasHoy || []).length} citas`;
    if (cntFut) cntFut.textContent = `${(citasFuturas || []).length} citas`;
    if (contHoy) {
        contHoy.innerHTML = '';
        (citasHoy || []).forEach(c => {
            const start = new Date(c.start_at);
            const end = new Date(c.end_at);
            const dur = Math.max(0, Math.round((end - start) / 60000));
            const bName = barberosMap[c.barber_id] || `#${c.barber_id}`;
            const card = document.createElement('div');
            card.className = 'bg-emerald-50 dark:bg-emerald-900/30 p-4 rounded-lg shadow-sm border border-emerald-100 dark:border-emerald-800 transition-all';
            card.innerHTML = `
              <div class="flex justify-between items-start">
                <span class="text-2xl font-bold text-emerald-700 dark:text-emerald-400">${start.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</span>
                <span class="text-xs bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded-full">${bName}</span>
              </div>
              <p class="text-gray-700 dark:text-gray-300 font-medium mt-2 truncate">${c.cliente_telefono || ''}</p>
              <div class="flex justify-between items-center mt-3">
                <span class="text-xs text-gray-500 dark:text-gray-400">Hasta ${end.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</span>
                <span class="text-xs text-gray-500 dark:text-gray-400">${dur} min</span>
              </div>`;
            contHoy.appendChild(card);
        });
    }
    if (contFut) {
        contFut.innerHTML = '';
        (citasFuturas || []).forEach(c => {
            const start = new Date(c.start_at);
            const end = new Date(c.end_at);
            const bName = barberosMap[c.barber_id] || `#${c.barber_id}`;
            const card = document.createElement('div');
            card.className = 'bg-violet-50 dark:bg-violet-900/30 p-4 rounded-lg shadow-sm border border-violet-100 dark:border-violet-800 transition-all';
            card.innerHTML = `
              <div class="flex justify-between items-start">
                <span class="text-2xl font-bold text-violet-700 dark:text-violet-400">${start.toLocaleDateString('es-ES')} ${start.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</span>
                <span class="text-xs bg-violet-200 dark:bg-violet-800 text-violet-800 dark:text-violet-200 px-2 py-0.5 rounded-full">${bName}</span>
              </div>
              <p class="text-gray-700 dark:text-gray-300 font-medium mt-2 truncate">${c.cliente_telefono || ''}</p>`;
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

    const { error } = await supabase
        .from('turnos')
        .update({
            estado: 'Atendido',
            monto_cobrado: monto,
            metodo_pago: metodoPago,
            ended_at: new Date().toISOString()
        })
        .eq('id', activeTurnIdForPayment);
    if (error) {
        mostrarNotificacion('Error al guardar el pago: ' + error.message, 'error');
        return;
    }
    cerrarModalPago();
    mostrarNotificacion(`Turno finalizado con cobro de RD$${monto}`, 'success');
    
    // Notificar avance de fila después de completar un turno
    await notificarAvanceFila();
    
    refrescarUI();
}

async function devolverTurno() {
    if (!turnoActual) {
        mostrarNotificacion('No hay turno que devolver.', 'warning');
        return;
    }
    if (!confirm(`¿Enviar el turno ${turnoActual.turno} al final de la cola?`)) {
        return;
    }
    const hoy = new Date().toISOString().slice(0, 10);
    const { data: maxData, error: maxErr } = await supabase
        .from('turnos')
        .select('orden')
        .eq('negocio_id', negocioId)
        .eq('fecha', hoy)
        .order('orden', { ascending: false })
        .limit(1);
    if (maxErr) {
        mostrarNotificacion('Error al devolver turno: ' + maxErr.message, 'error');
        return;
    }
    const nextOrden = (maxData && maxData.length ? maxData[0].orden : 0) + 1;
    const { error } = await supabase
        .from('turnos')
        .update({ orden: nextOrden })
        .eq('id', turnoActual.id)
        .eq('estado', 'En espera');
    if (error) {
        mostrarNotificacion('Error al devolver turno: ' + error.message, 'error');
        return;
    }
    mostrarNotificacion(`Turno ${turnoActual.turno} enviado al final de la cola`, 'info');
    refrescarUI();
}

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
        if (turnoActual && turnoActual.nombre) {
            const texto = `El siguiente turno es de ${turnoActual.nombre}.`;
            hablar(texto);
            mostrarNotificacion(texto, 'success');
        } else {
            const texto = 'No hay más turnos en espera.';
            hablar(texto);
            mostrarNotificacion(texto, 'warning');
        }
    } else if (comandosAtender.some(cmd => transcript.includes(cmd))) {
        if (turnoActual) {
            hablar(`Atendiendo a ${turnoActual.nombre}.`);
            atenderAhora();
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
    const card = event.target.closest('.bg-blue-50');
    if (!card) return;

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
                    .delete()
                    .eq('id', turnId);

                if (error) throw error;

                mostrarNotificacion('Turno eliminado con éxito.', 'success');
                refrescarUI();
            } catch (error) {
                console.error('Error al eliminar turno:', error);
                mostrarNotificacion('Error al eliminar el turno.', 'error');
            }
        }
    });
}
