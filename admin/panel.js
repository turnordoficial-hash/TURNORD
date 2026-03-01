import { supabase, ensureSupabase } from '../database.js';

let atencionInterval = null; // Timer para el turno en atención
let serviciosCache = {}; // Cache para duraciones de servicios
let refreshTimer = null; // Timer para debounce
let currentAtencionId = null; // Para evitar reiniciar timer si es el mismo turno
let negocioId = null; // Se inicializa de forma segura
let turnosChannel = null;
let citasChannel = null;
let historialGlobal = [];
let currentPage = 1;
const itemsPerPage = 10;

function handleAuthError(err) {
  if (err && err.code === 'PGRST303') {
    supabase.auth.signOut().finally(() => {
      const loginUrl = negocioId ? `login_${negocioId}.html` : 'login.html';
      window.location.replace(loginUrl);
    });
  }
}

// Cargar la duración de los servicios para el cálculo de los timers.
async function cargarServicios() {
  if (!negocioId) return;
  try {
    const { data, error } = await supabase
      .from('servicios')
      .select('nombre, duracion_min')
      .eq('negocio_id', negocioId);
    if (error) throw error;
    serviciosCache = (data || []).reduce((acc, srv) => {
      acc[srv.nombre] = srv.duracion_min;
      return acc;
    }, {});
  } catch (error) {
    console.error("Error cargando la duración de los servicios:", error);
    handleAuthError(error);
  }
}

