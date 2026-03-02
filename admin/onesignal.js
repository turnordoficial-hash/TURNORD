// admin/onesignal.js

const ONESIGNAL_APP_ID = '85f98db3-968a-4580-bb02-8821411a6bee';
let isInitialized = false;

async function init() {
    if (isInitialized || !window.OneSignal) return;
    
    await window.OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        serviceWorkerPath: 'sw.js',
    });
    isInitialized = true;
}

async function login(externalId) {
    if (!isInitialized || !window.OneSignal) return;

    const currentExternalId = window.OneSignal.User.externalId;
    if (currentExternalId === String(externalId)) {
        console.log(`OneSignal: El usuario ya está identificado como ${externalId}.`);
        return;
    }

    if (currentExternalId) {
        await window.OneSignal.logout();
    }

    try {
        await window.OneSignal.login(String(externalId));
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
