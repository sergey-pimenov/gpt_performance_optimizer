(function () {
  'use strict';
  // Single-run guard (avoid running twice if injected again)
  if (window.__CLX_LOADER_INITED) return;
  window.__CLX_LOADER_INITED = true;
  // Port loader from userscript lines 873-933

  let loadStartTime = 0; // Local variable instead of global

  function hideChatElement() {
    const id = 'chatgpt-optimizer-hide-style';
    if (!document.getElementById(id)) {
      const st = document.createElement('style');
      st.id = id;
      st.textContent = '#page-header + * { visibility: hidden !important; }';
      (document.head || document.documentElement).appendChild(st);
    }
  }

  function showChatElement() {
    const el = document.getElementById('chatgpt-optimizer-hide-style');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function createDynamicLoaderRule(top, left) {
    const id = 'clx-loader-pos-style';
    let st = document.getElementById(id);
    if (!st) {
      st = document.createElement('style');
      st.id = id;
      (document.head || document.documentElement).appendChild(st);
    }
    st.textContent = `#chatgpt-page-loader{ top:${Math.round(top)}px; left:${Math.round(left)}px; }`;
  }

  function removeExistingLoader() {
    const nodes = document.querySelectorAll('#chatgpt-page-loader, .clx-loader--main, .clx-loader--fallback');
    nodes.forEach(n => {
      try { if (n.__monTimer) clearInterval(n.__monTimer); } catch { }
      try { n.remove(); } catch { }
    });
    document.getElementById('clx-loader-pos-style')?.remove();
    // Ensure chat becomes visible if previous loader hid it
    showChatElement();
  }

  function createChatGPTLoader() {
    hideChatElement();
    const loader = document.createElement('div');
    loader.id = 'chatgpt-page-loader';
    loader.className = 'clx-loader clx-loader--main';
    loader.innerHTML = `<span class="chatgpt-loader"></span><span class="clx-loader-text">Chat Loading...</span>`;
    const main = document.getElementById('main');
    if (main) {
      const r = main.getBoundingClientRect();
      createDynamicLoaderRule(r.top + r.height / 2, r.left + r.width / 2);
    } else {
      loader.classList.remove('clx-loader--main');
      loader.classList.add('clx-loader--fallback');
    }
    (document.body || document.documentElement).appendChild(loader);
    return loader;
  }

  function checkChatGPTLoaded() {
    const thread = document.getElementById('thread');
    return thread?.querySelector('div.flex.flex-col.text-sm') &&
      thread.querySelector('article[data-testid^="conversation-turn-"]');
  }

  function updateChatGPTLoader(loader, success) {
    if (!loader) return;
    if (success === true) {
      if (loadStartTime > 0) {
        const elapsedMs = Date.now() - loadStartTime;
        console.log('[Loader] Chat loaded in', elapsedMs, 'ms');
        // Persist last load time for current conversation (used by status bar)
        try {
          const convId = (window.TailCore?.convIdFromLocation?.()) || null;
          if (convId) {
            localStorage.setItem(`cl:last-load-ms:${convId}`, String(elapsedMs));
          }
        } catch { }
      }
      showChatElement();
      loader.remove();
      document.getElementById('clx-loader-pos-style')?.remove();
    } else {
      loader.innerHTML = `
        <svg class="clx-err-icn" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        <span class="clx-loader-text clx-loader-error">ChatGPT loading error</span>`;
      showChatElement();

      // Auto-hide error after 2 seconds
      setTimeout(() => {
        loader.remove();
        document.getElementById('clx-loader-pos-style')?.remove();
      }, 2000);
    }
  }

  function monitorChatGPTLoading(loader, opts) {
    let attempts = 0, max = 30;
    const t = setInterval(() => {
      attempts++;
      if (checkChatGPTLoaded()) {
        clearInterval(t);
        updateChatGPTLoader(loader, true);
        try { opts?.onLoaded?.() } catch { }
      } else if (attempts >= max) {
        clearInterval(t);
        updateChatGPTLoader(loader, false);
        try { opts?.onTimeout?.() } catch { }
      }
    }, 1000);
    // Attach timer reference to loader for cleanup on re-inits
    try { loader.__monTimer = t; } catch { }
  }

  // Loader styles
  function ensureLoaderStyles() {
    if (document.getElementById('clx-loader-styles')) return;
    const s = document.createElement('style');
    s.id = 'clx-loader-styles';
    s.textContent = `
      .clx-loader {
        position: fixed;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        transition: all .3s ease
      }

      .clx-loader--main {
        z-index: 0
      }

      .clx-loader--fallback {
        z-index: 10000;
        top: 50%;
        left: 50%
      }

      .clx-loader-text {
        font-size: 16px;
        font-weight: 400;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
      }

      .clx-loader-error {
        color: var(--text-status-error, #ef4444)
      }

      .clx-err-icn {
        width: 40px;
        height: 40px;
        fill: none;
        stroke: var(--text-status-error, #ef4444);
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round
      }

      .chatgpt-loader {
        width: 48px;
        height: 48px;
        display: inline-block;
        position: relative
      }

      .chatgpt-loader::after,
      .chatgpt-loader::before {
        content: "";
        box-sizing: border-box;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 2px solid var(--icon-secondary, #cdcdcd);
        position: absolute;
        left: 0;
        top: 0;
        opacity: 0;
        animation: clx-animloader 2s linear infinite
      }

      .chatgpt-loader::after {
        animation-delay: 1s
      }

      @keyframes clx-animloader {
        0% {
          transform: scale(0);
          opacity: 1
        }

        100% {
          transform: scale(1);
          opacity: 0
        }
      }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  function init() {
    // Ensure we don't stack multiple loaders
    removeExistingLoader();
    const loaderEnabled = localStorage.getItem('cl:loader');
    if (loaderEnabled === '0') return; // disabled

    // Don't show loader for empty chats (home page or new chat)
    const url = window.location.pathname;
    if (url === '/' || url === '/chat' || !url.includes('/c/')) {
      return; // No loader for home page or new chats
    }

    // Clear previous measured load time for this conversation (reset status bar)
    try {
      const convId = (window.TailCore?.convIdFromLocation?.()) || null;
      if (convId) localStorage.removeItem(`cl:last-load-ms:${convId}`);
    } catch { }

    ensureLoaderStyles();
    loadStartTime = Date.now();
    hideChatElement();
    const loader = createChatGPTLoader();
    monitorChatGPTLoading(loader);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  // Re-init loader on SPA navigation
  window.addEventListener('cl:navigation-changed', () => {
    const loaderEnabled = localStorage.getItem('cl:loader');
    if (loaderEnabled === '0') return;

    // Don't show loader for empty chats (home page or new chat)
    const url = window.location.pathname;
    if (url === '/' || url === '/chat' || !url.includes('/c/')) {
      return; // No loader for home page or new chats
    }

    // Remove existing loader if any (both main and fallback)
    removeExistingLoader();

    // Restart loading monitoring
    init();
  });
})();
