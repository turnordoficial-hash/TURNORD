import { supabase, ensureSupabase } from '../database.js';

let atencionInterval = null; // Timer para el turno en atención
let serviciosCache = {}; // Cache para duraciones de servicios
let refreshTimer = null; // Timer para debounce
let currentAtencionId = null; // Para evitar reiniciar timer si es el mismo turno
let negocioId = null; // Se inicializa de forma segura
let turnosChannel = null;
let citasChannel = null;

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
function actualizarTabla(turnosHoy) {
  const tabla = document.getElementById('tablaHistorial');
  if (!tabla) return;

  tabla.innerHTML = turnosHoy.length === 0
      ? `<tr><td colspan="4" class="py-4 text-center text-gray-500">No hay turnos registrados hoy.</td></tr>`
      : turnosHoy.map(turno => `
          <tr>
            <td class="py-2 px-4 border-b dark:border-gray-700">${turno.turno}</td>
            <td class="py-2 px-4 border-b dark:border-gray-700">${turno.nombre || 'N/A'}</td>
            <td class="py-2 px-4 border-b dark:border-gray-700">${turno.hora || 'N/A'}</td>
            <td class="py-2 px-4 border-b dark:border-gray-700">
              <span class="${turno.estado === 'En espera' ? 'text-yellow-500' : turno.estado === 'Atendido' ? 'text-green-500' : 'text-gray-500'} font-bold">${turno.estado}</span>
            </td>
          </tr>
        `).join('');
}

// Carga los datos principales de la página (turnos) y actualiza la UI.
async function cargarDatos() {
  if (!negocioId) return;

  try {
    const hoyLocal = ymdLocal(new Date());
    const { data, error } = await supabase
      .from('turnos')
      .select('id, turno, nombre, estado, hora, servicio, started_at, created_at') // 2. Optimización de consulta
      .eq('negocio_id', negocioId)
      .eq('fecha', hoyLocal)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const turnosHoy = data || [];
    actualizarContadores(turnosHoy);
    actualizarTabla(turnosHoy);
    actualizarTurnoEnAtencion(turnosHoy);

  } catch (err) {
    console.error('Error al cargar datos del panel:', err);
    handleAuthError(err);
    document.getElementById('tablaHistorial').innerHTML = `<tr><td colspan="4" class="py-4 text-center text-red-500">Error al cargar los datos.</td></tr>`;
  }
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
  setupSidebar();
  window.limpiarHistorialTurnos = limpiarHistorialTurnos;
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
    
    if (!sidebar) return;

    const toggleMobile = () => {
        if (window.innerWidth < 1024) {
            sidebar.classList.toggle('-translate-x-full');
            if (overlay) {
                overlay.classList.toggle('opacity-0');
                overlay.classList.toggle('pointer-events-none');
            }
        }
    };

    // Lógica para colapsar sidebar en escritorio
    const toggleDesktop = () => {
        sidebar.classList.toggle('w-64');
        sidebar.classList.toggle('w-20');
        
        // Ocultar/Mostrar textos con transición suave
        const texts = sidebar.querySelectorAll('.sidebar-text');
        texts.forEach(el => {
            el.classList.toggle('hidden');
        });
    };

    if (btn) btn.addEventListener('click', toggleMobile);
    if (overlay) overlay.addEventListener('click', toggleMobile);
    if (closeSidebar) closeSidebar.addEventListener('click', toggleMobile);
    if (toggleBtn) toggleBtn.addEventListener('click', toggleDesktop);
}
