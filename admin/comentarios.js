import { supabase, ensureSupabase } from '../database.js';

function getNegocioId() {
    const id = document.body.dataset.negocioId;
    if (!id) {
        console.error('Error crítico: Atributo data-negocio-id no encontrado en el body.');
        alert('Error de configuración: No se pudo identificar el negocio.');
    }
    return id;
}

const negocioId = getNegocioId();

function renderComentarios(comentarios) {
    const tablaBody = document.getElementById('tabla-comentarios');
    if (!tablaBody) return;

    if (comentarios.length === 0) {
        tablaBody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-gray-500">No hay comentarios aún.</td></tr>';
        return;
    }

    tablaBody.innerHTML = comentarios.map(comentario => {
        const calificacionEstrellas = '★'.repeat(comentario.calificacion) + '☆'.repeat(5 - comentario.calificacion);
        const sentimientoColor = comentario.sentimiento_score > 0.1 ? 'text-green-500' : comentario.sentimiento_score < -0.1 ? 'text-red-500' : 'text-gray-500';
        const sentimientoTexto = comentario.sentimiento_score > 0.1 ? 'Positivo' : comentario.sentimiento_score < -0.1 ? 'Negativo' : 'Neutral';

        return `
            <tr>
                <td class="py-2 px-4 border-b dark:border-gray-700">${comentario.nombre_cliente || 'Anónimo'}</td>
                <td class="py-2 px-4 border-b dark:border-gray-700 text-yellow-500">${calificacionEstrellas}</td>
                <td class="py-2 px-4 border-b dark:border-gray-700">${comentario.comentario || '<em>Sin comentario</em>'}</td>
                <td class="py-2 px-4 border-b dark:border-gray-700 ${sentimientoColor}">${sentimientoTexto} (${comentario.sentimiento_score.toFixed(2)})</td>
                <td class="py-2 px-4 border-b dark:border-gray-700">${new Date(comentario.created_at).toLocaleString('es-DO')}</td>
            </tr>
        `;
    }).join('');
}

async function cargarComentarios() {
    if (!negocioId) return;

    try {
        const { data, error } = await supabase
            .from('comentarios')
            .select('*')
            .eq('negocio_id', negocioId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        renderComentarios(data);
    } catch (error) {
        console.error('Error al cargar comentarios:', error);
        const tablaBody = document.getElementById('tabla-comentarios');
        if (tablaBody) {
            tablaBody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-red-500">Error al cargar los comentarios.</td></tr>`;
        }
    }
}

function suscribirseAComentarios() {
    if (!negocioId) return;

    const channel = supabase
        .channel(`comentarios-negocio-${negocioId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'comentarios',
            filter: `negocio_id=eq.${negocioId}`,
        },
        (payload) => {
            console.log('Nuevo comentario recibido:', payload.new.id);
            cargarComentarios();
        }
        )
        .subscribe();

    return channel;
}

window.addEventListener('DOMContentLoaded', async () => {
    if (!negocioId) return;
    await ensureSupabase();
    await cargarComentarios();
    suscribirseAComentarios();
    setupSidebar();
});

function setupSidebar() {
    const btn = document.getElementById('mobile-menu-button');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (!sidebar) return;

    if (btn) btn.addEventListener('click', () => {
        sidebar.classList.toggle('-translate-x-full');
        if (overlay) overlay.classList.toggle('opacity-0');
        if (overlay) overlay.classList.toggle('pointer-events-none');
    });
    if (overlay) overlay.addEventListener('click', () => {
        sidebar.classList.toggle('-translate-x-full');
        overlay.classList.toggle('opacity-0');
        overlay.classList.toggle('pointer-events-none');
    });
    if (toggleBtn) toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('w-64');
        sidebar.classList.toggle('w-20');
        sidebar.querySelectorAll('.sidebar-text').forEach(el => el.classList.toggle('hidden'));
    });
}
