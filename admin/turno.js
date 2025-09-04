import { supabase } from '../database.js';

let negocioId; // Se obtendrá del usuario autenticado

async function getNegocioId() {
  if (negocioId) return negocioId;

  const { data: { user } } = await supabase.auth.getUser();

  if (user && user.user_metadata && user.user_metadata.negocio_id) {
    negocioId = user.user_metadata.negocio_id;
    return negocioId;
  }

  // Fallback to localStorage
  const businessIdFromStorage = localStorage.getItem('businessId');
  if (businessIdFromStorage) {
    negocioId = businessIdFromStorage;
    return negocioId;
  }

  alert('No se pudo obtener el ID del negocio. Por favor, inicie sesión de nuevo.');
  window.location.replace('login.html');
  return null;
}

let turnoActual = null;
let dataRender = []; // Cache of waiting list turns for reordering
let HORA_APERTURA = "08:00"; // valor por defecto
let HORA_LIMITE_TURNOS = "23:00"; // valor por defecto
let LIMITE_TURNOS = 50; // valor por defecto
let chart = null; // Variable para almacenar la instancia del gráfico
let ALLOWED_DAYS = [1,2,3,4,5,6];

// Unificar refrescos de UI para evitar llamadas duplicadas
let __refreshTimer = null;
let __elapsedTimer = null;
function refrescarUI() {
  if (__refreshTimer) return;
  __refreshTimer = setTimeout(async () => {
    __refreshTimer = null;
    await cargarTurnos();
    await cargarEstadisticas();
  }, 300);
}

// Cache de servicios (nombre -> duracion_min)
let serviciosCache = {};
async function cargarServicios() {
  try {
    const { data, error } = await supabase
      .from('servicios')
      .select('nombre,duracion_min')
      .eq('negocio_id', negocioId)
      .eq('activo', true);
    if (error) throw error;
    serviciosCache = {};
    (data || []).forEach(s => { serviciosCache[s.nombre] = s.duracion_min; });
    // Poblar select de servicios si existe en esta vista
    const sel = document.getElementById('servicio');
    if (sel && data && data.length) {
      sel.innerHTML = '<option value="">Seleccione un servicio</option>' +
        data.map(s => `<option value="${s.nombre}">${s.nombre}</option>`).join('');
    }
  } catch (e) {
    console.warn('No se pudieron cargar servicios, usando fallback.', e);
  }
}

// Cargar hora límite desde configuracion_negocio
async function cargarHoraLimite() {
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

// Inicialización cuando el DOM está listo
document.addEventListener('DOMContentLoaded', async () => {
    await getNegocioId();
    if (!negocioId) return;
  // Inicializar modo oscuro
  initThemeToggle();
  
  // Inicializar fecha y hora actual
  actualizarFechaHora();
  setInterval(actualizarFechaHora, 60000); // Actualizar cada minuto

  // Cargar configuración
  await cargarHoraLimite();
  // Cargar servicios activos
  await cargarServicios();
  
  // Cargar turnos y estadísticas
  refrescarUI();
  
  // Configurar eventos
  document.getElementById('refrescar-turnos')?.addEventListener('click', () => {
    refrescarUI();
    mostrarNotificacion('Turnos actualizados', 'success');
  });
  
  // Configurar menú móvil
  const mobileMenuButton = document.getElementById('mobile-menu-button');
  const sidebar = document.getElementById('sidebar');

  // Listener para reordenar turnos
  document.getElementById('listaEspera')?.addEventListener('click', handleReorderClick);

  // Listener para abrir modal de pago
  document.getElementById('listaAtencion')?.addEventListener('click', (e) => {
    const card = e.target.closest('.turn-card-atencion');
    if (card && card.dataset.id) {
      abrirModalPago(card.dataset.id);
    }
  });

  // Listener para el form de pago
  document.getElementById('formPago')?.addEventListener('submit', guardarPago);

  const overlay = document.getElementById('sidebar-overlay');
  
  mobileMenuButton?.addEventListener('click', toggleMobileMenu);
  overlay?.addEventListener('click', toggleMobileMenu);
  
  function toggleMobileMenu() {
    sidebar.classList.toggle('-translate-x-full');
    overlay.classList.toggle('opacity-0');
    overlay.classList.toggle('pointer-events-none');
  }

  // Suscripción en tiempo real para que la vista se actualice al instante
  suscribirseTurnos();

  // Iniciar actualizador de minuteros (espera/en atención)
  iniciarActualizadorMinutos();

  // Suscripción a cambios de configuración (días operacionales, horarios)
  supabase
    .channel('config-turno-admin')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'configuracion_negocio', filter: `negocio_id=eq.${negocioId}` },
      async () => {
        await cargarHoraLimite();
        refrescarUI();
      }
    )
    .subscribe();

  });

