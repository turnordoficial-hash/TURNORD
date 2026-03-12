const ONESIGNAL_APP_ID = '85f98db3-968a-4580-bb02-8821411a6bee';

let initialized = false;
let initError = false;

async function init() {
    if (initialized) return;
    
    // Si ya hubo un error de dominio, no intentar más
    if (initError) return;

    // Validación de dominio para evitar errores en localhost o dominios no autorizados
    const allowedDomain = 'jbarber.vip';
    const currentDomain = window.location.hostname;
    
    if (currentDomain !== allowedDomain && !currentDomain.includes('localhost') && !currentDomain.includes('127.0.0.1')) {
        console.warn(`OneSignal: El dominio ${currentDomain} no coincide con ${allowedDomain}. SDK omitido.`);
        initError = true;
        return;
    }

    window.OneSignalDeferred = window.OneSignalDeferred || [];

    return new Promise((resolve) => {
        window.OneSignalDeferred.push(async function (OneSignal) {
            try {
                // Verificar si ya está inicializado por el SDK mismo
                if (OneSignal.initialized) {
                    initialized = true;
                    resolve();
                    return;
                }

                await OneSignal.init({
                    appId: ONESIGNAL_APP_ID,
                    serviceWorkerPath: 'sw.js',
                    allowLocalhostAsSecureOrigin: true
                });

                initialized = true;
                console.log("OneSignal inicializado");

            } catch (error) {
                if (error.message?.includes('already initialized')) {
                    initialized = true;
                } else {
                    console.error("Error iniciando OneSignal:", error);
                    initError = true;
                }
            }

            resolve();
        });
    });
}

async function login(externalId, tags = {}) {
    if (!externalId) return;

    await init();
    if (!initialized) return;

    window.OneSignalDeferred.push(async function (OneSignal) {

        try {

            const currentId = OneSignal.User.externalId;

            if (currentId === String(externalId)) {
                console.log("Usuario ya conectado:", externalId);
                return;
            }

            await OneSignal.login(String(externalId));

            console.log("Login OneSignal OK:", externalId);

            if (Object.keys(tags).length) {
                await OneSignal.User.addTags(tags);
            }

            // --- REGISTRO EN SUPABASE ---
            // Usamos externalId (teléfono) como fuente de verdad para el registro
            if (externalId && tags.cliente_id) {
                const { ensureSupabase } = await import('../database.js?v=2');
                const sb = await ensureSupabase();
                
                const isAndroid = /Android/i.test(navigator.userAgent);
                const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
                const deviceType = isAndroid ? 'Android' : (isIOS ? 'iOS' : 'Web');
                const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

                // Intentar obtener el ID de suscripción actual si existe
                const pushId = OneSignal.User.pushSubscriptionId;

                // Actualizar según el rol (cliente o barbero)
                if (tags.role === 'cliente') {
                    const updateData = { 
                        device_type: deviceType,
                        pwa_installed: isPWA
                    };
                    if (pushId) updateData.onesignal_player_id = pushId;

                    await sb.from('clientes').update(updateData).eq('id', tags.cliente_id);
                } else if (tags.role === 'barbero' && tags.barber_id) {
                    if (pushId) {
                        await sb.from('barberos').update({ 
                            onesignal_player_id: pushId 
                        }).eq('id', tags.barber_id);
                    }
                }
                console.log("OneSignal: Sincronización con Supabase finalizada");
            }

        } catch (err) {
            // Silenciar el error 409 Conflict - OneSignal ya está manejando la identidad
            if (err?.status === 409 || (err?.message && err.message.includes('409'))) {
                console.log("OneSignal: Identidad ya vinculada (Conflict 409 ignorado)");
                return;
            }
            console.error("Error en operación OneSignal:", err);
        }

    });
}

async function logout() {

    await init();

    window.OneSignalDeferred.push(async function (OneSignal) {
        try {

            await OneSignal.logout();
            console.log("Logout OneSignal");

        } catch (error) {
            console.error("Error logout OneSignal:", error);
        }
    });
}

export const OneSignalManager = {
    init,
    login,
    logout,
};
