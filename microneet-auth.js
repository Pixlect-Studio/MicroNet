/* =====================================================================
   MicroNet × PIXLECT Account Network — microneet-auth.js
   ---------------------------------------------------------------------
   Dependencies: pixlect-crypto.js (must be loaded first)
   ===================================================================== */
(function () {
  'use strict';

  const CONFIG = {
    app: 'MicroNet',
    
    // Updated to the new www.account subdomain
    authUrl: 'https://www.account.pixlect-studios.com/?app=MicroNet&mode=popup',
    
    trustedOrigins: [
      'http://localhost:8000',
      'http://127.0.0.1:8000',
      'https://www.account.pixlect-studios.com', 
      'https://account.pixlect-studios.com'
    ],

    domainJsonUrl: '/domain.json',
    storageKey:   'microneet:pixlect_user',
    sessionTTL:   24 * 60 * 60 * 1000, // 24 hours
    popupWidth:   520,
    popupHeight:  640
  };

  // State
  let currentUser = null;
  let popup = null;
  let registryReady = false;
  const listeners = new Set();

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function getCrypto() {
    if (!window.PixlectCrypto) throw new Error('pixlect-crypto.js not loaded!');
    return window.PixlectCrypto;
  }

  async function ensureRegistry() {
    if (registryReady) return;
    try {
      await getCrypto().loadRegistry(CONFIG.domainJsonUrl);
      registryReady = true;
    } catch (e) {
      console.warn('[MicroNetAuth] domain.json missing or failed to load. Encryption may fail.');
    }
  }

  // ------------------------------------------------------------------
  // Session Management
  // ------------------------------------------------------------------
  async function saveUser(user) {
    try {
      await getCrypto().saveSession(CONFIG.app, CONFIG.storageKey, user, CONFIG.sessionTTL);
    } catch (e) {
      console.warn('[MicroNetAuth] Could not save session:', e);
    }
    setUser(user);
  }

  async function loadUser() {
    try {
      return await getCrypto().loadSession(CONFIG.app, CONFIG.storageKey);
    } catch (e) {
      return null;
    }
  }

  function clearUser() {
    localStorage.removeItem(CONFIG.storageKey);
    setUser(null);
  }

  function setUser(user) {
    currentUser = user || null;
    renderUI();
    listeners.forEach(fn => fn(currentUser));
  }

  // ------------------------------------------------------------------
  // Login / Logout
  // ------------------------------------------------------------------
  async function login() {
    if (popup && !popup.closed) { popup.focus(); return; }
    await ensureRegistry();

    const w = CONFIG.popupWidth;
    const h = CONFIG.popupHeight;
    const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
    const top  = Math.max(0, window.screenY + (window.outerHeight - h) / 2);

    popup = window.open(
      CONFIG.authUrl,
      'pixlect-auth',
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
    );

    if (!popup) {
      alert('Popup blocked. Please allow popups for this site.');
      return;
    }

    // Watch for manual popup close
    const timer = setInterval(() => {
      if (popup && popup.closed) {
        clearInterval(timer);
        popup = null;
      }
    }, 500);
  }

  function logout() {
    clearUser();
    // Optional: fetch('/api/microneet/logout', { method: 'POST' });
  }

  // ------------------------------------------------------------------
  // Message Listener (Decryption)
  // ------------------------------------------------------------------
  window.addEventListener('message', async (ev) => {
    if (!CONFIG.trustedOrigins.includes(ev.origin)) return;
    const data = ev.data;
    if (!data || data.type !== 'PIXLECT_AUTH_ENC') return;

    await ensureRegistry();

    try {
      const payload = await getCrypto().open(CONFIG.app, data.envelope);
      
      if (payload.app !== CONFIG.app) return;

      if (payload.status === 'success' && payload.user) {
        await saveUser(payload.user);
        if (popup) popup.close();
        popup = null;
      } else if (payload.status === 'denied') {
        if (popup) popup.close();
        popup = null;
      }
    } catch (err) {
      console.error('[MicroNetAuth] Decryption failed:', err.message);
    }
  });

  // ------------------------------------------------------------------
  // UI Rendering
  // ------------------------------------------------------------------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function iconMarkup(icon, size) {
    const i = icon || {};
    const emoji = i.emoji || '🦊';
    const bg = i.bg || 'linear-gradient(135deg,#7c5cff,#22d3ee)';
    const shape = i.shape || 'squircle';
    let radius = '28%', clip = 'none';
    if (shape === 'circle') radius = '50%';
    if (shape === 'hex') { radius = '0'; clip = 'polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)'; }
    
    return `<span style="
      display:inline-grid;place-items:center;
      width:${size}px;height:${size}px;
      font-size:${Math.round(size * 0.55)}px;line-height:1;
      background:${bg};border-radius:${radius};clip-path:${clip};
      vertical-align:middle;flex:none;
    ">${escapeHtml(emoji)}</span>`;
  }

  function renderUI() {
    const btn = document.getElementById('pixlect-login');
    const slot = document.getElementById('pixlect-user');

    if (currentUser) {
      if (btn) btn.hidden = true;
      if (slot) {
        slot.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px">
            ${iconMarkup(currentUser.icon, 36)}
            <div style="line-height:1.2">
              <strong>${escapeHtml(currentUser.username)}</strong><br>
              <small style="color:#8fa0c4">Signed in with PIXLECT</small>
            </div>
            <button type="button" id="pixlect-logout"
              style="margin-left:auto;padding:6px 12px;border-radius:8px;
                     border:1px solid #22304f;background:#141d33;
                     color:#e8eefc;font-size:12px;cursor:pointer">
              Sign out
            </button>
          </div>`;
        document.getElementById('pixlect-logout').onclick = logout;
      }
    } else {
      if (btn) btn.hidden = false;
      if (slot) slot.innerHTML = '';
    }
  }

  // ------------------------------------------------------------------
  // Init & API
  // ------------------------------------------------------------------
  function bindButton() {
    const btn = document.getElementById('pixlect-login');
    if (btn && !btn.__bound) {
      btn.__bound = true;
      btn.addEventListener('click', login);
    }
  }

  async function init() {
    bindButton();
    const saved = await loadUser();
    setUser(saved);
    // Re-bind if DOM changes (e.g. React/Vue)
    new MutationObserver(bindButton).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose public API
  window.MicroNetAuth = {
    get user() { return currentUser; },
    login,
    logout,
    onChange(fn) {
      listeners.add(fn);
      fn(currentUser);
      return () => listeners.delete(fn);
    }
  };
})();