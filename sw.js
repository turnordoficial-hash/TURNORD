/**
 * Service Worker - TurnoRD Push Notifications
 */

self.addEventListener("push", (event) => {

  let payload = {
    title: "TurnoRD",
    body: "Hay una nueva notificación para ti.",
    icon: "jbarber/jjj.png",
    url: "panel_cliente.html"
  };

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon || "jbarber/jjj.png",
    badge: "imegenlogin/favicon-32x32.png",
    vibrate: [100, 50, 100],
    data: {
      url: payload.url || "panel_cliente.html"
    },
    actions: [
      {
        action: "view",
        title: "Ver turnos"
      },
      {
        action: "close",
        title: "Cerrar"
      }
    ],
    requireInteraction: true,
    tag: "turnord-notification"
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});


// Cuando el usuario hace click
self.addEventListener("notificationclick", (event) => {

  event.notification.close();

  if (event.action === "close") return;

  const targetUrl = new URL(
    event.notification.data.url,
    self.location.href // Resolver relativo a la ubicación del SW
  ).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {

        // Buscar si ya hay una pestaña abierta con la URL destino
        for (const client of clientList) {
          if (client.url === targetUrl && "focus" in client) {
            return client.focus();
          }
          // Fallback: Si está en el mismo origen, enfocar y navegar
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});


// Activación inmediata
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
