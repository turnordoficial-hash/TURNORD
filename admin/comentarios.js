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

let currentPage = 1;
const itemsPerPage = 5;

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

async function cargarComentarios(page = 1) {
    if (!negocioId) return;
    currentPage = page;

    try {
        const from = (page - 1) * itemsPerPage;
        const to = from + itemsPerPage - 1;

        const { data, count, error } = await supabase
            .from('comentarios')
            .select('*', { count: 'exact' })
            .eq('negocio_id', negocioId)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) throw error;
        renderComentarios(data);
        renderPaginationControls(count);
    } catch (error) {
        console.error('Error al cargar comentarios:', error);
        const tablaBody = document.getElementById('tabla-comentarios');
        if (tablaBody) {
            tablaBody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-red-500">Error al cargar los comentarios.</td></tr>`;
        }
    }
}

function renderPaginationControls(totalCount) {
    const totalPages = Math.ceil(totalCount / itemsPerPage) || 1;
    let container = document.getElementById('comentarios-pagination');
    
    if (!container) {
        const table = document.getElementById('tabla-comentarios').closest('table');
        if (table && table.parentElement) {
            container = document.createElement('div');
            container.id = 'comentarios-pagination';
            container.className = 'flex justify-between items-center mt-4 pt-4 border-t border-gray-100 dark:border-gray-700';
            table.parentElement.appendChild(container);
        } else {
            return;
        }
    }

    // Lógica de paginación numérica (1, 2, 3...)
    let pagesHtml = '';
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);

    if (endPage - startPage + 1 < maxVisible) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        pagesHtml += `<button onclick="window.cambiarPaginaComentarios(${i - currentPage})" class="px-3 py-1.5 text-sm font-medium rounded-lg ${i === currentPage ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'} transition-colors">${i}</button>`;
    }

    container.innerHTML = `
        <   ${pagesHtml}
            <button onclick="window.cambiarPaginaComentarios(1)" ${currentPage === totalPages ? 'disabled' : ''} class="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Siguiente</button>
        </div>
    `;
}

window.cambiarPaginaComentarios = (delta) => {
    cargarComentarios(currentPage + delta);
};

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
            cargarComentarios(1); // Recargar primera página al recibir nuevo comentario
        }
        )
        .subscribe();

    return channel;
}

window.addEventListener('DOMContentLoaded', async () => {
    setupSidebar();
    if (!negocioId) return;
    await ensureSupabase();
    await cargarComentarios();
    suscribirseAComentarios();
});

function setupSidebar() {
    const btn = document.getElementById('mobile-menu-button');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const closeSidebar = document.getElementById('closeSidebar');
    
    if (!sidebar) return;

    const toggleMobile = () => {
        sidebar.classList.toggle('-translate-x-full');
        if (overlay) overlay.classList.toggle('opacity-0');
        if (overlay) overlay.classList.toggle('pointer-events-none');
    };

    if (btn) btn.addEventListener('click', toggleMobile);
    if (overlay) overlay.addEventListener('click', toggleMobile);
    if (closeSidebar) closeSidebar.addEventListener('click', toggleMobile);

    if (toggleBtn) toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('w-64');
        sidebar.classList.toggle('w-20');
        sidebar.querySelectorAll('.sidebar-text').forEach(el => el.classList.toggle('hidden'));
    });
}
