// admin/onesignal.js

const ONESIGNAL_APP_ID = '85f98db3-968a-4580-bb02-8821411a6bee';
let isInitialized = false;

async function init() {
    if (isInitialized || !window.OneSignal) return;
    
    try {
        await window.OneSignal.init({
            appId: ONESIGNAL_APP_ID,
            serviceWorkerPath: 'sw.js',
            allowLocalhostAsSecureOrigin: true // Útil para desarrollo local
        });
        isInitialized = true;
    } catch (error) {
        if (error.message && error.message.includes('already initialized')) {
            console.warn('OneSignal ya estaba inicializado.');
            isInitialized = true;
        } else {
            throw error;
        }
    }
}

async function login(externalId, tags = {}) {
    if (!isInitialized || !window.OneSignal) {
        await init();
    }
    if (!isInitialized) return;

    const currentExternalId = window.OneSignal.User.externalId;
    if (currentExternalId === String(externalId)) {
        console.log(`OneSignal: El usuario ya está identificado como ${externalId}.`);
        // Asegurar que los tags estén actualizados aunque ya esté logueado
        if (Object.keys(tags).length > 0) {
            window.OneSignal.User.addTags(tags);
        }
        return;
    }

    // Cerrar sesión previa si hay un ID diferente para evitar conflictos 409
    if (currentExternalId && currentExternalId !== String(externalId)) {
        console.log(`OneSignal: Cambiando de usuario ${currentExternalId} a ${externalId}.`);
        await window.OneSignal.logout();
    }

    try {
        await window.OneSignal.login(String(externalId));
        if (Object.keys(tags).length > 0) {
            window.OneSignal.User.addTags(tags);
        }
        console.log(`OneSignal: Usuario identificado como ${externalId}.`);
    } catch (error) {
        console.error('Error en OneSignal login:', error);
    }
}

async function logout() {
    if (!isInitialized || !window.OneSignal) return;
    await window.OneSignal.logout();
}

export const OneSignalManager = {
    init,
    login,
    logout,
};
