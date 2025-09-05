// usuario.js
import { supabase } from '../database.js';
import Config from '../config.js';

// Configuración centralizada del negocio
const negocioConfig = Config.getNegocioConfig();
const negocioId = negocioConfig.id;

// Estado en memoria/localStorage
let turnoAsignado = null;
let intervaloContador = null;
let telefonoUsuario = localStorage.getItem('telefonoUsuario') || null;

// Cache de configuración desde config.js
let HORA_LIMITE_TURNOS = negocioConfig.configuracion.hora_limite_turnos;
let configCache = {
  hora_apertura: negocioConfig.configuracion.hora_apertura,
  hora_cierre: negocioConfig.configuracion.hora_cierre,
  limite_turnos: negocioConfig.configuracion.limite_turnos
};

// Persistencia del deadline del turno para que el contador continúe al volver a la pestaña
function getDeadlineKey(turno) {
  return `turnoDeadline:${negocioId}:${turno}`;
}

// Catálogo de servicios (nombre -> duracion_min)
let serviciosCache = {};
async function cargarServiciosActivos() {
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

// Utilidades de fecha/hora
function obtenerFechaActual() {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

function obtenerHoraActual() {
  const hoy = new Date();
  const horas = String(hoy.getHours()).padStart(2, '0');
  const minutos = String(hoy.getMinutes()).padStart(2, '0');
  return `${horas}:${minutos}`;
}

function cerrarModal() {
  const modal = document.getElementById('modal');
  if (modal) modal.classList.add('hidden');
}

// Conversión HH:MM a minutos totales
function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Obtiene config (apertura, cierre, límite)
async function obtenerConfig() {
  const { data, error } = await supabase
    .from('configuracion_negocio')
    .select('hora_apertura, hora_cierre, limite_turnos, mostrar_tiempo_estimado')
    .eq('negocio_id', negocioId)
    .single();

  if (error) throw new Error(error.message);

  // Actualizar cache
  if (data) {
    configCache = { ...configCache, ...data };
    HORA_LIMITE_TURNOS = data.hora_cierre || HORA_LIMITE_TURNOS;
  }

  return data;
}

// Actualiza la configuración y notifica
async function actualizarConfiguracion() {
  try {
    const config = await obtenerConfig();
    if (config) {
      mostrarNotificacionConfiguracion(
        'Configuración actualizada',
        `Horarios: ${config.hora_apertura} - ${config.hora_cierre} | Límite: ${config.limite_turnos} turnos`
      );
      console.log('Configuración actualizada:', config);
    }
  } catch (error) {
    console.error('Error al actualizar configuración:', error);
  }
}

function mostrarNotificacionConfiguracion(titulo, mensaje) {
  const notificacion = document.createElement('div');
  notificacion.className = 'fixed top-4 right-4 bg-blue-500 text-white px-6 py-4 rounded-lg shadow-lg z-50 max-w-sm';
  notificacion.innerHTML = `
    <div class="flex items-start">
      <div class="flex-shrink-0">
        <svg class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div class="ml-3">
        <p class="text-sm font-medium">${titulo}</p>
        <p class="text-sm text-blue-100 mt-1">${mensaje}</p>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-blue-200 hover:text-white">
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  `;

  document.body.appendChild(notificacion);
  setTimeout(() => { if (notificacion.parentElement) notificacion.remove(); }, 5000);
}

// Cuenta turnos de una fecha YYYY-MM-DD
async function contarTurnosDia(fechaISO) {
  const { count, error } = await supabase
    .from('turnos')
    .select('id', { count: 'exact', head: true })
    .eq('negocio_id', negocioId)
    .eq('fecha', fechaISO);

  if (error) throw new Error(error.message);
  return count || 0;
}

// ===== Verificación de break =====
async function verificarBreakNegocio() {
  try {
    const { data, error } = await supabase
      .from('estado_negocio')
      .select('en_break, break_end_time, break_message')
      .eq('negocio_id', negocioId)
      .single();

    if (error && error.code !== 'PGRST116') {
      return { enBreak: false, mensaje: null };
    }

    if (data && data.en_break) {
      const endTime = new Date(data.break_end_time);
      const now = new Date();
      if (endTime > now) {
        return {
          enBreak: true,
          mensaje: data.break_message || 'Estamos en break, regresamos pronto...',
          tiempoRestante: Math.ceil((endTime - now) / (1000 * 60))
        };
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
  notificacion.innerHTML = `
    <div class="flex items-start space-x-3">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <div>
        <h4 class="font-semibold mb-1">Negocio en Break</h4>
        <p class="text-sm mb-2">${mensaje}</p>
        <p class="text-xs opacity-90">Tiempo estimado: ${tiempoRestante} minutos</p>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" class="text-white hover:text-gray-200 ml-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  `;

  document.body.appendChild(notificacion);
  setTimeout(() => { if (notificacion.parentElement) notificacion.remove(); }, 8000);
}

// ===== Días laborales =====
async function verificarDiaLaboralFecha(fecha = new Date()) {
  try {
    const { data, error } = await supabase
      .from('configuracion_negocio')
      .select('dias_operacion')
      .eq('negocio_id', negocioId)
      .single();

    if (error) {
      console.warn('No se pudo verificar configuración de días laborales:', error);
      return true; // Permitir por defecto si no hay configuración
    }

    if (!data || !Array.isArray(data.dias_operacion) || data.dias_operacion.length === 0) {
      return false; // No hay días configurados
    }

    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const dia = diasSemana[fecha.getDay()];
    return data.dias_operacion.includes(dia);
  } catch (error) {
    console.error('Error al verificar día laboral:', error);
    return true; // Permitir por defecto en caso de error
  }
}

async function verificarDiaLaboral() {
  return verificarDiaLaboralFecha(new Date());
}

// ===== Lógica de turnos =====
function obtenerLetraDelDia() {
  const hoy = new Date();
  const fechaBase = new Date('2024-08-23'); // Fecha base donde A = día 0
  const diferenciaDias = Math.floor((hoy - fechaBase) / (1000 * 60 * 60 * 24));
  const indiceDia = ((diferenciaDias % 26) + 26) % 26; // Asegurar positivo
  const letra = String.fromCharCode(65 + indiceDia); // 65 = 'A'
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

  if (error || !data || data.length === 0) return `${letraHoy}01`;

  const ultimo = data[0].turno || `${letraHoy}00`;
  const numero = parseInt(ultimo.substring(1), 10) + 1;
  return `${letraHoy}${String(numero).padStart(2, '0')}`;
}

async function verificarTurnoActivo() {
  telefonoUsuario = localStorage.getItem('telefonoUsuario');
  if (!telefonoUsuario) return false;

  const { data, error } = await supabase
    .from('turnos')
    .select('*')
    .eq('negocio_id', negocioId)
    .eq('estado', 'En espera')
    .eq('telefono', telefonoUsuario)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error al verificar turno activo:', error.message);
    return false;
  }

  if (!data || data.length === 0) return false;

  turnoAsignado = data[0].turno;
  await mostrarMensajeConfirmacion(data[0]);
  return true;
}

async function obtenerPosicionEnFila(turnoUsuario) {
  const { data, error } = await supabase
    .from('turnos')
    .select('turno')
    .eq('negocio_id', negocioId)
    .eq('estado', 'En espera')
    .order('created_at', { ascending: true });

  if (error || !data) return 0;

  const index = data.findIndex(t => t.turno === turnoUsuario);
  return index;
}

// Calcular tiempo estimado total considerando todos los servicios en cola
async function calcularTiempoEstimadoTotal(turnoObjetivo = null) {
  const hoy = new Date().toISOString().slice(0, 10);
  let tiempoTotal = 0;

  // 1) Obtener tiempo restante del turno en atención
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

  // 2) Obtener cola de espera y sumar tiempos de servicios
  try {
    const { data: cola } = await supabase
      .from('turnos')
      .select('turno, servicio')
      .eq('negocio_id', negocioId)
      .eq('estado', 'En espera')
      .order('orden', { ascending: true })
      .order('created_at', { ascending: true });

    if (cola && cola.length) {
      const limite = turnoObjetivo ? cola.findIndex(t => t.turno === turnoObjetivo) : cola.length;
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

async function mostrarMensajeConfirmacion(turnoData) {
  // Decide si mostrar el tiempo estimado basado en la configuración. Por defecto es true.
  const mostrarTiempo = configCache.mostrar_tiempo_estimado !== false;

  const mensajeContenedor = document.getElementById('mensaje-turno');
  if (!mensajeContenedor) return;

  // Construir el HTML condicionalmente
  let htmlTiempoEstimado = '';
  if (mostrarTiempo) {
    const deadlineKey = getDeadlineKey(turnoData.turno);
    let deadline = Number(localStorage.getItem(deadlineKey) || 0);
    if (!deadline || Number.isNaN(deadline) || deadline <= Date.now()) {
      const minutosEspera = await calcularTiempoEstimadoTotal(turnoData.turno);
      deadline = Date.now() + (minutosEspera * 60 * 1000);
      localStorage.setItem(deadlineKey, String(deadline));
    }
    htmlTiempoEstimado = `⏳ Tiempo estimado: <span id="contador-tiempo"></span><br><br>`;
  }

  mensajeContenedor.innerHTML = `
    <div class="bg-green-100 text-green-700 rounded-xl p-4 shadow mt-4 text-sm">
      ✅ Hola <strong>${turnoData.nombre}</strong>, tu turno es <strong>${turnoData.turno}</strong>.<br>
      ${htmlTiempoEstimado}
      <button id="cancelarTurno" class="bg-red-600 text-white px-3 py-1 mt-2 rounded hover:bg-red-700">
        Cancelar Turno
      </button>
    </div>
  `;

  // Iniciar el contador solo si se debe mostrar
  if (mostrarTiempo) {
    const tiempoSpan = document.getElementById('contador-tiempo');
    if (intervaloContador) clearInterval(intervaloContador);

    const deadlineKey = getDeadlineKey(turnoData.turno);
    const deadline = Number(localStorage.getItem(deadlineKey) || 0);

    function actualizarContador() {
      const restante = Math.ceil((deadline - Date.now()) / 1000);
      const segundosPos = Math.max(0, restante);
      const minutos = Math.floor(segundosPos / 60);
      const segundos = segundosPos % 60;
      if (tiempoSpan) tiempoSpan.textContent = `${minutos} min ${segundos < 10 ? '0' : ''}${segundos} seg`;

      if (restante <= 0) {
        if (tiempoSpan) tiempoSpan.textContent = '🎉 Prepárate, tu turno está muy cerca.';
        clearInterval(intervaloContador);
      }
    }

    if (deadline > 0) {
        actualizarContador();
        intervaloContador = setInterval(actualizarContador, 1000);
    } else {
        if (tiempoSpan) tiempoSpan.textContent = 'Calculando...';
    }
  }

  // Cancelar turno
  const cancelarBtn = document.getElementById('cancelarTurno');
  if (cancelarBtn) {
    cancelarBtn.addEventListener('click', async () => {
      const confirmacion = confirm('¿Deseas cancelar tu turno?');
      if (!confirmacion) return;

      const { error } = await supabase
        .from('turnos')
        .update({ estado: 'Cancelado' })
        .eq('turno', turnoData.turno)
        .eq('negocio_id', negocioId)
        .eq('telefono', telefonoUsuario);

      if (error) {
        alert('Error al cancelar el turno: ' + error.message);
        return;
      }

      mensajeContenedor.innerHTML = `
        <div class="bg-red-100 text-red-700 rounded-xl p-4 shadow mt-4 text-sm">
          ❌ Has cancelado tu turno <strong>${turnoData.turno}</strong>.
        </div>
      `;

      const btnTomarTurno = document.querySelector('button[onclick*="modal"]');
      if (btnTomarTurno) btnTomarTurno.disabled = false;

      turnoAsignado = null;
      clearInterval(intervaloContador);
      localStorage.removeItem(deadlineKey);
      localStorage.removeItem('telefonoUsuario');
      telefonoUsuario = null;
      await actualizarTurnoActualYConteo();
    });
  }
}

async function actualizarTurnoActualYConteo() {
  const hoy = new Date().toISOString().slice(0, 10);

  // Prioridad: turno en atención del día actual
  const { data: enAtencion } = await supabase
    .from('turnos')
    .select('turno')
    .eq('negocio_id', negocioId)
    .eq('fecha', hoy)
    .eq('estado', 'En atención')
    .order('started_at', { ascending: true })
    .limit(1);

  let turnoActualTexto = null;
  if (enAtencion && enAtencion.length) {
    turnoActualTexto = enAtencion[0].turno;
  } else {
    const { data: enEspera } = await supabase
      .from('turnos')
      .select('turno')
      .eq('negocio_id', negocioId)
      .eq('fecha', hoy)
      .eq('estado', 'En espera')
      .order('created_at', { ascending: true })
      .limit(1);
    turnoActualTexto = enEspera && enEspera.length ? enEspera[0].turno : null;
  }

  const { count } = await supabase
    .from('turnos')
    .select('*', { count: 'exact', head: true })
    .eq('negocio_id', negocioId)
    .eq('fecha', hoy)
    .eq('estado', 'En espera');

  const letraHoy = obtenerLetraDelDia();
  const turnoActualEl = document.getElementById('turno-actual');
  if (turnoActualEl) turnoActualEl.textContent = turnoActualTexto || `${letraHoy}00`;
  const conteoEl = document.getElementById('conteo-turno');
  if (conteoEl) conteoEl.textContent = (count || 0).toString();
}

// Toma de turno desde formulario simple (hoy/ahora)
async function tomarTurnoSimple(nombre, telefono, servicio) {
  // Validar día laboral
  const esDiaLaboral = await verificarDiaLaboral();
  if (!esDiaLaboral) {
    alert('Hoy no es un día laboral. No se pueden tomar turnos en este día.');
    return;
  }

  // Verificar si el negocio está en break
  const estadoBreak = await verificarBreakNegocio();
  if (estadoBreak.enBreak) {
    mostrarNotificacionBreak(estadoBreak.mensaje, estadoBreak.tiempoRestante);
    return;
  }

  // Usar configuración del cache actualizada en tiempo real
  const ahora = new Date();
  const horaActual = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  const apertura = configCache.hora_apertura;
  const cierre = configCache.hora_cierre;

  if (horaActual < apertura) {
    alert(`Aún no hemos abierto. Horario de atención: ${apertura} - ${cierre}`);
    return;
  }
  if (horaActual > cierre) {
    alert('Ya no se pueden tomar turnos a esta hora. Intenta mañana.');
    return;
  }

  // Verificar límite de turnos del día
  const fechaHoy = obtenerFechaActual();
  const turnosHoy = await contarTurnosDia(fechaHoy);
  if (turnosHoy >= configCache.limite_turnos) {
    alert(`Se ha alcanzado el límite de ${configCache.limite_turnos} turnos para hoy.`);
    return;
  }

  // Verificar si ya tiene turno activo por teléfono
  telefonoUsuario = telefono;
  localStorage.setItem('telefonoUsuario', telefonoUsuario);

  const { data: turnosActivos } = await supabase
    .from('turnos')
    .select('*')
    .eq('negocio_id', negocioId)
    .eq('estado', 'En espera')
    .eq('telefono', telefonoUsuario);

  if (turnosActivos && turnosActivos.length > 0) {
    alert('Ya tienes un turno activo.');
    return;
  }

  // Generar nuevo turno y registrar
  const nuevoTurno = await generarNuevoTurno();
  const fecha = fechaHoy;
  const hora = obtenerHoraActual();

  const { error } = await supabase.from('turnos').insert([
    {
      negocio_id: negocioId,
      turno: nuevoTurno,
      nombre,
      telefono,
      servicio,
      estado: 'En espera',
      fecha,
      hora,
    },
  ]);

  if (error) {
    alert('Error al registrar turno: ' + error.message);
    return;
  }

  turnoAsignado = nuevoTurno;
  await mostrarMensajeConfirmacion({ nombre, turno: nuevoTurno });
  const form = document.getElementById('formRegistroNegocio');
  if (form) form.reset();
  cerrarModal();

  const btnTomarTurno = document.querySelector('button[onclick*="modal"]');
  if (btnTomarTurno) btnTomarTurno.disabled = true;

  await actualizarTurnoActualYConteo();
}

// ===== Inicialización =====
window.addEventListener('DOMContentLoaded', async () => {
  // Cargar configuración inicial y servicios
  await actualizarConfiguracion();
  await cargarServiciosActivos();

  const fechaElem = document.getElementById('fecha-de-hoy');
  const btnTomarTurno = document.querySelector('button[onclick*="modal"]');
  const form = document.getElementById('formRegistroNegocio');
  const btnCerrarModal = document.getElementById('btn-cerrar-modal');

  // Event listener para cerrar el modal
  if (btnCerrarModal) {
    btnCerrarModal.addEventListener('click', cerrarModal);
  }

  // Estado de break inicial
  const estadoBreakInicial = await verificarBreakNegocio();
  if (btnTomarTurno) {
    if (estadoBreakInicial.enBreak) {
      btnTomarTurno.disabled = true;
      btnTomarTurno.classList.add('opacity-50', 'cursor-not-allowed');
      mostrarNotificacionBreak(estadoBreakInicial.mensaje, estadoBreakInicial.tiempoRestante);
    } else {
      btnTomarTurno.disabled = false;
      btnTomarTurno.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }

  // Mostrar fecha del día + letra de serie
  if (fechaElem) {
    const fechaTexto = new Date().toLocaleDateString('es-DO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const letraHoy = obtenerLetraDelDia();
    fechaElem.innerHTML = `${fechaTexto} <span class="text-blue-600 dark:text-blue-400 font-bold">(Turnos serie ${letraHoy})</span>`;
  }

  // Validaciones en tiempo real
  const telInput = document.getElementById('telefono');
  if (telInput) {
    telInput.addEventListener('input', function () {
      this.value = this.value.replace(/[^0-9]/g, '');
    });
  }
  const nombreInput = document.getElementById('nombre');
  if (nombreInput) {
    nombreInput.addEventListener('input', function () {
      this.value = this.value.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ ]/g, '');
    });
  }

  // Verificar si ya tiene turno
  if (await verificarTurnoActivo()) {
    if (btnTomarTurno) btnTomarTurno.disabled = true;
  }

  await actualizarTurnoActualYConteo();

  // Registro de nuevo turno por formulario
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Validar día laboral
      const esDiaLaboral = await verificarDiaLaboral();
      if (!esDiaLaboral) {
        alert('Hoy no es un día laboral. No se pueden tomar turnos en este día.');
        return;
      }

      // Verificar si el negocio está en break
      const estadoBreak = await verificarBreakNegocio();
      if (estadoBreak.enBreak) {
        mostrarNotificacionBreak(estadoBreak.mensaje, estadoBreak.tiempoRestante);
        return;
      }

      const nombre = nombreInput ? nombreInput.value.trim() : '';
      const telefono = telInput ? telInput.value.trim() : '';
      const servicio = form.tipo ? form.tipo.value : '';

      if (!nombre || !telefono || !servicio) {
        alert('Por favor complete nombre, teléfono y servicio.');
        return;
      }

      await tomarTurnoSimple(nombre, telefono, servicio);
    });
  }

  // Suscripción en tiempo real de turnos
  supabase
    .channel('turnos-usuario')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'turnos', filter: `negocio_id=eq.${negocioId}` },
      async () => {
    // ... existing code ...

// Suscripción a cambios de servicios
supabase
  .channel('servicios-usuario')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'servicios', filter: `negocio_id=eq.${negocioId}` },
    async () => {
      await cargarServiciosActivos();
    }
  )
  .subscribe();

// ... existing code ...   telefonoUsuario = localStorage.getItem('telefonoUsuario');
        if (telefonoUsuario) {
          const { data, error } = await supabase
            .from('turnos')
            .select('*')
            .eq('negocio_id', negocioId)
            .eq('telefono', telefonoUsuario)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (!error && data && data.estado !== 'En espera') {
            const cont = document.getElementById('mensaje-turno');
            if (cont) {
              cont.innerHTML = `
                <div class="bg-blue-100 text-blue-700 rounded-xl p-4 shadow mt-4 text-sm">
                  ✅ Tu turno <strong>${data.turno}</strong> ha sido ${data.estado.toLowerCase()}.
                </div>
              `;
            }
            turnoAsignado = null;
            if (btnTomarTurno) btnTomarTurno.disabled = false;
            if (intervaloContador) clearInterval(intervaloContador);
            localStorage.removeItem(getDeadlineKey(data.turno));
            localStorage.removeItem('telefonoUsuario');
            telefonoUsuario = null;
          }
        }
        await actualizarTurnoActualYConteo();
      }
    )
    .subscribe();

  // Suscripción al estado de negocio (break)
  supabase
    .channel('estado-negocio-usuario')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'estado_negocio', filter: `negocio_id=eq.${negocioId}` },
      async () => {
        const estado = await verificarBreakNegocio();
        if (btnTomarTurno) {
          if (estado.enBreak) {
            btnTomarTurno.disabled = true;
            btnTomarTurno.classList.add('opacity-50', 'cursor-not-allowed');
            mostrarNotificacionBreak(estado.mensaje, estado.tiempoRestante);
          } else {
            btnTomarTurno.disabled = false;
            btnTomarTurno.classList.remove('opacity-50', 'cursor-not-allowed');
          }
        }
      }
    )
    .subscribe();

  // Suscripción a cambios de configuración del negocio
  supabase
    .channel('configuracion-negocio-usuario')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'configuracion_negocio', filter: `negocio_id=eq.${negocioId}` },
      async () => {
        await actualizarConfiguracion();
      }
    )
    .subscribe();
});