// Utilidad para formatear fechas a YYYY-MM-DD en la zona horaria local.
function ymdLocal(dateLike) {
  const d = new Date(dateLike);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Actualiza los contadores de la UI (En espera, Atendidos, Total).
function actualizarContadores(turnosHoy) {
  document.getElementById('turnosEspera').textContent = turnosHoy.filter(t => t.estado === 'En espera').length;
  document.getElementById('turnosAtendidos').textContent = turnosHoy.filter(t => t.estado === 'Atendido').length;
  document.getElementById('turnosDia').textContent = turnosHoy.length;
}

// Dibuja la tabla del historial de turnos del día.
function actualizarTabla(items) {
  const tabla = document.getElementById('tablaHistorial');
  if (!tabla) return;

  tabla.innerHTML = items.length === 0
      ? `<tr><td colspan="4" class="py-4 text-center text-gray-500">No hay registros hoy.</td></tr>`
      : items.map(item => {
          let estadoClass = 'text-gray-500';
          let estadoTexto = item.estado;

          if (item.estado === 'En espera') {
              estadoClass = 'text-yellow-500';
          } else if (item.estado === 'Atendido') {
              estadoClass = 'text-green-500';
          } else if (item.estado === 'En atención') {
              estadoClass = 'text-blue-600 animate-pulse';
          } else if (item.estado === 'Cita Programada') {
              estadoClass = 'text-purple-500';
              estadoTexto = '📅 Programada';
          } else if (item.estado === 'Cancelado') {
              estadoClass = 'text-red-500';
          }

          return `
          <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
            <td class="py-3 px-4 border-b border-gray-100 dark:border-white/10 font-medium text-gray-900 dark:text-white">${item.turno}</td>
            <td class="py-3 px-4 border-b border-gray-100 dark:border-white/10">${item.nombre || 'N/A'}</td>
            <td class="py-3 px-4 border-b border-gray-100 dark:border-white/10 font-mono text-xs">${item.hora || 'N/A'}</td>
            <td class="py-3 px-4 border-b border-gray-100 dark:border-white/10">
              <span class="${estadoClass} font-bold text-xs uppercase tracking-wider">${estadoTexto}</span>
            </td>
          </tr>
        `;
      }).join('');
}

// Carga los datos principales de la página (turnos) y actualiza la UI.
async function cargarDatos() {
  if (!negocioId) return;

  try {
    const hoyLocal = ymdLocal(new Date());
    
    // 1. Cargar Turnos
    const { data: turnosData, error: turnosError } = await supabase
      .from('turnos')
      .select('id, turno, nombre, estado, hora, servicio, started_at, created_at') // 2. Optimización de consulta
      .eq('negocio_id', negocioId)
      .eq('fecha', hoyLocal)
      .order('created_at', { ascending: false });

    if (turnosError) throw turnosError;

    // 2. Cargar Citas Programadas para hoy
    const startOfDay = new Date(hoyLocal + 'T00:00:00');
    const endOfDay = new Date(hoyLocal + 'T23:59:59');

    const { data: citasData, error: citasError } = await supabase
      .from('citas')
      .select('id, cliente_telefono, start_at, estado, barber_id, servicio')
      .eq('negocio_id', negocioId)
      .gte('start_at', startOfDay.toISOString())
      .lte('start_at', endOfDay.toISOString())
      .eq('estado', 'Programada');

    if (citasError) throw citasError;

    // 3. Obtener nombres de clientes para las citas
    let citasConNombre = [];
    if (citasData && citasData.length > 0) {
        const telefonos = [...new Set(citasData.map(c => c.cliente_telefono).filter(Boolean))];
        const barberIds = [...new Set(citasData.map(c => c.barber_id).filter(Boolean))];
        let clientesMap = {};
        let barberosMap = {};
        
        if (telefonos.length > 0) {
            const { data: clientes } = await supabase
                .from('clientes')
                .select('telefono, nombre')
                .eq('negocio_id', negocioId)
                .in('telefono', telefonos);
            
            (clientes || []).forEach(c => clientesMap[c.telefono] = c.nombre);
        }
        if (barberIds.length > 0) {
            const { data: barberos } = await supabase
                .from('barberos')
                .select('id, nombre')
                .eq('negocio_id', negocioId)
                .in('id', barberIds);
            (barberos || []).forEach(b => barberosMap[b.id] = b.nombre);
        }

        // Asignar código letra+número por día para citas
        const baseDate = new Date('2024-08-23T00:00:00Z');
        const getLetterForDate = (d) => {
            const diffDays = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate())) / 86400000);
            const idx = ((diffDays % 26) + 26) % 26;
            return String.fromCharCode(65 + idx);
        };
        const sortedCitas = [...citasData].sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
        const codeMap = new Map(sortedCitas.map((c, i) => [c.id, `${getLetterForDate(new Date(c.start_at))}${String(i + 1).padStart(2, '0')}`]));

        citasConNombre = citasData.map(c => {
            const fecha = new Date(c.start_at);
            const hora = fecha.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            return {
                id: `cita-${c.id}`,
                turno: codeMap.get(c.id),
                nombre: clientesMap[c.cliente_telefono] || (c.cliente_telefono || 'Cliente'),
                estado: c.estado || 'Cita Programada',
                hora: hora,
                servicio: c.servicio || 'Cita',
                created_at: c.start_at,
                isCita: true
            };
        });
    }

    const turnosHoy = turnosData || [];
    
    // Combinar y ordenar por fecha de creación/inicio
    const historialCombinado = [...turnosHoy, ...citasConNombre].sort((a, b) => {
        return new Date(b.created_at) - new Date(a.created_at);
    });

    historialGlobal = historialCombinado;
    actualizarContadores(turnosHoy);
    renderPaginationHistorial();
    actualizarTurnoEnAtencion(turnosHoy);

  } catch (err) {
    console.error('Error al cargar datos del panel:', err);
    handleAuthError(err);
    document.getElementById('tablaHistorial').innerHTML = `<tr><td colspan="4" class="py-4 text-center text-red-500">Error al cargar los datos.</td></tr>`;
  }
}

function renderPaginationHistorial() {
    const totalPages = Math.ceil(historialGlobal.length / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const itemsToShow = historialGlobal.slice(start, end);

    actualizarTabla(itemsToShow);

    const infoEl = document.getElementById('historialPageInfo');
    const btnPrev = document.getElementById('btnPrevHistorial');
    const btnNext = document.getElementById('btnNextHistorial');

    if (infoEl) infoEl.textContent = `Página ${currentPage} de ${totalPages}`;
    if (btnPrev) btnPrev.disabled = currentPage === 1;
    if (btnNext) btnNext.disabled = currentPage === totalPages;
}

function cambiarPaginaHistorial(delta) {
    currentPage += delta;
    renderPaginationHistorial();
}

// Función optimizada para evitar saturación (Debounce)
function solicitarActualizacion() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    cargarDatos();
    refreshTimer = null;
  }, 500); // Espera 500ms antes de recargar
}

