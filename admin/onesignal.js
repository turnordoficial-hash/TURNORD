const ONESIGNAL_APP_ID = '85f98db3-968a-4580-bb02-8821411a6bee';

let initialized = false;

async function init() {
    if (initialized) return;

    window.OneSignalDeferred = window.OneSignalDeferred || [];

    return new Promise((resolve) => {
        window.OneSignalDeferred.push(async function (OneSignal) {
            try {

                await OneSignal.init({
                    appId: ONESIGNAL_APP_ID,
                    serviceWorkerPath: '/sw.js',
                    allowLocalhostAsSecureOrigin: true
                });

                initialized = true;

                console.log("OneSignal inicializado");

            } catch (error) {
                console.error("Error iniciando OneSignal:", error);
            }

            resolve();
        });
    });
}

async function login(externalId, tags = {}) {

    if (!externalId) return;

    await init();

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

        } catch (err) {

            if (err?.status === 409) {
                console.warn("OneSignal conflicto de identidad (no crítico)");
            } else {
                console.error("Error login OneSignal:", err);
            }

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
