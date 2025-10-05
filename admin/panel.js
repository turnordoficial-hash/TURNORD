import { supabase } from '../database.js';

let atencionInterval = null; // Timer para el turno en atención
let serviciosCache = {}; // Cache para duraciones de servicios

/**
 * Obtiene el ID del negocio desde el atributo `data-negocio-id` en el body.
 * Este ID es crucial para todas las operaciones de la base de datos en esta página.
 * @returns {string|null} El ID del negocio o null si no está presente.
 */
function getNegocioId() {
  const id = document.body.dataset.negocioId;
  if (!id) {
    console.error('Error crítico: Atributo data-negocio-id no encontrado en el body.');
    alert('Error de configuración: No se pudo identificar el negocio. Contacte a soporte.');
  }
  return id;
}

// Obtener el ID del negocio al inicio y usarlo globalmente en este script.
const negocioId = getNegocioId();

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
      .select('*')
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
    document.getElementById('tablaHistorial').innerHTML = `<tr><td colspan="4" class="py-4 text-center text-red-500">Error al cargar los datos.</td></tr>`;
  }
}

// Limpia el historial de turnos que ya no están activos.
async function limpiarHistorialTurnos() {
  if (!negocioId) return;
  if (!confirm('¿Estás seguro de que quieres limpiar el historial de turnos atendidos y cancelados del día?')) return;

  const btn = document.getElementById('btnLimpiarHistorial');

  try {
    btn.disabled = true;
    btn.textContent = 'Limpiando...';

    const { error } = await supabase
      .from('turnos')
      .delete()
      .eq('negocio_id', negocioId)
      .in('estado', ['Atendido', 'Cancelado', 'No presentado']);

    if (error) throw error;

    alert('✅ Historial limpiado con éxito.');
    await cargarDatos(); // Refrescar la vista
  } catch (error) {
    console.error('Error al limpiar historial:', error);
    alert('❌ Error al limpiar historial: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Limpiar historial';
  }
}

// Configura la suscripción a cambios en la tabla de turnos en tiempo real.
function suscribirseTurnos() {
  if (!negocioId) return;

  const channel = supabase
    .channel(`turnos-negocio-${negocioId}`)
    .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'turnos',
        filter: `negocio_id=eq.${negocioId}`,
      },
      payload => {
        console.log('🟢 Actualización de turnos en tiempo real:', payload.new.id);
        cargarDatos();
      }
    )
    .subscribe();

  return channel;
}

// Actualiza la tarjeta del turno que está "En atención" y gestiona su temporizador.
function actualizarTurnoEnAtencion(turnosHoy) {
  const enAtencion = turnosHoy.find(t => t.estado === 'En atención');
  const card = document.getElementById('turno-en-atencion-card');
  if (!card) return;

  if (atencionInterval) {
    clearInterval(atencionInterval);
    atencionInterval = null;
  }

  if (enAtencion) {
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
    card.classList.add('hidden');
  }
}

// Inicialización de la página.
window.addEventListener('DOMContentLoaded', async () => {
  if (!negocioId) return; // Detener si no hay ID de negocio

  await cargarServicios();
  await cargarDatos();
  suscribirseTurnos();

  // Exponer la función de limpiar historial al objeto window para que el HTML la pueda llamar.
  window.limpiarHistorialTurnos = limpiarHistorialTurnos;
});
