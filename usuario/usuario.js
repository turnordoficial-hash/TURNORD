import { supabase } from '../database.js';

/**
 * Obtiene el ID del negocio desde el atributo `data-negocio-id` en el body.
 * @returns {string|null} El ID del negocio o null si no está presente.
 */
function getNegocioId() {
    const id = document.body.dataset.negocioId;
    if (!id) {
        console.error('Error crítico: Atributo data-negocio-id no encontrado en el body.');
        alert('Error de configuración: No se pudo identificar la página del negocio.');
    }
    return id;
}

const negocioId = getNegocioId();

// Estado en memoria/localStorage
let turnoAsignado = null;
let intervaloContador = null;
let telefonoUsuario = localStorage.getItem(`telefonoUsuario_${negocioId}`) || null;
let configCache = {};
let serviciosCache = {};

function getDeadlineKey(turno) {
    return `turnoDeadline:${negocioId}:${turno}`;
}

// Clave pública VAPID - ¡Esta clave debe ser generada y almacenada de forma segura!
// Es seguro exponerla en el lado del cliente.
const VAPID_PUBLIC_KEY = 'BC5jD225d3BEpkV1E_gQSv2hSRn2kX2h5lVfIYG3_k2Z7Fq5ZzXVy7i_h5kHl-bO3F4GfI8aZ3E2Xl8Yk9ZzC7Q';

/**
 * Registra el Service Worker.
 */
function registrarServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('Service Worker registrado con éxito:', registration);
      })
      .catch(error => {
        console.error('Error al registrar el Service Worker:', error);
      });
  }
}

/**
 * Convierte la clave VAPID de base64 a un Uint8Array.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Guarda la suscripción en la base de datos.
 * @param {PushSubscription} subscription - El objeto de suscripción.
 */
async function guardarSuscripcion(subscription) {
  if (!telefonoUsuario || !negocioId) return;

  try {
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({
        user_id: telefonoUsuario, // Usamos el teléfono como ID de usuario
        subscription: subscription,
        negocio_id: negocioId
      }, {
        onConflict: 'user_id, negocio_id' // Si ya existe, actualiza la suscripción
      });

    if (error) throw error;
    console.log('Suscripción guardada en la base de datos.');
  } catch (error) {
    console.error('Error al guardar la suscripción:', error);
  }
}


/**
 * Solicita permiso para notificaciones y crea la suscripción push.
 */
async function solicitarPermisoNotificacion() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('Las notificaciones push no son soportadas por este navegador.');
        return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        console.log('Permiso para notificaciones no concedido.');
        return;
    }

    console.log('Permiso para notificaciones concedido.');

    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });

        console.log('Suscripción push obtenida:', subscription);
        await guardarSuscripcion(subscription);
    } catch (error) {
        console.error('Error al suscribirse a las notificaciones push:', error);
    }
}

/**
 * Envía una notificación al usuario si los permisos están concedidos.
 * @param {object} turnoData - Datos del turno del usuario (debe incluir `turno` y `nombre`).
 */
function enviarNotificacion(turnoData) {
    const notificationKey = `notification_sent_${negocioId}_${turnoData.turno}`;
    if (localStorage.getItem(notificationKey)) {
        return; // Notificación ya enviada para este turno.
    }

    if (Notification.permission === "granted") {
        const title = `¡Prepárate, ${turnoData.nombre}!`;
        const options = {
            body: 'Queda 1 persona antes que tú. ¡Ya puedes venir a la barbería!',
            icon: 'imegenlogin/android-chrome-192x192.png',
            badge: 'imegenlogin/favicon-32x32.png',
            tag: `turno-aviso-${negocioId}` // Evita notificaciones apiladas.
        };

        new Notification(title, options);
        localStorage.setItem(notificationKey, 'true');
    }
}

/**
 * Verifica la posición del usuario en la cola y notifica si es el próximo.
 */
