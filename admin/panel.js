// panel.js
import { supabase } from '../database.js';
import Config from '../config.js';

let negocioId; // Se obtendrá del usuario autenticado
let atencionInterval = null; // Timer para el turno en atención
let serviciosCache = {}; // Cache para duraciones de servicios

// Cargar servicios una vez al inicio
async function cargarServicios() {
  const currentNegocioId = await getNegocioId();
  if (!currentNegocioId) return;
  try {
    const { data, error } = await supabase
      .from('servicios')
      .select('nombre, duracion_min')
      .eq('negocio_id', currentNegocioId);
    if (error) throw error;
    serviciosCache = (data || []).reduce((acc, srv) => {
      acc[srv.nombre] = srv.duracion_min;
      return acc;
    }, {});
  } catch (error) {
    console.error("Error cargando la duración de los servicios:", error);
  }
}

async function getNegocioId() {
  if (negocioId) return negocioId;
  const { data: { user } } = await supabase.auth.getUser();
  if (user && user.user_metadata && user.user_metadata.negocio_id) {
    negocioId = user.user_metadata.negocio_id;
    return negocioId;
  }
  alert('No se pudo obtener el ID del negocio. Por favor, inicie sesión de nuevo.');
  window.location.replace(Config.getRoute('login'));
  return null;
}


// Utilidad: fecha local YYYY-MM-DD
function ymdLocal(dateLike) {
  const d = new Date(dateLike);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Función para actualizar los contadores en el DOM
function actualizarContadores(turnosHoy) {
  document.getElementById('turnosEspera').textContent =
    turnosHoy.filter(t => t.estado === 'En espera').length;
  document.getElementById('turnosAtendidos').textContent =
    turnosHoy.filter(t => t.estado === 'Atendido').length;
  document.getElementById('turnosDia').textContent = turnosHoy.length;
}

// Función para actualizar la tabla con los turnos del día
function actualizarTabla(turnosHoy) {
  const tabla = document.getElementById('tablaHistorial');
  tabla.innerHTML =
    turnosHoy.length === 0
      ? `<tr><td colspan="4" class="py-4 text-center text-gray-500">No hay turnos registrados hoy.</td></tr>`
      : '';

  turnosHoy.forEach(turno => {
    const fila = document.createElement('tr');
    fila.innerHTML = `
      <td class="py-2 px-4 border-b">${turno.turno}</td>
      <td class="py-2 px-4 border-b">${turno.nombre || 'Sin nombre'}</td>
      <td class="py-2 px-4 border-b">${turno.hora || 'Sin hora'}</td>
      <td class="py-2 px-4 border-b">
        <span class="${
          turno.estado === 'En espera'
            ? 'text-yellow-500'
            : turno.estado === 'Atendido'
            ? 'text-green-500'
            : 'text-gray-500'
        } font-bold">${turno.estado}</span>
      </td>
    `;
    tabla.appendChild(fila);
  });
}

// Utilidad: día UTC YYYY-MM-DD
function ymdUTC(dateLike) {
  return new Date(dateLike).toISOString().slice(0, 10);
}

// Función para cargar datos y actualizar vista, devuelve los turnos del día
async function cargarDatos() {
  const currentNegocioId = await getNegocioId();
  if (!currentNegocioId) return;

  try {
    const hoyLocal = ymdLocal(new Date());
    const hoyUTC = ymdUTC(new Date());
    const { data, error } = await supabase
      .from('turnos')
      .select('*')
      .eq('negocio_id', currentNegocioId)
      .or(`fecha.eq.${hoyUTC},fecha.eq.${hoyLocal}`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const turnosHoy = data || [];

    actualizarContadores(turnosHoy);
    actualizarTabla(turnosHoy);
    actualizarTurnoEnAtencion(turnosHoy);

    return turnosHoy;
  } catch (err) {
    console.error('Error al cargar datos:', err);
    const tabla = document.getElementById('tablaHistorial');
    if (tabla) {
      tabla.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-red-500">Error al cargar los datos del panel.</td></tr>`;
    }
    const e1 = document.getElementById('turnosEspera');
    const e2 = document.getElementById('turnosAtendidos');
    const e3 = document.getElementById('turnosDia');
    if (e1) e1.textContent = '0';
    if (e2) e2.textContent = '0';
    if (e3) e3.textContent = '0';
    return [];
  }
}

// Función para limpiar historial del día actual
async function limpiarHistorialTurnos() {
    const currentNegocioId = await getNegocioId();
    if (!currentNegocioId) return;

  if (!confirm('¿Estás seguro que quieres limpiar el historial del día?')) return;

  const btn = document.getElementById('btnLimpiarHistorial');
  const tabla = document.getElementById('tablaHistorial');
  const e1 = document.getElementById('turnosEspera');
  const e2 = document.getElementById('turnosAtendidos');
  const e3 = document.getElementById('turnosDia');

  try {
    btn && (btn.disabled = true, btn.textContent = 'Limpiando...');
    // Borrar todos los turnos que ya no están activos
    const { error: deleteError } = await supabase
      .from('turnos')
      .delete()
      .eq('negocio_id', currentNegocioId)
      .in('estado', ['Atendido', 'Cancelado', 'No presentado']);

    if (deleteError) throw deleteError;

    // Limpiar UI inmediata
    if (tabla) tabla.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-gray-500">No hay turnos registrados hoy.</td></tr>`;
    if (e1) e1.textContent = '0';
    if (e2) e2.textContent = '0';
    if (e3) e3.textContent = '0';

    alert('✅ Historial limpiado con éxito');

    // Refrescar de la fuente para confirmar estado
    await cargarDatos();
  } catch (error) {
    console.error('Error al limpiar historial:', error);
    alert('❌ Error al limpiar historial: ' + (error?.message || error));
  } finally {
    btn && (btn.disabled = false, btn.textContent = 'Limpiar historial');
  }
}

// Suscripción en tiempo real para actualizar datos al instante
async function suscribirseTurnos() {
    const currentNegocioId = await getNegocioId();
    if (!currentNegocioId) return;

  supabase
    .channel('canal-turnos')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'turnos',
        filter: `negocio_id=eq.${currentNegocioId}`,
      },
      async payload => {
        console.log('🟢 Actualización en tiempo real:', payload);
        await cargarDatos();
      }
    )
    .subscribe();
}

