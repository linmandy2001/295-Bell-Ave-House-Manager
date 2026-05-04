// Background handler for FCM Web push.
// Loaded by the browser as a separate service worker; do not import the main sw.js here.

importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAOw4bPhF0CmueL6ncBRa1-GQh0TGwF1lg',
  authDomain: 'house-chores-5adf7.firebaseapp.com',
  projectId: 'house-chores-5adf7',
  storageBucket: 'house-chores-5adf7.firebasestorage.app',
  messagingSenderId: '562159440680',
  databaseURL: 'https://house-chores-5adf7-default-rtdb.firebaseio.com',
  appId: '1:562159440680:web:b39f6e316863a6b3bb361d'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(n.title || 'Bell House', {
    body: n.body || '',
    icon: '/icon.png',
    badge: '/icon.png',
    tag: data.choreId || 'bellhouse-nudge',
    data
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
