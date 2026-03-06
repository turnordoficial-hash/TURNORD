// OneSignal Service Worker v16
// El listener debe estar en el nivel superior para la evaluación inicial
self.addEventListener('message', (event) => {
    // Registrado inmediatamente para cumplir con la política de evaluación inicial de Chrome
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