async function checkTurnoPositionAndNotify() {
    if (!telefonoUsuario || !turnoAsignado) return;

    try {
        const { data: enEspera, error } = await supabase
            .from('turnos')
            .select('turno, nombre')
            .eq('negocio_id', negocioId)
            .eq('fecha', obtenerFechaActual())
            .eq('estado', 'En espera')
            .order('orden', { ascending: true })
            .order('created_at', { ascending: true });

        if (error) throw error;

        const miTurnoIndex = enEspera.findIndex(t => t.turno === turnoAsignado);

        // Notificar si queda 1 persona delante (índice 1) o si es el primero en espera (índice 0)
        // Esto cubre más casos, por ejemplo, si el barbero está libre.
        if (miTurnoIndex === 1 || miTurnoIndex === 0) {
            enviarNotificacion(enEspera[miTurnoIndex]);
        }
    } catch (error) {
        console.error("Error al verificar la posición del turno para notificar:", error);
    }
}


async function cargarServiciosActivos() {
    if (!negocioId) return;
    try {
        const { data, error } = await supabase
            .from('servicios')
            .select('nombre,duracion_min')
            .eq('negocio_id', negocioId)
            .eq('activo', true)
            .order('nombre', { ascending: true });
        if (error) throw error;
        serviciosCache = {};
        (data || []).forEach(s => { serviciosCache[s.nombre] = s.duracion_min; });
        const sel = document.querySelector('select[name="tipo"]');
        if (sel) {
            sel.innerHTML = '<option value="">Seleccione un servicio</option>' +
                (data || []).map(s => `<option value="${s.nombre}">${s.nombre}</option>`).join('');
        }
    } catch (e) {
        console.warn('No se pudieron cargar servicios activos.', e);
    }
}

