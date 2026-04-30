/**
 * frontend/js/pwa.js
 * Service worker registration, push subscription management,
 * offline queue display, and sync status indicators.
 */

// ─────────────────────────────────────────
//  SERVICE WORKER REGISTRATION
// ─────────────────────────────────────────

let _swRegistration = null;

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] Service workers not supported');
    return;
  }

  try {
    _swRegistration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/'
    });

    console.log('[PWA] Service worker registered, scope:', _swRegistration.scope);

    // Listen for sync success messages from SW
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'SYNC_SUCCESS') {
        showToast('Offline changes synced ✓', 'success');
        // Refresh current page data
        const page = document.querySelector('.page.active');
        if (page) {
          const pageId = page.id.replace('page-', '');
          if (typeof navigateTo === 'function') navigateTo(pageId);
        }
      }
    });

    // Check for updates periodically
    setInterval(() => _swRegistration.update(), 60 * 60 * 1000); // hourly

  } catch (err) {
    console.warn('[PWA] Service worker registration failed:', err);
  }
}

// ─────────────────────────────────────────
//  ONLINE / OFFLINE INDICATOR
// ─────────────────────────────────────────

function initOfflineIndicator() {
  const indicator = document.createElement('div');
  indicator.id    = 'offline-indicator';
  indicator.innerHTML = '⚡ Offline — changes will sync when reconnected';
  document.body.appendChild(indicator);

  function update() {
    indicator.classList.toggle('visible', !navigator.onLine);
    if (navigator.onLine) {
      // Trigger background sync when coming back online
      if (_swRegistration && 'sync' in _swRegistration) {
        _swRegistration.sync.register('finhub-sync').catch(() => {});
      }
    }
  }

  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

// ─────────────────────────────────────────
//  PUSH NOTIFICATIONS
// ─────────────────────────────────────────

// VAPID public key — replace with your own generated key
// Generate at: https://web-push-codelab.glitch.me/
// or run: node -e "const wp=require('web-push');const k=wp.generateVAPIDKeys();console.log(k)"
const VAPID_PUBLIC_KEY = window.FINHUB_VAPID_PUBLIC_KEY || '';

async function requestPushPermission() {
  if (!('Notification' in window)) {
    showToast('Notifications not supported in this browser', 'error');
    return false;
  }

  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') {
    showToast('Notifications blocked — enable in browser settings', 'error');
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

async function subscribeToPush() {
  if (!_swRegistration) {
    showToast('Service worker not ready', 'error');
    return null;
  }

  if (!VAPID_PUBLIC_KEY) {
    showToast('Push notifications require VAPID keys — see Settings', 'error');
    return null;
  }

  const granted = await requestPushPermission();
  if (!granted) return null;

  try {
    const subscription = await _swRegistration.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // Send subscription to backend
    await fetch('/api/push/subscribe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(subscription),
    });

    showToast('Push notifications enabled ✓', 'success');
    return subscription;

  } catch (err) {
    console.warn('[PWA] Push subscription failed:', err);
    showToast('Could not enable push notifications', 'error');
    return null;
  }
}

async function unsubscribeFromPush() {
  if (!_swRegistration) return;
  const sub = await _swRegistration.pushManager.getSubscription();
  if (!sub) return;

  await sub.unsubscribe();
  await fetch('/api/push/unsubscribe', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ endpoint: sub.endpoint }),
  });
  showToast('Push notifications disabled', 'success');
}

async function getPushStatus() {
  if (!_swRegistration) return { supported: false };
  if (!('PushManager' in window)) return { supported: false };

  const sub = await _swRegistration.pushManager.getSubscription().catch(() => null);
  return {
    supported:  true,
    permission: Notification.permission,
    subscribed: !!sub,
    vapid_configured: !!VAPID_PUBLIC_KEY,
  };
}

function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ─────────────────────────────────────────
//  INSTALL PROMPT  (Add to Home Screen)
// ─────────────────────────────────────────

let _installPrompt = null;

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  _installPrompt = event;
  // Show install button in settings if available
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = 'block';
});

async function promptInstall() {
  if (!_installPrompt) {
    showToast('App is already installed or install not available', 'error');
    return;
  }
  _installPrompt.prompt();
  const { outcome } = await _installPrompt.userChoice;
  if (outcome === 'accepted') {
    showToast('FinHub installed to home screen ✓', 'success');
    _installPrompt = null;
  }
}

window.addEventListener('appinstalled', () => {
  _installPrompt = null;
  showToast('FinHub installed successfully ✓', 'success');
});

// ─────────────────────────────────────────
//  INIT  (called from app.js)
// ─────────────────────────────────────────

async function initPWA() {
  await registerServiceWorker();
  initOfflineIndicator();
}
