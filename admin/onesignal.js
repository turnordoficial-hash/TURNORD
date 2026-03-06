// admin/onesignal.js

const ONESIGNAL_APP_ID = '85f98db3-968a-4580-bb02-8821411a6bee';
let isInitialized = false;

async function init() {
    if (isInitialized || !window.OneSignal) return;
    
    try {
        // En v16, OneSignal ya puede estar inicializado si se usa OneSignalDeferred.
        // Solo llamamos a init si no se ha hecho.
        if (typeof window.OneSignal.init === 'function') {
            await window.OneSignal.init({
                appId: ONESIGNAL_APP_ID,
                serviceWorkerPath: 'sw.js',
                allowLocalhostAsSecureOrigin: true 
            });
        }
        isInitialized = true;
    } catch (error) {
        if (error && (error.message && error.message.includes('already initialized') || error.code === 'already_initialized')) {
            console.warn('OneSignal ya estaba inicializado.');
            isInitialized = true;
        } else {
            console.error('Error inicializando OneSignal:', error);
            // No lanzamos el error para evitar que rompa el flujo principal
        }
    }
}

async function login(externalId, tags = {}) {
    if (!externalId) {
        console.warn('OneSignal: externalId no proporcionado.');
        return;
    }

    if (!isInitialized || !window.OneSignal) {
        await init();
    }
    
    // Esperar un momento para asegurar que User está listo
    if (window.OneSignal && !window.OneSignal.User) {
        console.warn('OneSignal: User object not ready. Waiting...');
        await new Promise(r => setTimeout(r, 1000));
    }

    if (!isInitialized || !window.OneSignal || !window.OneSignal.User) {
        console.error('OneSignal: No se pudo inicializar o User no está disponible.');
        return;
    }

    let currentExternalId = null;
    try {
        currentExternalId = window.OneSignal.User.externalId;
    } catch (e) {
        console.warn('OneSignal: No se pudo obtener el externalId actual:', e);
    }

    if (currentExternalId === String(externalId)) {
        console.log(`OneSignal: El usuario ya está identificado como ${externalId}.`);
        if (Object.keys(tags).length > 0) {
            window.OneSignal.User.addTags(tags);
        }
        return;
    }

    try {
        console.log(`OneSignal: Identificando usuario como "${externalId}" (Length: ${String(externalId).length})...`);
        
        // En v16, login es asíncrono y devuelve una promesa
        await window.OneSignal.login(String(externalId));
        
        if (Object.keys(tags).length > 0) {
            window.OneSignal.User.addTags(tags);
        }
        console.log(`OneSignal: Usuario identificado con éxito.`);
    } catch (error) {
        // Manejar errores de forma más silenciosa si son comunes
        if (error && (error.status === 409 || error.code === 409)) {
            console.warn('OneSignal: Conflicto de identidad (409), el usuario ya existe.');
        } else if (error && (error.status === 400 || error.code === 400)) {
            console.error('OneSignal: Error 400 - Solicitud inválida. ID:', externalId, 'Error:', error);
        } else {
            console.error('Error detallado en OneSignal login:', error);
        }
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
