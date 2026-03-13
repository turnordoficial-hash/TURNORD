const ONESIGNAL_APP_ID = '85f98db3-968a-4580-bb02-8821411a6bee';

let initialized = false;
let initError = false;
let isSDKDisabled = false;

// Manejo global de errores de promesas para OneSignal/IndexedDB
// Esto evita que el navegador muestre errores fatales si IndexedDB falla
if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (e) => {
        const msg = e?.reason?.message || '';
        const name = e?.reason?.name || '';
        
        if (
            name === 'UnknownError' || 
            msg.includes('indexedDB') || 
            msg.includes('backing store') ||
            msg.includes('OneSignal')
        ) {
            console.warn('OneSignal: Error interceptado para evitar crash del sistema.');
            isSDKDisabled = true;
            e.preventDefault();
        }
    });
}

async function init() {
    if (initialized) return;
    if (initError || isSDKDisabled) return;

    // Validación de dominio
    const allowedDomain = 'jbarber.vip';
    const currentDomain = window.location.hostname;
    
    if (currentDomain !== allowedDomain && !currentDomain.includes('localhost') && !currentDomain.includes('127.0.0.1')) {
        console.warn(`OneSignal: El dominio ${currentDomain} no coincide con ${allowedDomain}. SDK omitido.`);
        isSDKDisabled = true;
        return;
    }

    // Verificar disponibilidad de IndexedDB antes de iniciar
    try {
        if (!window.indexedDB) {
            console.warn("OneSignal: IndexedDB no disponible. SDK desactivado.");
            isSDKDisabled = true;
            return;
        }
    } catch (e) {
        isSDKDisabled = true;
        return;
    }

    window.OneSignalDeferred = window.OneSignalDeferred || [];

    return new Promise((resolve) => {
        window.OneSignalDeferred.push(async function (OneSignal) {
            try {
                if (OneSignal.initialized) {
                    initialized = true;
                    resolve();
                    return;
                }

                await OneSignal.init({
                    appId: ONESIGNAL_APP_ID,
                    serviceWorkerPath: 'sw.js',
                    allowLocalhostAsSecureOrigin: true
                }).catch(err => {
                    if (err?.message?.includes('indexedDB') || err?.name === 'UnknownError') {
                        console.warn("OneSignal: Fallo crítico de IndexedDB en init.");
                        isSDKDisabled = true;
                        throw err;
                    }
                });

                initialized = true;
                console.log("OneSignal inicializado");

            } catch (error) {
                if (error.message?.includes('already initialized')) {
                    initialized = true;
                } else {
                    console.error("Error iniciando OneSignal:", error);
                    initError = true;
                    isSDKDisabled = true;
                }
            }

            resolve();
        });
    });
}

async function login(externalId, tags = {}) {
  if (!externalId || isSDKDisabled) return;

  try {
    await init();
    if (!initialized || isSDKDisabled) return;

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async function (OneSignal) {
      try {
        // Verificación extra de salud del SDK antes de llamar a login
        if (!OneSignal || !OneSignal.User) {
          console.warn("OneSignal: SDK no está en un estado saludable para login.");
          return;
        }

        const currentId = OneSignal.User.externalId;
        if (currentId !== String(externalId)) {
          await OneSignal.login(String(externalId));
          console.log("Login OneSignal OK:", externalId);
        } else {
          console.log("OneSignal: Usuario ya conectado (login omitido)");
        }

        if (Object.keys(tags).length) {
          await OneSignal.User.addTags(tags);
        }

        // --- REGISTRO EN SUPABASE ---
        if (externalId && (tags.cliente_id || tags.barber_id)) {
          const { ensureSupabase } = await import('../database.js?v=2');
          const sb = await ensureSupabase();
          
          const isAndroid = /Android/i.test(navigator.userAgent);
          const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
          const deviceType = isAndroid ? 'Android' : (isIOS ? 'iOS' : 'Web');
          const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

          const pushId = OneSignal.User.pushSubscriptionId;

          if (tags.role === 'cliente' && tags.cliente_id) {
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
        // Ignorar errores de conflicto (409) o TypeErrors ('Ye') para no romper el flujo.
        if (err?.status === 409 || (err?.message && err.message.includes('409')) || err instanceof TypeError) {
          console.warn("OneSignal: Error de login ignorado para no romper el flujo:", err.message);
          if (err instanceof TypeError) isSDKDisabled = true;
        } else {
          console.error("Error en operación OneSignal (dentro de push):", err);
        }
      }
    });
  } catch (e) {
    console.warn("Error en el proceso de login de OneSignal (fuera de push):", e);
  }
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
