// sw.js - OneSignal Service Worker Standard
self.addEventListener('message', (event) => {
    // Manejador de eventos 'message' en la evaluación inicial para evitar advertencias en Chrome
    // El SDK de OneSignal añadirá sus propios manejadores.
});
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