// Helper para notificaciones visuales
function mostrarNotificacion(mensaje, icono = 'info') {
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: icono,
      title: mensaje,
      showConfirmButton: false,
      timer: 4000,
      timerProgressBar: true
    });
  } else {
    console.log(`[${icono.toUpperCase()}] ${mensaje}`);
  }
}

// Limpia el historial de turnos que ya no están activos.
async function limpiarHistorialTurnos() {
  if (!negocioId) return;
  
  Swal.fire({
    title: '¿Limpiar historial de hoy?',
    text: "Se eliminarán los turnos atendidos y cancelados de la fecha actual.",
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#3085d6',
    confirmButtonText: 'Sí, limpiar'
  }).then(async (result) => {
    if (result.isConfirmed) {
      try {
        const hoyLocal = ymdLocal(new Date());
        const { error } = await supabase
          .from('turnos')
          .delete()
          .eq('negocio_id', negocioId)
          .eq('fecha', hoyLocal) // 8. Mejora: Filtrar siempre por fecha
          .in('estado', ['Atendido', 'Cancelado', 'No presentado']);

        if (error) throw error;
        mostrarNotificacion('Historial limpiado con éxito.', 'success');
        await cargarDatos();
      } catch (error) {
        console.error('Error al limpiar historial:', error);
        mostrarNotificacion('Error al limpiar historial: ' + error.message, 'error');
      }
    }
  });
}

// Configura la suscripción a cambios en la tabla de turnos en tiempo real.
function suscribirseTurnos() {
  if (!negocioId) return;
  if (turnosChannel) supabase.removeChannel(turnosChannel);

  turnosChannel = supabase
    .channel(`turnos-negocio-${negocioId}`)
    .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'turnos',
        filter: `negocio_id=eq.${negocioId}`,
      },
      payload => {
        // 3. Debounce Inteligente: Solo refrescar si afecta al día actual
        const hoyLocal = ymdLocal(new Date());
        if (payload.new && payload.new.fecha && payload.new.fecha !== hoyLocal) return;
        if (payload.old && payload.old.fecha && payload.old.fecha !== hoyLocal) return;

        console.log('🟢 Actualización de turnos en tiempo real:', payload.new.id);
        
        if (payload.eventType === 'INSERT') {
            mostrarNotificacion(`Nuevo turno: ${payload.new.turno} - ${payload.new.nombre}`, 'info');
        }
        
        solicitarActualizacion();
      }
    )
    .subscribe();
}

// Configura la suscripción a cambios en la tabla de citas en tiempo real.
function suscribirseCitas() {
  if (!negocioId) return;
  if (citasChannel) supabase.removeChannel(citasChannel);

  citasChannel = supabase
    .channel(`citas-negocio-${negocioId}`)
    .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'citas',
        filter: `negocio_id=eq.${negocioId}`,
      },
      payload => {
        if (payload.eventType === 'INSERT') {
            const fecha = new Date(payload.new.start_at);
            const hora = fecha.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            mostrarNotificacion(`Nueva cita agendada: ${hora}`, 'success');
        }
        solicitarActualizacion(); // Refrescar tabla
      }
    )
    .subscribe();
}

