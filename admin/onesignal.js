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

            console.log(`OneSignal: Identificando usuario como "${externalId}"...`);
            await OneSignal.login(String(externalId));
            
            if (tags && Object.keys(tags).length > 0) {
                OneSignal.User.addTags(tags);
            }
            console.log(`OneSignal: Login exitoso para ${externalId}`);
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
