import { supabase } from './database.js';

/**
 * Obtiene el ID del negocio desde el atributo `data-negocio-id` en el body.
 * @returns {string|undefined} El ID del negocio o undefined si no se encuentra.
 */
function getNegocioId() {
    return document.body.dataset.negocioId;
}

(async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        // No hay sesión activa, redirigir a la página de login correspondiente.
        const negocioId = getNegocioId();
        const loginUrl = negocioId ? `login_${negocioId}.html` : 'login.html';

        console.log(`Usuario no autenticado. Redirigiendo a ${loginUrl}`);
        window.location.replace(loginUrl);
        return;
    }

    // El usuario está autenticado.
    // La sesión es manejada por las librerías de Supabase, no es necesario hacer nada más aquí.
    console.log('Acceso autorizado para:', session.user.email);
})();
