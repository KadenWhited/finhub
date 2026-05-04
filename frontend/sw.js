const IS_LOCAL = self.location.hostname === 'localhost' ||
                 self.location.hostname === '127.0.0.1';

if (IS_LOCAL) {
  self.addEventListener('install',  () => self.skipWaiting());
  self.addEventListener('activate', event => {
    event.waitUntil(
      caches.keys()
        .then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(() => self.clients.claim())
    );
  });
} else {

  const CACHE_NAME    = 'moneyright-v1.5.4';
  const SYNC_TAG      = 'finhub-sync';
  const PUSH_TAG      = 'finhub-alert';
  const IS_LOCAL_EXE  = self.location.hostname === 'localhost' ||
                        self.location.hostname === '127.0.0.1';

  // App shell — files cached on install for offline use
  const APP_SHELL = [
    '/',
    '/index.html',
    '/css/main.css',
    '/css/market.css',
    '/css/charts.css',
    '/css/stage2c.css',
    '/css/stage2d.css',
    '/css/stage3.css',
    '/css/stage3b.css',
    '/css/budget.css',
    '/js/api.js',
    '/js/utils.js',
    '/js/chart-engine.js',
    '/js/app.js',
    '/js/modules/dashboard.js',
    '/js/modules/trades.js',
    '/js/modules/checkbook.js',
    '/js/modules/credit.js',
    '/js/modules/market.js',
    '/js/modules/gambling.js',
    '/js/modules/notes.js',
    '/js/modules/settings.js',
    '/js/modules/tools.js',
    '/js/modules/charts-view.js',
    '/js/modules/stocks.js',
    '/js/modules/backtester.js',
    '/js/modules/news.js',
    '/js/modules/budget.js',
    '/manifest.json',
  ];

  // API routes that should NEVER be served from cache
  const NETWORK_ONLY = [
    '/api/auth/',
    '/api/market/',
    '/api/news/',
    '/api/charts/stock',
    '/api/charts/crypto',
    '/api/backtester/',
  ];

  // API routes safe to cache briefly (read-only data)
  const CACHE_FIRST_API = [
    '/api/settings/',
    '/api/trades/stats',
    '/api/gambling/stats',
    '/api/checkbook/stats',
    '/api/dashboard/summary',
  ];

  // ─────────────────────────────────────────
  //  INSTALL — cache app shell
  // ─────────────────────────────────────────

  self.addEventListener('install', event => {
    if (IS_LOCAL_EXE) {
      self.skipWaiting();
      return;
    }
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then(cache => cache.addAll(APP_SHELL))
        .then(() => self.skipWaiting())
        .catch(err => console.warn('[SW] Install cache failed:', err))
    );
  });

  // ─────────────────────────────────────────
  //  ACTIVATE — clean old caches
  // ─────────────────────────────────────────

  self.addEventListener('activate', event => {
    event.waitUntil(
      caches.keys()
        .then(keys => Promise.all(
          keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
        .then(() => self.clients.claim())
    );
  });

  // ─────────────────────────────────────────
  //  FETCH — serve from cache or network
  // ─────────────────────────────────────────

  self.addEventListener('fetch', event => {
    // Never cache or intercept API calls or cross-origin requests
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/api/')) return;
    if (url.origin !== self.location.origin) return;

    const { request } = event;
    const path = url.pathname;

    // Network-only: live data, auth, external APIs
    if (NETWORK_ONLY.some(p => path.startsWith(p))) {
      event.respondWith(
        fetch(request).catch(() => offlineFallback(path))
      );
      return;
    }

    // POST/PUT/DELETE API calls — queue if offline
    if (request.method !== 'GET' && path.startsWith('/api/')) {
      event.respondWith(handleMutation(request));
      return;
    }

    // In sw.js, find the fetch handler and add this before the cache check:
    const neverCache = ['/js/modules/sentiment.js', '/js/modules/dashboard.js'];
    if (neverCache.some(p => event.request.url.includes(p))) {
      event.respondWith(fetch(event.request));
      return;
    }

    // App shell and static assets — cache first, then network
    if (!path.startsWith('/api/')) {
      event.respondWith(
        caches.match(request)
          .then(cached => cached || fetch(request).then(resp => {
            if (resp.ok) {
              const clone = resp.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
            }
            return resp;
          }))
          .catch(() => caches.match('/index.html')) // SPA fallback
      );
      return;
    }

    // GET API calls — network first, fall back to cache
    event.respondWith(
      fetch(request)
        .then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(request)
          .then(cached => cached || offlineFallback(path))
        )
    );
  });

  // ─────────────────────────────────────────
  //  OFFLINE MUTATION QUEUE
  //  POST/PUT/DELETE while offline → stored in IndexedDB
  //  → synced when back online via Background Sync
  // ─────────────────────────────────────────

  async function handleMutation(request) {
    try {
      return await fetch(request);
    } catch (err) {
      // Offline — queue the request
      await queueRequest(request);
      // Return a fake success so the UI doesn't break
      return new Response(JSON.stringify({
        ok: true,
        queued: true,
        message: 'Saved offline — will sync when connected'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  async function queueRequest(request) {
    const body = await request.text().catch(() => '');
    const item = {
      id:        Date.now(),
      url:       request.url,
      method:    request.method,
      headers:   Object.fromEntries(request.headers.entries()),
      body,
      timestamp: new Date().toISOString(),
    };

    const db    = await openDB();
    const store = db.transaction('queue', 'readwrite').objectStore('queue');
    store.add(item);

    // Register background sync
    if ('sync' in self.registration) {
      await self.registration.sync.register(SYNC_TAG);
    }
  }

  // ─────────────────────────────────────────
  //  BACKGROUND SYNC — replay queued requests
  // ─────────────────────────────────────────

  self.addEventListener('sync', event => {
    if (event.tag === SYNC_TAG) {
      event.waitUntil(replayQueue());
    }
  });

  async function replayQueue() {
    const db    = await openDB();
    const items = await getAllFromStore(db, 'queue');

    for (const item of items) {
      try {
        const resp = await fetch(item.url, {
          method:  item.method,
          headers: item.headers,
          body:    item.method !== 'GET' ? item.body : undefined,
        });

        if (resp.ok) {
          // Remove from queue on success
          const tx = db.transaction('queue', 'readwrite');
          tx.objectStore('queue').delete(item.id);

          // Notify clients of sync
          const clients = await self.clients.matchAll();
          clients.forEach(client => client.postMessage({
            type:      'SYNC_SUCCESS',
            url:       item.url,
            timestamp: item.timestamp,
          }));
        }
      } catch (err) {
        // Still offline — leave in queue, retry next sync
        console.warn('[SW] Sync failed for', item.url);
      }
    }
  }

  // ─────────────────────────────────────────
  //  PUSH NOTIFICATIONS
  // ─────────────────────────────────────────

  self.addEventListener('push', event => {
    if (!event.data) return;

    let data;
    try {
      data = event.data.json();
    } catch {
      data = { title: 'MoneyRight Alert', body: event.data.text() };
    }

    const options = {
      body:    data.body || '',
      icon:    '/assets/icon-192.png',
      badge:   '/assets/icon-96.png',
      tag:     PUSH_TAG,
      data:    { url: data.url || '/' },
      actions: [
        { action: 'view',    title: 'View App' },
        { action: 'dismiss', title: 'Dismiss'  },
      ],
      vibrate:   [200, 100, 200],
      renotify:  true,
      requireInteraction: false,
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'MoneyRight', options)
    );
  });

  self.addEventListener('notificationclick', event => {
    event.notification.close();
    if (event.action === 'dismiss') return;

    const url = event.notification.data?.url || '/';
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(clients => {
          // Focus existing window if open
          for (const client of clients) {
            if (client.url.includes(self.location.origin) && 'focus' in client) {
              return client.focus();
            }
          }
          // Otherwise open new window
          return self.clients.openWindow(url);
        })
    );
  });

  // ─────────────────────────────────────────
  //  INDEXEDDB HELPERS
  // ─────────────────────────────────────────

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('finhub-sw', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('queue')) {
          db.createObjectStore('queue', { keyPath: 'id' });
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  function getAllFromStore(db, storeName) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  function offlineFallback(path) {
    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({
        error:   'offline',
        message: 'You are offline. Data will sync when reconnected.'
      }), {
        status:  503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return caches.match('/index.html');
  }
}