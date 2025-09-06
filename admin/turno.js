import { supabase } from '../database.js';

let turnoActual = null;
let dataRender = []; // Cache of waiting list turns for reordering
let HORA_APERTURA = "08:00";
let HORA_LIMITE_TURNOS = "23:00";
let LIMITE_TURNOS = 50;
let chart = null;
let ALLOWED_DAYS = [1, 2, 3, 4, 5, 6];
let activeTurnIntervals = {};
let serviciosCache = {};

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
    if (__refreshTimer) return;
    __refreshTimer = setTimeout(async () => {
        __refreshTimer = null;
        await cargarTurnos();
        await cargarEstadisticas();
    }, 300);
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

document.addEventListener('DOMContentLoaded', async () => {
    if (!negocioId) return;
    initThemeToggle();
    actualizarFechaHora();
    setInterval(actualizarFechaHora, 60000);
    await cargarHoraLimite();
    await cargarServicios();
    refrescarUI();
    document.getElementById('refrescar-turnos')?.addEventListener('click', () => {
        refrescarUI();
        mostrarNotificacion('Turnos actualizados', 'success');
    });
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const sidebar = document.getElementById('sidebar');
    document.getElementById('listaEspera')?.addEventListener('click', handleReorderClick);
    document.getElementById('listaEspera')?.addEventListener('dblclick', handleDoubleClickDelete);
    document.getElementById('listaAtencion')?.addEventListener('click', (e) => {
        const card = e.target.closest('.turn-card-atencion');
        if (card && card.dataset.id) {
            abrirModalPago(card.dataset.id);
        }
    });
    document.getElementById('formPago')?.addEventListener('submit', guardarPago);
    const overlay = document.getElementById('sidebar-overlay');
    mobileMenuButton?.addEventListener('click', toggleMobileMenu);
    overlay?.addEventListener('click', toggleMobileMenu);
    function toggleMobileMenu() {
        sidebar.classList.toggle('-translate-x-full');
        overlay.classList.toggle('opacity-0');
        overlay.classList.toggle('pointer-events-none');
    }
    suscribirseTurnos();
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

async function handleReorderClick(event) {
    const button = event.target.closest('.btn-subir, .btn-bajar');
    if (!button) return;
    const isSubir = button.classList.contains('btn-subir');
    const turnId = button.dataset.id;
    const currentIndex = dataRender.findIndex(t => t.id == turnId);
    if (currentIndex === -1) return;
    const otherIndex = isSubir ? currentIndex - 1 : currentIndex + 1;
    if (otherIndex < 0 || otherIndex >= dataRender.length) return;
    const currentTurn = dataRender[currentIndex];
    const otherTurn = dataRender[otherIndex];
    if (!confirm(`¿Seguro que quieres mover el turno ${currentTurn.turno}?`)) return;
    const updates = [
        supabase.from('turnos').update({ orden: otherTurn.orden }).eq('id', currentTurn.id),
        supabase.from('turnos').update({ orden: currentTurn.orden }).eq('id', otherTurn.id)
    ];
    try {
        const results = await Promise.all(updates);
        const hasError = results.some(res => res.error);
        if (hasError) throw new Error('Una de las actualizaciones falló.');
        mostrarNotificacion('Turnos reordenados con éxito.', 'success');
        await refrescarUI();
    } catch (error) {
        console.error('Error al reordenar turnos:', error);
        mostrarNotificacion('Error al reordenar los turnos.', 'error');
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
        fecha: hoy
    }]);
    if (error) {
        mostrarNotificacion('Error al guardar turno: ' + error.message, 'error');
        console.error(error);
        return;
    }
    cerrarModal();
    mostrarNotificacion(`Turno ${nuevoTurno} registrado para ${nombre}`, 'success');
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
    Object.values(activeTurnIntervals).forEach(clearInterval);
    activeTurnIntervals = {};
    const hoy = new Date().toISOString().slice(0, 10);
    const { data: enAtencion } = await supabase
        .from('turnos')
        .select('*')
        .eq('estado', 'En atención')
        .eq('negocio_id', negocioId)
        .eq('fecha', hoy)
        .order('started_at', { ascending: true });
    const { data, error } = await supabase
        .from('turnos')
        .select('*')
        .eq('estado', 'En espera')
        .eq('negocio_id', negocioId)
        .eq('fecha', hoy)
        .order('orden', { ascending: true })
        .order('created_at', { ascending: true });
    if (error) {
        mostrarNotificacion('Error al cargar turnos', 'error');
        return;
    }
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
    for (let index = 0; index < dataRender.length; index++) {
        const t = dataRender[index];
        const div = document.createElement('div');
        div.className = 'bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg shadow-sm border border-blue-100 dark:border-blue-800 transition-all hover:shadow-md cursor-pointer';
        div.dataset.id = t.id;
        div.dataset.nombre = t.nombre;
        div.dataset.turno = t.turno;
        const horaCreacion = new Date(`${t.fecha}T${t.hora}`);
        const ahora = new Date();
        const minutosEsperaReal = Math.floor((ahora - horaCreacion) / 60000);
        const tiempoEstimadoHasta = await calcularTiempoEstimadoTotal(t.turno);
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
        <button class="btn-subir p-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-full disabled:opacity-50" data-id="${t.id}" data-orden="${t.orden}" ${index === 0 ? 'disabled' : ''}>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg>
        </button>
        <button class="btn-bajar p-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-full disabled:opacity-50" data-id="${t.id}" data-orden="${t.orden}" ${index === dataRender.length - 1 ? 'disabled' : ''}>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7 7"></path></svg>
        </button>
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
    turnoActual = (dataRender.length > 0) ? dataRender[0] : null;
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
}

async function cargarEstadisticas() {
    if (!negocioId) return;
    const hoy = new Date().toISOString().slice(0, 10);
    const { data: turnosAtendidos, error: errorAtendidos } = await supabase
        .from('turnos')
        .select('*')
        .eq('estado', 'Atendido')
        .eq('negocio_id', negocioId)
        .eq('fecha', hoy);
    if (errorAtendidos) {
        console.error('Error al cargar estadísticas:', errorAtendidos.message);
        return;
    }
    const { data: turnosDevueltos, error: errorDevueltos } = await supabase
        .from('turnos')
        .select('*')
        .eq('estado', 'Devuelto')
        .eq('negocio_id', negocioId)
        .eq('fecha', hoy);
    if (errorDevueltos) {
        console.error('Error al cargar estadísticas de turnos devueltos:', errorDevueltos.message);
        return;
    }
    const turnosAtendidosElement = document.getElementById('turnos-atendidos');
    if (turnosAtendidosElement) {
        turnosAtendidosElement.textContent = turnosAtendidos.length;
    }
    const ingresos = turnosAtendidos.reduce((total, turno) => total + (turno.monto_cobrado || 0), 0);
    const ingresosHoy = document.getElementById('ingresos-hoy');
    if (ingresosHoy) {
        ingresosHoy.textContent = `RD$${ingresos.toFixed(2)}`;
    }
    const promedioCobro = document.getElementById('promedio-cobro');
    if (promedioCobro && turnosAtendidos.length > 0) {
        const promedio = ingresos / turnosAtendidos.length;
        promedioCobro.textContent = `RD$${promedio.toFixed(2)}`;
    }
    const ctx = document.getElementById('estadisticasChart');
    if (!ctx) return;
    const turnosPorHora = {};
    const horasDelDia = [];
    for (let i = 8; i <= 20; i++) {
        const hora = i < 10 ? `0${i}:00` : `${i}:00`;
        horasDelDia.push(hora);
        turnosPorHora[hora] = { atendidos: 0, devueltos: 0, espera: 0 };
    }
    turnosAtendidos.forEach(turno => {
        const hora = turno.hora.slice(0, 5);
        const horaRedondeada = `${hora.slice(0, 2)}:00`;
        if (turnosPorHora[horaRedondeada]) {
            turnosPorHora[horaRedondeada].atendidos++;
        }
    });
    turnosDevueltos.forEach(turno => {
        const hora = turno.hora.slice(0, 5);
        const horaRedondeada = `${hora.slice(0, 2)}:00`;
        if (turnosPorHora[horaRedondeada]) {
            turnosPorHora[horaRedondeada].devueltos++;
        }
    });
    const { data: turnosEspera, error: errorEspera } = await supabase
        .from('turnos')
        .select('*')
        .eq('estado', 'En espera')
        .eq('negocio_id', negocioId)
        .eq('fecha', hoy);
    if (!errorEspera && turnosEspera) {
        turnosEspera.forEach(turno => {
            const hora = turno.hora.slice(0, 5);
            const horaRedondeada = `${hora.slice(0, 2)}:00`;
            if (turnosPorHora[horaRedondeada]) {
                turnosPorHora[horaRedondeada].espera++;
            }
        });
    }
    const datosAtendidos = horasDelDia.map(hora => turnosPorHora[hora].atendidos);
    const datosDevueltos = horasDelDia.map(hora => turnosPorHora[hora].devueltos);
    const datosEspera = horasDelDia.map(hora => turnosPorHora[hora].espera);
    if (chart) {
        chart.destroy();
    }
    chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: horasDelDia,
            datasets: [{
                label: 'Atendidos',
                data: datosAtendidos,
                backgroundColor: 'rgba(34, 197, 94, 0.5)',
                borderColor: 'rgb(34, 197, 94)',
                borderWidth: 1
            }, {
                label: 'Devueltos',
                data: datosDevueltos,
                backgroundColor: 'rgba(239, 68, 68, 0.5)',
                borderColor: 'rgb(239, 68, 68)',
                borderWidth: 1
            }, {
                label: 'En Espera',
                data: datosEspera,
                backgroundColor: 'rgba(245, 158, 11, 0.5)',
                borderColor: 'rgb(245, 158, 11)',
                borderWidth: 1
            }]
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

async function atenderAhora() {
    if (!turnoActual) {
        mostrarNotificacion('No hay turno en espera.', 'warning');
        return;
    }
    const { error } = await supabase
        .from('turnos')
        .update({ estado: 'En atención', started_at: new Date().toISOString() })
        .eq('id', turnoActual.id)
        .eq('estado', 'En espera');
    if (error) {
        mostrarNotificacion('Error al atender: ' + error.message, 'error');
        return;
    }
    mostrarNotificacion(`Atendiendo turno ${turnoActual.turno}`, 'success');
    refrescarUI();
}

async function guardarPago(event) {
    event.preventDefault();
    if (!activeTurnIdForPayment) return;
    const monto = parseFloat(document.getElementById('montoCobrado').value);
    const metodoPago = document.querySelector('input[name="metodo_pago"]:checked').value;
    const { error } = await supabase
        .from('turnos')
        .update({
            estado: 'Atendido',
            monto_cobrado: monto,
            metodo_pago: metodoPago
        })
        .eq('id', activeTurnIdForPayment);
    if (error) {
        mostrarNotificacion('Error al guardar el pago: ' + error.message, 'error');
        return;
    }
    cerrarModalPago();
    mostrarNotificacion(`Turno finalizado con cobro de RD$${monto}`, 'success');
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