// Handler para los botones de reordenar
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

    // Intercambiar los valores de 'orden'
    const updates = [
        supabase.from('turnos').update({ orden: otherTurn.orden }).eq('id', currentTurn.id),
        supabase.from('turnos').update({ orden: currentTurn.orden }).eq('id', otherTurn.id)
    ];

    try {
        const results = await Promise.all(updates);
        const hasError = results.some(res => res.error);
        if (hasError) {
            throw new Error('Una de las actualizaciones falló.');
        }
        mostrarNotificacion('Turnos reordenados con éxito.', 'success');
        await refrescarUI();
    } catch (error) {
        console.error('Error al reordenar turnos:', error);
        mostrarNotificacion('Error al reordenar los turnos.', 'error');
    }
}

// Función para inicializar el toggle de tema oscuro/claro
function initThemeToggle() {
  const themeToggle = document.getElementById('theme-toggle');
  const htmlElement = document.documentElement;
  
  // Verificar preferencia guardada
// Función para verificar si una fecha es día laboral
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
    const diaFecha = diasSemana[fecha.getDay()];
    
    return data.dias_operacion.includes(diaFecha);
  } catch (error) {
    console.error('Error al verificar día laboral:', error);
    return true; // Permitir por defecto en caso de error
  }
}

// Modificar la función tomarTurno para incluir validación de día laboral
async function tomarTurno(event) {
  event.preventDefault();
  console.log("tomarTurno llamada");

  // Asegurar configuración al día (incluye dias_operacion)
  await cargarHoraLimite();

  // Validar día operacional
  const esDiaLaboral = await verificarDiaLaboralFecha(new Date());
  if (!esDiaLaboral) {
    mostrarNotificacion('Hoy no es un día laboral. No se pueden tomar turnos en este día.', 'error');
    return;
  }

  // ... existing code ...
}

// Cargar tema guardado
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  htmlElement.classList.add('dark');
} else {
  htmlElement.classList.remove('dark');
}

themeToggle?.addEventListener('click', () => {
  htmlElement.classList.toggle('dark');
  const isDark = htmlElement.classList.contains('dark');// ... existing code ...

// Suscripción a cambios de servicios
supabase
  .channel('servicios-turno')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'servicios', filter: `negocio_id=eq.${negocioId}` },
    async () => {
      await cargarServicios();
    }
  )
  .subscribe();

    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  });
}

// Actualizador de minuteros (espera/en atención)
function iniciarActualizadorMinutos() {
  if (__elapsedTimer) clearInterval(__elapsedTimer);
  actualizarMinuteros();
  __elapsedTimer = setInterval(actualizarMinuteros, 30000);
}

function actualizarMinuteros() {
  try {
    // Actualizar 'Esperando' en tarjetas
    const spans = document.querySelectorAll('.esperando-min');
    const ahora = Date.now();
    spans.forEach(sp => {
      const iso = sp.getAttribute('data-creado-iso');
      if (!iso) return;
      const t = new Date(iso);
      const mins = Math.max(0, Math.floor((ahora - t.getTime()) / 60000));
      sp.textContent = String(mins);
    });

    // Actualizar 'En atención' si aplica
    const tEst = document.getElementById('tiempo-estimado');
    if (tEst && tEst.dataset && tEst.dataset.startedIso) {
      const inicio = new Date(tEst.dataset.startedIso);
      if (!isNaN(inicio)) {
        const trans = Math.max(0, Math.floor((Date.now() - inicio.getTime()) / 60000));
        tEst.textContent = `En atención · ${trans} min`;
      }
    }
  } catch (e) {
    // evitar romper el bucle
    console.warn('Error actualizando minuteros', e);
  }
}

