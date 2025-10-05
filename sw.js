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
      url: payload.url || '/', // URL to open on click
    },
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

  // The URL to navigate to when the notification is clicked.
  const targetUrl = event.notification.data.url || '/';

  // Use waitUntil to ensure the browser doesn't terminate the service worker
  // before the new window/tab has been focused or opened.
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Check if there's already a window open with the target URL.
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
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