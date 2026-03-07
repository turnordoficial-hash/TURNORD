/**
 * admin/promociones.js
 * Sistema de Recompensas, Puntos y Enganche (Fidelización)
 */

import { supabase } from '../database.js?v=2';

const PUNTOS_POR_CADA_RD = 0.1; // 1 punto por cada 10 RD$
export const RECOMPENSAS = [
    { id: 'desc_10', pts: 250, label: '10% Descuento', icon: '🏷️', color: 'bg-blue-500' },
    { id: 'lavado', pts: 500, label: 'Lavado Gratis', icon: '🧴', color: 'bg-purple-500' },
    { id: 'corte_gratis', pts: 900, label: 'Corte Gratis', icon: '🎁', color: 'bg-emerald-500' }
];

/**
 * Calcula los puntos ganados por un monto
 * @param {number} monto 
 * @returns {number}
 */
export function calcularPuntosGanados(monto) {
    return Math.floor(monto * PUNTOS_POR_CADA_RD);
}

/**
 * Obtiene las recompensas disponibles para un cliente según sus puntos
 * @param {number} puntos 
 * @returns {Array}
 */
export function obtenerRecompensasDisponibles(puntos) {
    return RECOMPENSAS.map(r => ({
        ...r,
        desbloqueado: puntos >= r.pts,
        progreso: Math.min(100, (puntos / r.pts) * 100)
    }));
}

/**
 * Registra puntos para un cliente después de un pago
 * @param {string} telefono 
 * @param {number} puntos 
 * @param {string} negocioId 
 */
export async function sumarPuntosCliente(telefono, puntos, negocioId) {
    if (!telefono || puntos <= 0) return;

    try {
        // Obtenemos puntos actuales
        const { data: cliente, error: errorFetch } = await supabase
            .from('clientes')
            .select('puntos')
            .eq('negocio_id', negocioId)
            .eq('telefono', telefono)
            .maybeSingle();

        if (errorFetch) throw errorFetch;

        const nuevosPuntos = (cliente?.puntos || 0) + puntos;

        const { error: errorUpdate } = await supabase
            .from('clientes')
            .update({ puntos: nuevosPuntos })
            .eq('negocio_id', negocioId)
            .eq('telefono', telefono);

        if (errorUpdate) throw errorUpdate;
        
        console.log(`Puntos actualizados para ${telefono}: +${puntos} (Total: ${nuevosPuntos})`);
        return nuevosPuntos;
    } catch (e) {
        console.error('Error al actualizar puntos:', e);
        return null;
    }
}