// Función para actualizar la fecha y hora actual
function actualizarFechaHora() {
  const ahora = new Date();
  const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const fechaFormateada = ahora.toLocaleDateString('es-ES', opciones);
  const horaFormateada = ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const letraHoy = obtenerLetraDelDia();
  
  document.getElementById('fecha-actual').innerHTML = `${fechaFormateada.charAt(0).toUpperCase() + fechaFormateada.slice(1)} <span class="text-blue-600 dark:text-blue-400 font-bold">(Serie ${letraHoy})</span>`;
  document.getElementById('hora-actual').textContent = horaFormateada;
}

// Días operacionales helpers
function getDiaOperacionIndex(date = new Date()) {
  // JS: 0=Domingo, 1=Lunes ... 6=Sábado
  return date.getDay();
}
function esDiaOperativo(date = new Date()) {
  const idx = getDiaOperacionIndex(date);
  if (!Array.isArray(ALLOWED_DAYS) || ALLOWED_DAYS.length === 0) return true;
  return ALLOWED_DAYS.includes(idx);
}

// Tomar turno manual desde el modal
async function tomarTurno(event) {
  event.preventDefault();
  console.log("tomarTurno llamada");

  // Asegurar configuración al día (incluye dias_operacion)
  await cargarHoraLimite();

  // Validar día operacional
  if (!esDiaOperativo(new Date())) {
    mostrarNotificacion('Hoy no es un día operacional.', 'error');
    return;
  }

  // Validar horario de apertura y cierre
  const ahora = new Date();
  const horaActual = ahora.toTimeString().slice(0,5);
  const horaStr = ahora.toLocaleTimeString('es-ES', { hour12: false });  // formato 24h "HH:mm:ss"
  if (horaActual < HORA_APERTURA) {
    mostrarNotificacion(`Aún no hemos abierto. Horario: ${HORA_APERTURA} - ${HORA_LIMITE_TURNOS}`, 'error');
    return;
  }
  if (horaActual >= HORA_LIMITE_TURNOS) {
    mostrarNotificacion('Ya no se pueden tomar turnos a esta hora. Intenta mañana.', 'error');
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

  // Verificar límite de turnos del día
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

  // Verificación de unicidad para evitar turnos duplicados por condiciones de carrera
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

// Calcular tiempo de espera estimado basado en el servicio
function calcularTiempoEsperaEstimado(servicio) {
  // Si hay catálogo cargado, úsalo
  if (serviciosCache && serviciosCache[servicio]) return serviciosCache[servicio];
  // Fallback si no hay catálogo
  const tiemposServicio = {
    'Barbería': 30,
    'Corte de cabello': 20,
    'Afeitado': 15,
    'Tratamiento facial': 40
  };
  return tiemposServicio[servicio] || 25;
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
      // Si se especifica un turno objetivo, solo sumar hasta ese turno
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

// Función para obtener la letra del día basada en la fecha
function obtenerLetraDelDia() {
  const hoy = new Date();
  const fechaBase = new Date('2024-08-23'); // Fecha base donde A = día 0
  const diferenciaDias = Math.floor((hoy - fechaBase) / (1000 * 60 * 60 * 24));
  const indiceDia = diferenciaDias % 26; // Ciclo de 26 letras (A-Z)
  const letra = String.fromCharCode(65 + Math.abs(indiceDia)); // 65 = 'A'
  return letra;
}

// Generar el próximo turno disponible
async function generarNuevoTurno() {
  const letraHoy = obtenerLetraDelDia();
  const fechaHoy = new Date().toISOString().slice(0, 10);
  
  // Buscar el último turno del día actual con la letra correspondiente
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
  console.log("Nuevo turno generado:", nuevoTurno);
  return nuevoTurno;
}

// Cargar turnos en espera
async function cargarTurnos() {
  const hoy = new Date().toISOString().slice(0, 10);

  // Buscar si hay un turno actualmente en atención
  const { data: enAtencion, error: errAt } = await supabase
    .from('turnos')
    .select('*')
    .eq('estado', 'En atención')
    .eq('negocio_id', negocioId)
    .eq('fecha', hoy)
    .order('started_at', { ascending: true });


  // Cargar cola de espera
  const { data, error } = await supabase
    .from('turnos')
    .select('*')
    .eq('estado', 'En espera')
    .eq('negocio_id', negocioId)
    .eq('fecha', hoy)
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error al cargar turnos:', error.message);
    mostrarNotificacion('Error al cargar turnos', 'error');
    return;
  }

  // Deduplicar por código de turno (evita mostrar dos filas con el mismo código)
  const listaOriginal = data || [];
  const seenTurnos = new Set();
  dataRender = []; // Clear and rebuild the cache
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
  
  // Actualizar contador
  if (contadorEspera) {
    contadorEspera.textContent = `${dataRender.length} turno${dataRender.length !== 1 ? 's' : ''}`;
  }
  
  if (turnosEsperaElement) {
    turnosEsperaElement.textContent = dataRender.length;
  }
  
  // Actualizar barra de progreso
  const cargaEspera = document.getElementById('carga-espera');
  if (cargaEspera) {
    // Calcular porcentaje de carga (máximo 100% a partir de 10 turnos)
    const porcentaje = Math.min(dataRender.length * 10, 100);
    cargaEspera.style.width = `${porcentaje}%`;
  }

  // Mostrar mensaje si no hay turnos
  if (dataRender.length === 0 && sinTurnos) {
    sinTurnos.classList.remove('hidden');
  } else if (sinTurnos) {
    sinTurnos.classList.add('hidden');
  }

  // Crear tarjetas de turnos con tiempo estimado mejorado
  for (let index = 0; index < dataRender.length; index++) {
    const t = dataRender[index];
    const div = document.createElement('div');
    div.className = 'bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg shadow-sm border border-blue-100 dark:border-blue-800 transition-all hover:shadow-md';
    
    // Calcular tiempo de espera real (desde creación)
    const horaCreacion = new Date(`${t.fecha}T${t.hora}`);
    const ahora = new Date();
    const minutosEsperaReal = Math.floor((ahora - horaCreacion) / 60000);
    
    // Calcular tiempo estimado hasta que le toque (basado en servicios)
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
      </div>
    `;
    
    lista.appendChild(div);
  }

  // Renderizar la lista de turnos en atención
  const listaAtencion = document.getElementById('listaAtencion');
  if (listaAtencion) {
    listaAtencion.innerHTML = '';
    (enAtencion || []).forEach(t => {
      const div = document.createElement('div');
      div.className = 'turn-card-atencion bg-green-50 dark:bg-green-900/30 p-4 rounded-lg shadow-sm border border-green-100 dark:border-green-800 transition-all cursor-pointer hover:shadow-md';
      div.dataset.id = t.id;
      div.innerHTML = `
        <div class="flex justify-between items-start">
          <span class="text-2xl font-bold text-green-700 dark:text-green-400">${t.turno}</span>
          <span class="text-xs bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 px-2 py-0.5 rounded-full">Atendiendo</span>
        </div>
        <p class="text-gray-700 dark:text-gray-300 font-medium mt-2 truncate">${t.nombre || 'Cliente'}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${t.servicio || 'Servicio'}</p>
      `;
      listaAtencion.appendChild(div);
    });
  }

  // Determinar turno actual para el display principal (el último en atención)
  const turnoActualDisplay = (enAtencion && enAtencion.length > 0) ? enAtencion[enAtencion.length - 1] : null;

  // Determinar el próximo turno para las acciones de los botones (el primero en espera)
  turnoActual = (dataRender.length > 0) ? dataRender[0] : null;

  // Actualizar información del turno actual en el display principal
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
        // Mostrar que está en atención actualmente
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
        // Estimado por servicio
        const mins = (serviciosCache && serviciosCache[turnoParaEstimar.servicio]) ? serviciosCache[turnoParaEstimar.servicio] : 25;
        delete tiempoEstimado.dataset.startedIso;
        tiempoEstimado.textContent = `${mins} min`;
      }
    } else {
      delete tiempoEstimado.dataset.startedIso;
      tiempoEstimado.textContent = '-';
    }
  }
  
  if (turnoActual) {
    console.log(`Próximo turno para acciones: ${turnoActual.turno} (id: ${turnoActual.id || 's/n'})`, turnoActual);
  } else {
    console.log("No hay turnos en espera para acciones.");
  }
  
  // Calcular tiempo promedio de espera mejorado
  if (dataRender.length > 0) {
    const tiempoPromedio = document.getElementById('tiempo-promedio');
    if (tiempoPromedio) {
      // Calcular el tiempo total acumulado de todos los servicios en cola
      const tiempoTotalCola = await calcularTiempoEstimadoTotal();
      const promedio = dataRender.length > 0 ? tiempoTotalCola / dataRender.length : 0;
      tiempoPromedio.textContent = `${Math.round(promedio)} min`;
    }
  }
}

// Cargar estadísticas para el gráfico
async function cargarEstadisticas() {
  const hoy = new Date().toISOString().slice(0, 10);
  
  // Obtener turnos atendidos hoy
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
  
  // Obtener turnos devueltos hoy
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
  
  // Actualizar contador de turnos atendidos
  const turnosAtendidosElement = document.getElementById('turnos-atendidos');
  if (turnosAtendidosElement) {
    turnosAtendidosElement.textContent = turnosAtendidos.length;
  }
  
  // Calcular ingresos totales
  const ingresos = turnosAtendidos.reduce((total, turno) => total + (turno.monto_cobrado || 0), 0);
  const ingresosHoy = document.getElementById('ingresos-hoy');
  if (ingresosHoy) {
    ingresosHoy.textContent = `RD$${ingresos.toFixed(2)}`;
  }
  
  // Calcular promedio de cobro
  const promedioCobro = document.getElementById('promedio-cobro');
  if (promedioCobro && turnosAtendidos.length > 0) {
    const promedio = ingresos / turnosAtendidos.length;
    promedioCobro.textContent = `RD$${promedio.toFixed(2)}`;
  }
  
  // Crear gráfico de estadísticas
  const ctx = document.getElementById('estadisticasChart');
  if (!ctx) return;
  
  // Agrupar turnos por hora
  const turnosPorHora = {};
  const horasDelDia = [];
  
  // Inicializar horas del día (de 8 AM a 8 PM)
  for (let i = 8; i <= 20; i++) {
    const hora = i < 10 ? `0${i}:00` : `${i}:00`;
    horasDelDia.push(hora);
    turnosPorHora[hora] = { atendidos: 0, devueltos: 0, espera: 0 };
  }
  
  // Contar turnos atendidos por hora
  turnosAtendidos.forEach(turno => {
    const hora = turno.hora.slice(0, 5);
    const horaRedondeada = `${hora.slice(0, 2)}:00`;
    if (turnosPorHora[horaRedondeada]) {
      turnosPorHora[horaRedondeada].atendidos++;
    }
  });
  
  // Contar turnos devueltos por hora
  turnosDevueltos.forEach(turno => {
    const hora = turno.hora.slice(0, 5);
    const horaRedondeada = `${hora.slice(0, 2)}:00`;
    if (turnosPorHora[horaRedondeada]) {
      turnosPorHora[horaRedondeada].devueltos++;
    }
  });
  
  // Obtener turnos en espera
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
  
  // Preparar datos para el gráfico
  const datosAtendidos = horasDelDia.map(hora => turnosPorHora[hora].atendidos);
  const datosDevueltos = horasDelDia.map(hora => turnosPorHora[hora].devueltos);
  const datosEspera = horasDelDia.map(hora => turnosPorHora[hora].espera);
  
  // Destruir gráfico existente si hay uno
  if (chart) {
    chart.destroy();
  }
  
  // Crear nuevo gráfico
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: horasDelDia,
      datasets: [
        {
          label: 'Atendidos',
          data: datosAtendidos,
          backgroundColor: 'rgba(34, 197, 94, 0.5)',
          borderColor: 'rgb(34, 197, 94)',
          borderWidth: 1
        },
        {
          label: 'Devueltos',
          data: datosDevueltos,
          backgroundColor: 'rgba(239, 68, 68, 0.5)',
          borderColor: 'rgb(239, 68, 68)',
          borderWidth: 1
        },
        {
          label: 'En Espera',
          data: datosEspera,
          backgroundColor: 'rgba(245, 158, 11, 0.5)',
          borderColor: 'rgb(245, 158, 11)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#374151'
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        x: {
          ticks: {
            color: document.documentElement.classList.contains('dark') ? '#9ca3af' : '#4b5563'
          },
          grid: {
            color: document.documentElement.classList.contains('dark') ? 'rgba(75, 85, 99, 0.2)' : 'rgba(209, 213, 219, 0.2)'
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0,
            color: document.documentElement.classList.contains('dark') ? '#9ca3af' : '#4b5563'
          },
          grid: {
            color: document.documentElement.classList.contains('dark') ? 'rgba(75, 85, 99, 0.2)' : 'rgba(209, 213, 219, 0.2)'
          }
        }
      }
    }
  });
}

// Suscripción en tiempo real a cambios en turnos
let canalTurnos = null;

function suscribirseTurnos() {
  // Desconectar canal existente si existe
  if (canalTurnos) {
    supabase.removeChannel(canalTurnos);
  }
  
  // Crear nueva suscripción
  canalTurnos = supabase
    .channel('turnos-admin')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'turnos', filter: `negocio_id=eq.${negocioId}` },
      () => {
        refrescarUI();
      }
    )
    .subscribe();
}

// Modal para tomar turno
function abrirModal() {
  console.log("abrirModal llamada");
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  document.getElementById('nombre').focus();
}

function cerrarModal() {
  console.log("cerrarModal llamada");
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal').classList.remove('flex');
  document.getElementById('formTurno').reset();
}

// Modal de pago
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

// Atender ahora
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

// Guardar el pago e indicar que el turno fue atendido
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
    console.error(error);
    return;
  }

  cerrarModalPago();
  mostrarNotificacion(`Turno finalizado con cobro de RD$${monto}`, 'success');
  refrescarUI();
}

// Devolver turno al final de la cola
async function devolverTurno() {
  console.log("devolverTurno llamada");
  if (!turnoActual) {
    mostrarNotificacion('No hay turno que devolver.', 'warning');
    return;
  }

  if (!confirm(`¿Enviar el turno ${turnoActual.turno} al final de la cola?`)) {
    return;
  }

  const ahoraISO = new Date().toISOString();

  // Mantener 'En espera' y actualizar created_at para mandarlo al final
  // mover al final: orden = MAX(orden)+1 para hoy
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
    console.error(error);
    return;
  }

  mostrarNotificacion(`Turno ${turnoActual.turno} enviado al final de la cola`, 'info');
  refrescarUI();
}

// Función para mostrar notificaciones con SweetAlert2
function mostrarNotificacion(mensaje, tipo = 'info') {
  const iconos = {
    success: 'success',
    error: 'error',
    warning: 'warning',
    info: 'info'
  };
  
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

// Exportar funciones para uso en HTML
window.tomarTurno = tomarTurno;
window.abrirModal = abrirModal;
window.cerrarModal = cerrarModal;
window.cerrarModalPago = cerrarModalPago; // Still needed for the button in the modal
window.devolverTurno = devolverTurno;
window.atenderAhora = atenderAhora;
