importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// OneSignal Service Worker v16 - Minimal implementation
// El listener debe estar en el nivel superior para la evaluación inicial
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