// Actualiza la tarjeta del turno que está "En atención" y gestiona su temporizador.
function actualizarTurnoEnAtencion(turnosHoy) {
  const enAtencion = turnosHoy.find(t => t.estado === 'En atención');
  const card = document.getElementById('turno-en-atencion-card');
  if (!card) return;

  if (enAtencion) {
    // Optimización: Si es el mismo turno, no reiniciamos el intervalo, solo actualizamos textos si cambiaron
    if (currentAtencionId === enAtencion.id && atencionInterval) {
        return; 
    }
    
    if (atencionInterval) clearInterval(atencionInterval);
    currentAtencionId = enAtencion.id;

    card.classList.remove('hidden');
    document.getElementById('atencion-turno').textContent = enAtencion.turno;
    document.getElementById('atencion-cliente').textContent = enAtencion.nombre;
    document.getElementById('atencion-servicio').textContent = enAtencion.servicio;

    const duracionMin = serviciosCache[enAtencion.servicio];
    const timerEl = document.getElementById('atencion-timer');

    if (duracionMin && enAtencion.started_at && timerEl) {
      const startTime = new Date(enAtencion.started_at).getTime();
      const endTime = startTime + duracionMin * 60 * 1000;

      const updateTimer = () => {
        const restanteMs = Math.max(0, endTime - Date.now());
        const minutos = Math.floor(restanteMs / 60000);
        const segundos = Math.floor((restanteMs % 60000) / 1000);
        timerEl.textContent = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
        if (restanteMs === 0) clearInterval(atencionInterval);
      };

      updateTimer();
      atencionInterval = setInterval(updateTimer, 1000);
    } else if (timerEl) {
      timerEl.textContent = '--:--';
    }
  } else {
    if (atencionInterval) clearInterval(atencionInterval);
    currentAtencionId = null;
    card.classList.add('hidden');
  }
}

// Inicialización segura de la página.
async function init() {
  setupSidebar();
  await ensureSupabase();
  
  // 1. Seguridad: Intentar obtener negocioId desde la sesión (Backend Source of Truth)
  // Eliminado fallback a dataset para evitar manipulación
  const { data: { user } } = await supabase.auth.getUser();
  if (user && user.user_metadata && user.user_metadata.negocio_id) {
      negocioId = user.user_metadata.negocio_id;
  }

  if (!negocioId) {
      console.error('No se pudo identificar el negocio.');
      return;
  }

  await cargarServicios();
  await cargarDatos();
  suscribirseTurnos();
  suscribirseCitas();
  window.limpiarHistorialTurnos = limpiarHistorialTurnos;
  document.getElementById('btnPrevHistorial')?.addEventListener('click', () => cambiarPaginaHistorial(-1));
  document.getElementById('btnNextHistorial')?.addEventListener('click', () => cambiarPaginaHistorial(1));
}

window.addEventListener('DOMContentLoaded', init);

// 4. Memory Leak Prevention: Limpieza al salir
window.addEventListener('beforeunload', () => {
    if (turnosChannel) supabase.removeChannel(turnosChannel);
    if (citasChannel) supabase.removeChannel(citasChannel);
    if (atencionInterval) clearInterval(atencionInterval);
});

function setupSidebar() {
    const btn = document.getElementById('mobile-menu-button');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const closeSidebar = document.getElementById('closeSidebar');
    const sidebarTexts = document.querySelectorAll('.sidebar-text');
    
    if (!sidebar || !btn) {
        console.warn('Elementos del sidebar no encontrados en esta página.');
        return;
    }

    const toggleMobile = () => {
        sidebar.classList.toggle('-translate-x-full');
        if (overlay) {
            overlay.classList.toggle('opacity-0');
            overlay.classList.toggle('pointer-events-none');
        }
    };

    // Lógica para colapsar sidebar en escritorio
    const toggleDesktop = () => {
        sidebar.classList.toggle('w-64');
        sidebar.classList.toggle('w-20');
        
        // Ocultar/Mostrar textos con transición suave
        sidebarTexts.forEach(el => {
            el.classList.toggle('hidden');
        });
    };

    // Remover listeners anteriores para evitar duplicados si se llama varias veces
    btn.removeEventListener('click', toggleMobile);
    btn.addEventListener('click', toggleMobile);
    
    if (overlay) overlay.addEventListener('click', toggleMobile);
    if (closeSidebar) closeSidebar.addEventListener('click', toggleMobile);
    if (toggleBtn) toggleBtn.addEventListener('click', toggleDesktop);
}
