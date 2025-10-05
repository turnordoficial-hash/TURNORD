/**
 * Service Worker for Push Notifications.
 *
 * This worker listens for push events from the server and displays
 * a notification to the user. It also handles notification clicks,
 * focusing on an existing client window or opening a new one.
 */

// Listener for the 'push' event, which is triggered when a push message is received.
self.addEventListener('push', event => {
  // Extract the payload from the push event. We expect it to be a JSON string.
  const payload = event.data ? event.data.json() : {
    title: 'TurnoRD',
    body: 'Hay una nueva notificación para ti.',
    icon: 'imegenlogin/android-chrome-192x192.png'
  };

  // Prepare the notification options from the payload.
  const options = {
    body: payload.body,
    icon: payload.icon || 'imegenlogin/android-chrome-192x192.png', // Default icon
    badge: payload.badge || 'imegenlogin/favicon-32x32.png', // Badge for the notification
    vibrate: [100, 50, 100], // Vibration pattern
    data: {
      url: payload.data?.url || payload.url || '/usuario_barberia005.html', // URL to open on click
      turno: payload.data?.turno || null,
      posicion: payload.data?.posicion || null
    },
    actions: [
      {
        action: 'view',
        title: 'Ver turnos',
        icon: 'imegenlogin/favicon-32x32.png'
      },
      {
        action: 'close',
        title: 'Cerrar'
      }
    ],
    requireInteraction: true, // Mantiene la notificación visible hasta que el usuario interactúe
    tag: 'turno-notification' // Agrupa notificaciones del mismo tipo
  };

  // Display the notification. The browser will handle this even if the page is not open.
  // waitUntil ensures the service worker doesn't terminate before the notification is shown.
  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// Listener for the 'notificationclick' event.
self.addEventListener('notificationclick', event => {
  // Close the notification once it's clicked.
  event.notification.close();

  // Handle different actions
  if (event.action === 'close') {
    return; // Just close the notification
  }

  // The URL to navigate to when the notification is clicked.
  const targetUrl = new URL('/usuario_barberia005.html', self.location.origin).href;

  // Use waitUntil to ensure the browser doesn't terminate the service worker
  // before the new window/tab has been focused or opened.
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Check if there's already a window open with the target URL or any page from the same origin.
      for (const client of clientList) {
        if (client.url.includes('barberia005') && 'focus' in client) {
          // Navigate to the correct page and focus
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // If no window is found, open a new one.
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Optional: Listener for the 'install' event to activate the new service worker immediately.
self.addEventListener('install', event => {
  // This forces the waiting service worker to become the active service worker.
  event.waitUntil(self.skipWaiting());
});

// Optional: Listener for the 'activate' event to take control of uncontrolled clients.
self.addEventListener('activate', event => {
  // This allows an active service worker to take control of all clients
  // within its scope without needing a page reload.
  event.waitUntil(self.clients.claim());
});