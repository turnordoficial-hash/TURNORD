import { ensureSupabase } from './database.js';

/**
 * Obtiene el ID del negocio desde el atributo `data-negocio-id` en el body.
 * @returns {string|undefined} El ID del negocio o undefined si no se encuentra.
 */
function getNegocioId() {
    return document.body.dataset.negocioId;
}

(async () => {
    const client = await ensureSupabase();
    const { data: { session } } = await client.auth.getSession();
    const negocioId = getNegocioId();
    const loginUrl = negocioId ? `login_${negocioId}.html` : 'login.html';
    const redirectToLogin = () => { window.location.replace(loginUrl); };

    if (!session) {
        redirectToLogin();
        return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = session.expires_at || 0;
    if (expSec - 30 <= nowSec) {
        const { data, error } = await client.auth.refreshSession();
        if (error || !data?.session) {
            await client.auth.signOut();
            redirectToLogin();
            return;
        }
    }

    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        // Al cerrar sesión en Supabase, también cerramos sesión en OneSignal
        // para evitar conflictos de identidad si otro usuario inicia sesión.
        window.OneSignal = window.OneSignal || [];
        window.OneSignal.push(function() {
          OneSignal.logout();
        });
        redirectToLogin();
      }
    });
    console.log('Acceso autorizado para:', session.user.email);
})();
