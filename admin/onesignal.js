// admin/onesignal.js

const ONESIGNAL_APP_ID = '85f98db3-968a-4580-bb02-8821411a6bee';
let initPromise = null;

function init() {
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve) => {
        window.OneSignalDeferred = window.OneSignalDeferred || [];
        window.OneSignalDeferred.push(async function(OneSignal) {
            try {
                await OneSignal.init({
                    appId: ONESIGNAL_APP_ID,
                    serviceWorkerPath: 'sw.js',
                    allowLocalhostAsSecureOrigin: true
                });
                console.log('OneSignal SDK Initialized.');
            } catch (error) {
                console.error('Error initializing OneSignal:', error);
            } finally {
                resolve();
            }
        });
    });
    return initPromise;
}

async function login(externalId, tags = {}) {
    if (!externalId) {
        console.warn('OneSignal: externalId no proporcionado para login.');
        return;
    }

    await init();

    window.OneSignalDeferred.push(async function(OneSignal) {
        try {
            if (!OneSignal || !OneSignal.User) {
                console.warn("OneSignal SDK no está listo o User no definido.");
                return;
            }

            const currentId = OneSignal.User.externalId;
            if (currentId === String(externalId)) {
                console.log(`OneSignal: Usuario ya identificado como ${externalId}.`);
                if (tags && Object.keys(tags).length > 0) {
                    OneSignal.User.addTags(tags);
                }
                return;
            }

            // Verificar si ya tiene una suscripción activa antes de intentar login
            const hasSubscription = !!OneSignal.User.PushSubscription.id;
            
            if (hasSubscription && currentId) {
                console.log('OneSignal: El usuario ya tiene una suscripción y un ID vinculado.');
                if (tags && Object.keys(tags).length > 0) {
                    OneSignal.User.addTags(tags);
                }
                return;
            }

            console.log(`OneSignal: Identificando usuario como "${externalId}"...`);
            try {
                await OneSignal.login(String(externalId));
                console.log(`OneSignal: Login exitoso para ${externalId}`);
            } catch (err) {
                // Si es un 409 o similar, OneSignal ya maneja la identidad si es posible.
                // A veces ocurre si el ID ya está en uso por otra suscripción.
                console.warn('OneSignal: Error no crítico durante login (posible conflicto):', err);
            }
            
            if (tags && Object.keys(tags).length > 0) {
                OneSignal.User.addTags(tags);
            }
        } catch (error) {
            console.error('Error durante el login de OneSignal:', error);
        }
    });
}

async function logout() {
    await init();
    window.OneSignalDeferred.push(async function(OneSignal) {
        try {
            await OneSignal.logout();
            console.log('OneSignal: Usuario deslogueado.');
        } catch (error) {
            console.error('Error durante logout de OneSignal:', error);
        }
    });
}

export const OneSignalManager = {
    init,
    login,
    logout,
};