function obtenerFechaActual() {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

function obtenerHoraActual() {
    const hoy = new Date();
    return `${String(hoy.getHours()).padStart(2, '0')}:${String(hoy.getMinutes()).padStart(2, '0')}`;
}

function cerrarModal() {
    document.getElementById('modal')?.classList.add('hidden');
}

async function obtenerConfig() {
    if (!negocioId) return null;
    try {
        const { data, error } = await supabase
            .from('configuracion_negocio')
            .select('hora_apertura, hora_cierre, limite_turnos, mostrar_tiempo_estimado')
            .eq('negocio_id', negocioId)
            .single();
        if (error) throw error;
        if (data) configCache = { ...configCache, ...data };
        return data;
    } catch (error) {
        console.error('Error al obtener configuración:', error.message);
        return null;
    }
}

async function contarTurnosDia(fechaISO) {
    if (!negocioId) return 0;
    const { count, error } = await supabase
        .from('turnos')
        .select('id', { count: 'exact', head: true })
        .eq('negocio_id', negocioId)
        .eq('fecha', fechaISO);
    if (error) throw new Error(error.message);
    return count || 0;
}

async function verificarBreakNegocio() {
    if (!negocioId) return { enBreak: false, mensaje: null };
    try {
        const { data, error } = await supabase
            .from('estado_negocio')
            .select('en_break, break_end_time, break_message')
            .eq('negocio_id', negocioId)
            .single();
        if (error && error.code !== 'PGRST116') return { enBreak: false, mensaje: null };
        if (data && data.en_break) {
            const endTime = new Date(data.break_end_time);
            if (endTime > new Date()) {
                return { enBreak: true, mensaje: data.break_message || 'En break.', tiempoRestante: Math.ceil((endTime - new Date()) / 60000) };
            }
        }
        return { enBreak: false, mensaje: null };
    } catch (error) {
        console.error('Error al verificar break:', error);
        return { enBreak: false, mensaje: null };
    }
}

function mostrarNotificacionBreak(mensaje, tiempoRestante) {
    const notificacion = document.createElement('div');
    notificacion.className = 'fixed top-4 right-4 bg-orange-500 text-white p-4 rounded-lg shadow-lg z-50 max-w-sm';
    notificacion.innerHTML = `<div class="flex items-start space-x-3"><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><div><h4 class="font-semibold mb-1">Negocio en Break</h4><p class="text-sm mb-2">${mensaje}</p><p class="text-xs opacity-90">Tiempo estimado: ${tiempoRestante} minutos</p></div><button onclick="this.parentElement.parentElement.remove()" class="text-white hover:text-gray-200 ml-2"><svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button></div>`;
    document.body.appendChild(notificacion);
    setTimeout(() => { if (notificacion.parentElement) notificacion.remove(); }, 8000);
}

async function verificarDiaLaboralFecha(fecha = new Date()) {
    if (!negocioId) return false;
    try {
        const { data, error } = await supabase
            .from('configuracion_negocio')
            .select('dias_operacion')
            .eq('negocio_id', negocioId)
            .single();
        if (error) return true; // Permitir por defecto si no hay config
        if (!data || !Array.isArray(data.dias_operacion) || data.dias_operacion.length === 0) return false;
        const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        return data.dias_operacion.includes(diasSemana[fecha.getDay()]);
    } catch (error) {
        return true;
    }
}

function obtenerLetraDelDia() {
    const hoy = new Date();
    const fechaBase = new Date('2024-08-23');
    const diferenciaDias = Math.floor((hoy - fechaBase) / (1000 * 60 * 60 * 24));
    return String.fromCharCode(65 + ((diferenciaDias % 26) + 26) % 26);
}

async function generarNuevoTurno() {
    if (!negocioId) return 'A01';
    const letraHoy = obtenerLetraDelDia();
    const fechaHoy = obtenerFechaActual();
    const { data, error } = await supabase
        .from('turnos')
        .select('turno')
        .eq('negocio_id', negocioId)
        .eq('fecha', fechaHoy)
        .like('turno', `${letraHoy}%`)
        .order('created_at', { ascending: false })
        .limit(1);
    if (error || !data || data.length === 0) return `${letraHoy}01`;
    const ultimo = data[0].turno || `${letraHoy}00`;
    const numero = parseInt(ultimo.substring(1), 10) + 1;
    return `${letraHoy}${String(numero).padStart(2, '0')}`;
}

async function verificarTurnoActivo() {
    if (!telefonoUsuario || !negocioId) return false;
    const { data, error } = await supabase
        .from('turnos')
        .select('*')
        .eq('negocio_id', negocioId)
        .eq('estado', 'En espera')
        .eq('telefono', telefonoUsuario)
        .order('created_at', { ascending: false });
    if (error || !data || data.length === 0) return false;
    solicitarPermisoNotificacion(); // Solicitar permiso si hay un turno activo
    turnoAsignado = data[0].turno;
    await mostrarMensajeConfirmacion(data[0]);
    return true;
}

async function calcularTiempoEstimadoTotal(turnoObjetivo = null) {
    if (!negocioId) return 0;
    let tiempoTotal = 0;
    try {
        const { data: enAtencion } = await supabase.from('turnos').select('servicio, started_at').eq('negocio_id', negocioId).eq('fecha', obtenerFechaActual()).eq('estado', 'En atención').order('started_at', { ascending: true }).limit(1);
        if (enAtencion && enAtencion.length) {
            const duracionTotal = serviciosCache[enAtencion[0].servicio] || 25;
            const inicio = enAtencion[0].started_at ? new Date(enAtencion[0].started_at) : null;
            tiempoTotal = inicio ? Math.max(duracionTotal - Math.floor((Date.now() - inicio.getTime()) / 60000), 0) : duracionTotal;
        }
        const { data: cola } = await supabase.from('turnos').select('turno, servicio').eq('negocio_id', negocioId).eq('estado', 'En espera').order('orden', { ascending: true }).order('created_at', { ascending: true });
        if (cola && cola.length) {
            const limite = turnoObjetivo ? cola.findIndex(t => t.turno === turnoObjetivo) : cola.length;
            const turnosASumar = limite === -1 ? cola : cola.slice(0, limite);
            for (const turno of turnosASumar) {
                tiempoTotal += serviciosCache[turno.servicio] || 25;
            }
        }
    } catch (error) {
        console.warn('Error calculando tiempo de espera:', error);
    }
    return tiempoTotal;
}

async function mostrarMensajeConfirmacion(turnoData) {
    const mostrarTiempo = configCache.mostrar_tiempo_estimado !== false;
    const mensajeContenedor = document.getElementById('mensaje-turno');
    if (!mensajeContenedor) return;
    let htmlTiempoEstimado = '';
    if (mostrarTiempo) {
        const deadlineKey = getDeadlineKey(turnoData.turno);
        let deadline = Number(localStorage.getItem(deadlineKey) || 0);
        if (!deadline || deadline <= Date.now()) {
            const minutosEspera = await calcularTiempoEstimadoTotal(turnoData.turno);
            deadline = Date.now() + (minutosEspera * 60 * 1000);
            localStorage.setItem(deadlineKey, String(deadline));
        }
        htmlTiempoEstimado = `⏳ Tiempo estimado: <span id="contador-tiempo"></span><br><br>`;
    }
    mensajeContenedor.innerHTML = `<div class="bg-green-100 text-green-700 rounded-xl p-4 shadow mt-4 text-sm">✅ Hola <strong>${turnoData.nombre}</strong>, tu turno es <strong>${turnoData.turno}</strong>.<br>${htmlTiempoEstimado}<button id="cancelarTurno" class="bg-red-600 text-white px-3 py-1 mt-2 rounded hover:bg-red-700">Cancelar Turno</button></div>`;
    if (mostrarTiempo) {
        const tiempoSpan = document.getElementById('contador-tiempo');
        if (intervaloContador) clearInterval(intervaloContador);
        const deadlineKey = getDeadlineKey(turnoData.turno);
        const deadline = Number(localStorage.getItem(deadlineKey) || 0);
        function actualizarContador() {
            const restante = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            if (tiempoSpan) tiempoSpan.textContent = `${Math.floor(restante / 60)} min ${String(restante % 60).padStart(2, '0')} seg`;
            if (restante <= 0) {
                if (tiempoSpan) tiempoSpan.textContent = '🎉 Prepárate, tu turno está muy cerca.';
                clearInterval(intervaloContador);
            }
        }
        if (deadline > 0) {
            actualizarContador();
            intervaloContador = setInterval(actualizarContador, 1000);
        } else if (tiempoSpan) {
            tiempoSpan.textContent = 'Calculando...';
        }
    }
    document.getElementById('cancelarTurno')?.addEventListener('click', async () => {
        if (!confirm('¿Deseas cancelar tu turno?')) return;
        const { error } = await supabase.from('turnos').update({ estado: 'Cancelado' }).eq('turno', turnoData.turno).eq('negocio_id', negocioId).eq('telefono', telefonoUsuario);
        if (error) {
            alert('Error al cancelar el turno: ' + error.message);
            return;
        }
        // Mostrar un mensaje de cancelación y luego limpiar la UI.
        mensajeContenedor.innerHTML = `<div class="bg-red-100 text-red-700 rounded-xl p-4 shadow mt-4 text-sm">❌ Has cancelado tu turno <strong>${turnoData.turno}</strong>.</div>`;

        // Limpiar estado local
        turnoAsignado = null;
        telefonoUsuario = null;
        if (intervaloContador) clearInterval(intervaloContador);
        localStorage.removeItem(getDeadlineKey(turnoData.turno));
        localStorage.removeItem(`telefonoUsuario_${negocioId}`);

        // Reactivar el botón de tomar turno
        const btnTomarTurno = document.querySelector('button[onclick*="modal"]');
        if (btnTomarTurno) btnTomarTurno.disabled = false;

        // La suscripción en tiempo real de Supabase se encargará de actualizar la vista.
        // Forzamos una actualización local inmediata para el usuario actual.
        await actualizarTurnoActualYConteo();
    });
}

async function actualizarTurnoActualYConteo() {
    if (!negocioId) return;
    const hoy = obtenerFechaActual();
    const { data: enAtencion } = await supabase.from('turnos').select('turno').eq('negocio_id', negocioId).eq('fecha', hoy).eq('estado', 'En atención').order('started_at', { ascending: true }).limit(1);
    let turnoActualTexto = enAtencion && enAtencion.length ? enAtencion[0].turno : null;
    if (!turnoActualTexto) {
        const { data: enEspera } = await supabase.from('turnos').select('turno').eq('negocio_id', negocioId).eq('fecha', hoy).eq('estado', 'En espera').order('created_at', { ascending: true }).limit(1);
        turnoActualTexto = enEspera && enEspera.length ? enEspera[0].turno : null;
    }
    const { count } = await supabase.from('turnos').select('*', { count: 'exact', head: true }).eq('negocio_id', negocioId).eq('fecha', hoy).eq('estado', 'En espera');
    document.getElementById('turno-actual').textContent = turnoActualTexto || `${obtenerLetraDelDia()}00`;
    document.getElementById('conteo-turno').textContent = (count || 0).toString();
}

async function tomarTurnoSimple(nombre, telefono, servicio) {
    if (!negocioId) return;
    if (!(await verificarDiaLaboralFecha(new Date()))) {
        alert('Hoy no es un día laboral.');
        return;
    }
    const estadoBreak = await verificarBreakNegocio();
    if (estadoBreak.enBreak) {
        mostrarNotificacionBreak(estadoBreak.mensaje, estadoBreak.tiempoRestante);
        return;
    }
    const ahora = new Date();
    const horaActual = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
    if (horaActual < configCache.hora_apertura || horaActual > configCache.hora_cierre) {
        alert(`Horario de atención: ${configCache.hora_apertura} - ${configCache.hora_cierre}.`);
        return;
    }
    const fechaHoy = obtenerFechaActual();
    if ((await contarTurnosDia(fechaHoy)) >= configCache.limite_turnos) {
        alert(`Se ha alcanzado el límite de ${configCache.limite_turnos} turnos para hoy.`);
        return;
    }
    telefonoUsuario = telefono;
    localStorage.setItem(`telefonoUsuario_${negocioId}`, telefonoUsuario);
    const { data: turnosActivos } = await supabase.from('turnos').select('*').eq('negocio_id', negocioId).eq('estado', 'En espera').eq('telefono', telefonoUsuario);
    if (turnosActivos && turnosActivos.length > 0) {
        alert('Ya tienes un turno activo.');
        return;
    }
    const nuevoTurno = await generarNuevoTurno();
    const { error } = await supabase.from('turnos').insert([{ negocio_id: negocioId, turno: nuevoTurno, nombre, telefono, servicio, estado: 'En espera', fecha: fechaHoy, hora: obtenerHoraActual() }]);
    if (error) {
        alert('Error al registrar turno: ' + error.message);
        return;
    }
    solicitarPermisoNotificacion(); // Solicitar permiso al tomar un nuevo turno
    turnoAsignado = nuevoTurno;
    await mostrarMensajeConfirmacion({ nombre, turno: nuevoTurno });
    document.getElementById('formRegistroNegocio')?.reset();
    cerrarModal();
    document.querySelector('button[onclick*="modal"]').disabled = true;
    await actualizarTurnoActualYConteo();
}

function simpleSentimentAnalysis(text) {
    if (!text || typeof text !== 'string' || text.trim() === '') {
        return 0;
    }
    const positiveWords = ['bueno', 'bien', 'excelente', 'increíble', 'genial', 'fantástico', 'perfecto', 'rápido', 'amable', 'profesional', 'limpio', 'recomendado', 'satisfecho', 'gracias', 'encantado', 'mejor'];
    const negativeWords = ['malo', 'terrible', 'horrible', 'lento', 'grosero', 'sucio', 'decepcionado', 'nunca', 'jamás', 'problema', 'queja', 'espera', 'tarde'];

    let score = 0;
    const words = text.toLowerCase().replace(/[.,!?;]/g, '').split(/\s+/);

    words.forEach(word => {
        if (positiveWords.includes(word)) {
            score++;
        } else if (negativeWords.includes(word)) {
            score--;
        }
    });

    const normalizedScore = words.length > 0 ? score / words.length : 0;
    return Math.max(-1, Math.min(1, normalizedScore));
}

window.addEventListener('DOMContentLoaded', async () => {
    registrarServiceWorker(); // Registrar el service worker al cargar la página
    if (!negocioId) return;
    await obtenerConfig();
    await cargarServiciosActivos();
    const btnTomarTurno = document.querySelector('button[onclick*="modal"]');
    document.getElementById('btn-cerrar-modal')?.addEventListener('click', cerrarModal);
    const estadoBreakInicial = await verificarBreakNegocio();
    if (btnTomarTurno) {
        btnTomarTurno.disabled = estadoBreakInicial.enBreak;
        btnTomarTurno.classList.toggle('opacity-50', estadoBreakInicial.enBreak);
        btnTomarTurno.classList.toggle('cursor-not-allowed', estadoBreakInicial.enBreak);
        if (estadoBreakInicial.enBreak) mostrarNotificacionBreak(estadoBreakInicial.mensaje, estadoBreakInicial.tiempoRestante);
    }
    const fechaElem = document.getElementById('fecha-de-hoy');
    if (fechaElem) {
        const fechaTexto = new Date().toLocaleDateString('es-DO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        fechaElem.innerHTML = `${fechaTexto} <span class="text-blue-600 dark:text-blue-400 font-bold">(Turnos serie ${obtenerLetraDelDia()})</span>`;
    }
    ['telefono', 'nombre'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.addEventListener('input', () => {
            input.value = id === 'telefono' ? input.value.replace(/[^0-9]/g, '') : input.value.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ ]/g, '');
        });
    });
    if (await verificarTurnoActivo()) {
        if (btnTomarTurno) btnTomarTurno.disabled = true;
    }
    await actualizarTurnoActualYConteo();
    document.getElementById('formRegistroNegocio')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nombre = document.getElementById('nombre')?.value.trim();
        const telefono = document.getElementById('telefono')?.value.trim();
        const servicio = document.getElementById('servicio')?.value;
        if (!nombre || !telefono || !servicio) {
            alert('Por favor complete nombre, teléfono y servicio.');
            return;
        }
        await tomarTurnoSimple(nombre, telefono, servicio);
    });

    const comentarioModal = document.getElementById('comentario-modal');
    const formComentario = document.getElementById('formComentario');
    const btnCerrarComentarioModal = document.getElementById('btn-cerrar-comentario-modal');

    function cerrarComentarioModal() {
        if (comentarioModal) {
            comentarioModal.classList.add('hidden');
            formComentario?.reset();
        }
    }

    function limpiarSesionDeUsuario(turnoNumero) {
        if (turnoNumero) {
            localStorage.removeItem(getDeadlineKey(turnoNumero));
        }
        localStorage.removeItem(`telefonoUsuario_${negocioId}`);
        telefonoUsuario = null;
        turnoAsignado = null;
        if (btnTomarTurno) btnTomarTurno.disabled = false;
        if (intervaloContador) clearInterval(intervaloContador);
    }

    if (formComentario) {
        formComentario.addEventListener('submit', async (e) => {
            e.preventDefault();
            const rating = formComentario.rating.value;
            const comentarioText = formComentario.comentario.value.trim();
            const turnoId = comentarioModal.dataset.turnoId;
            const nombreCliente = comentarioModal.dataset.nombreCliente;
            const telefonoCliente = comentarioModal.dataset.telefonoCliente;

            const sentimiento = simpleSentimentAnalysis(comentarioText);

            try {
                const { error } = await supabase.from('comentarios').insert([
                    {
                        negocio_id: negocioId,
                        turno_id: turnoId,
                        nombre_cliente: nombreCliente,
                        telefono_cliente: telefonoCliente,
                        calificacion: rating,
                        comentario: comentarioText,
                        sentimiento_score: sentimiento
                    }
                ]);
                if (error) throw error;
                alert('¡Gracias por tu comentario!');
            } catch (error) {
                console.error('Error al guardar comentario:', error);
                alert('No se pudo guardar tu comentario. Por favor, inténtalo de nuevo.');
            } finally {
                cerrarComentarioModal();
            }
        });
    }

    if (btnCerrarComentarioModal) {
        btnCerrarComentarioModal.addEventListener('click', () => {
            cerrarComentarioModal();
        });
    }

    supabase.channel(`turnos-usuario-${negocioId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'turnos', filter: `negocio_id=eq.${negocioId}` }, async (payload) => {

        await actualizarTurnoActualYConteo();

        if (telefonoUsuario && turnoAsignado) {

            await checkTurnoPositionAndNotify();

            const { data } = await supabase.from('turnos').select('*').eq('negocio_id', negocioId).eq('telefono', telefonoUsuario).order('created_at', { ascending: false }).limit(1).single();

            if (!data) {
                 limpiarSesionDeUsuario(turnoAsignado);
                 document.getElementById('mensaje-turno').innerHTML = '';
                 return;
            }

            if (data.turno !== turnoAsignado) {
                turnoAsignado = data.turno;
                await mostrarMensajeConfirmacion(data);
                return;
            }

            if (data.estado === 'En atención') {
                document.getElementById('mensaje-turno').innerHTML = `<div class="bg-blue-100 text-blue-700 rounded-xl p-4 shadow mt-4 text-sm">🔔 ¡Es tu turno! <strong>${data.turno}</strong> está siendo atendido.</div>`;
                if (comentarioModal) {
                    comentarioModal.classList.remove('hidden');
                    comentarioModal.dataset.turnoId = data.id;
                    comentarioModal.dataset.nombreCliente = data.nombre;
                    comentarioModal.dataset.telefonoCliente = data.telefono;
                }
            } else if (data.estado === 'Atendido') {
                document.getElementById('mensaje-turno').innerHTML = `<div class="bg-green-100 text-green-700 rounded-xl p-4 shadow mt-4 text-sm">✅ Tu turno <strong>${data.turno}</strong> ha sido completado. ¡Gracias por tu visita!</div>`;
                cerrarComentarioModal();
                limpiarSesionDeUsuario(data.turno);
            } else if (data.estado !== 'En espera') {
                document.getElementById('mensaje-turno').innerHTML = `<div class="bg-gray-100 text-gray-700 rounded-xl p-4 shadow mt-4 text-sm">ℹ️ Tu turno <strong>${data.turno}</strong> ha sido ${data.estado.toLowerCase()}.</div>`;
                cerrarComentarioModal();
                limpiarSesionDeUsuario(data.turno);
            }
        }
    }).subscribe();
    supabase.channel(`servicios-usuario-${negocioId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'servicios', filter: `negocio_id=eq.${negocioId}` }, cargarServiciosActivos).subscribe();
    supabase.channel(`estado-negocio-usuario-${negocioId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'estado_negocio', filter: `negocio_id=eq.${negocioId}` }, async () => {
        const estado = await verificarBreakNegocio();
        if (btnTomarTurno) {
            btnTomarTurno.disabled = estado.enBreak;
            btnTomarTurno.classList.toggle('opacity-50', estado.enBreak);
            btnTomarTurno.classList.toggle('cursor-not-allowed', estado.enBreak);
            if (estado.enBreak) mostrarNotificacionBreak(estado.mensaje, estado.tiempoRestante);
        }
    }).subscribe();
    supabase.channel(`configuracion-negocio-usuario-${negocioId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'configuracion_negocio', filter: `negocio_id=eq.${negocioId}` }, obtenerConfig).subscribe();
});