// Función para resaltar menú activo en sidebar
function resaltarMenu() {
  const path = window.location.pathname.split('/').pop();
  document.querySelectorAll('aside nav a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === path) {
      link.classList.add('bg-white', 'text-blue-900', 'font-semibold', 'shadow');
    } else {
      link.classList.remove('bg-white', 'text-blue-900', 'font-semibold', 'shadow');
    }
  });
}

// Función para actualizar el turno en atención y su timer
function actualizarTurnoEnAtencion(turnosHoy) {
  const enAtencion = turnosHoy.find(t => t.estado === 'En atención');
  const card = document.getElementById('turno-en-atencion-card');

  if (atencionInterval) {
    clearInterval(atencionInterval);
    atencionInterval = null;
  }

  if (enAtencion && card) {
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
        const ahora = Date.now();
        const restanteMs = Math.max(0, endTime - ahora);

        if (restanteMs === 0) {
          timerEl.textContent = '00:00';
          clearInterval(atencionInterval);
          return;
        }

        const minutos = Math.floor(restanteMs / 60000);
        const segundos = Math.floor((restanteMs % 60000) / 1000);
        timerEl.textContent = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
      };

      updateTimer(); // Llama inmediatamente para no esperar 1 segundo
      atencionInterval = setInterval(updateTimer, 1000);
    } else {
      if (timerEl) timerEl.textContent = '--:--';
    }
  } else if (card) {
    card.classList.add('hidden');
  }
}

// Inicialización al cargar la página
window.addEventListener('DOMContentLoaded', async () => {
  await getNegocioId();
  await cargarServicios(); // Cargar duración de servicios
  resaltarMenu();
  cargarDatos();
  suscribirseTurnos();
});

// Exponer limpiar historial al global para el botón
window.limpiarHistorialTurnos = limpiarHistorialTurnos;