// ===== API programática: tomarTurno con fecha/hora especificadas =====
export async function tomarTurno(nombre, telefono, servicio, fechaISO, horaHHMM) {
  try {
    // Verificar día laboral para la fecha dada
    const fechaObj = new Date(`${fechaISO}T00:00:00`);
    const esDiaLaboral = await verificarDiaLaboralFecha(fechaObj);
    if (!esDiaLaboral) {
      alert('La fecha seleccionada no es un día laboral.');
      return;
    }

    // Verificar break
    const estadoBreak = await verificarBreakNegocio();
    if (estadoBreak.enBreak) {
      mostrarNotificacionBreak(estadoBreak.mensaje, estadoBreak.tiempoRestante);
      return;
    }

    // Validar hora dentro del horario [apertura, cierre]
    const aperturaMin = hhmmToMinutes(configCache.hora_apertura);
    const cierreMin = hhmmToMinutes(configCache.hora_cierre);
    const horaMin = hhmmToMinutes(horaHHMM);
    if (horaMin < aperturaMin || horaMin > cierreMin) {
      alert(`⛔ El negocio solo atiende de ${configCache.hora_apertura} a ${configCache.hora_cierre}.`);
      return;
    }

    // Límite diario
    const usados = await contarTurnosDia(fechaISO);
    if (usados >= configCache.limite_turnos) {
      alert(`⛔ Se alcanzó el límite de ${configCache.limite_turnos} turnos para ${fechaISO}.`);
      return;
    }

    // Inserta turno
    const ahora = new Date();
    const { error: insertError } = await supabase.from('turnos').insert([
      {
        negocio_id: negocioId,
        nombre,
        telefono,
        servicio,
        estado: 'En espera',
        fecha: fechaISO,
        hora: horaHHMM,
        created_at: ahora.toISOString(),
      }
    ]);

    if (insertError) {
      console.error(insertError);
      alert('❌ Error al registrar el turno.');
    } else {
      alert('✅ Turno registrado con éxito.');
    }
  } catch (e) {
    console.error(e);
    alert('❌ No se pudo validar la configuración del negocio.');
  }
}
