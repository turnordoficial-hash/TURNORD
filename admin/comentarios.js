import { supabase } from '../database.js';

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
    await cargarComentarios();
    suscribirseAComentarios();
});
