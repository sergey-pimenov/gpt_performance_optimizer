// Settings loader - runs in ISOLATED world to access chrome.storage
// Loads settings from chrome.storage and injects them into MAIN world via localStorage
(function() {
  'use strict';

  const SETTINGS_KEY = 'cl:global-settings';
  const DEFAULT_SETTINGS = {
    defaultTail: 10,
    optimizerEnabled: true
  };

  function loadAndInjectSettings() {
    chrome.storage.sync.get(['defaultTail', 'optimizerEnabled', 'logVerbose'], (result) => {
      const settings = {
        defaultTail: result.defaultTail || DEFAULT_SETTINGS.defaultTail,
        optimizerEnabled: result.optimizerEnabled !== false
      };

      // Save to localStorage (accessible from MAIN world and persistent)
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        console.log('[ChatGPT-Opt] Settings loaded:', settings);
        // Apply logger verbosity flag
        try {
          if (result.logVerbose === true) localStorage.setItem('cl:log:verbose', '1');
          else localStorage.removeItem('cl:log:verbose');
        } catch {}
        
        // Dispatch custom event to notify MAIN world scripts
        window.dispatchEvent(new CustomEvent('cl:settings-loaded', { detail: settings }));
      } catch (e) {
        console.error('[ChatGPT-Opt] Failed to save settings:', e);
      }
    });
  }

  // Listen for settings updates from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'settings-updated') {
      console.log('[ChatGPT-Opt] Settings updated from popup:', message.settings);
      
      try {
        // Clear all conversation-specific tail settings when global default changes
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
          if (key.startsWith('cl:tail:')) {
            localStorage.removeItem(key);
          }
        });
        console.log('[ChatGPT-Opt] Cleared conversation-specific tail settings');
        
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(message.settings));
        // Apply logger verbosity flag immediately
        try {
          if (message.settings && message.settings.logVerbose === true) localStorage.setItem('cl:log:verbose', '1');
          else localStorage.removeItem('cl:log:verbose');
        } catch {}
        
        // Dispatch event to notify MAIN world
        window.dispatchEvent(new CustomEvent('cl:settings-changed', { detail: message.settings }));
      } catch (e) {
        console.error('[ChatGPT-Opt] Failed to update settings:', e);
      }
      
      sendResponse({ success: true });
      return true;
    }

    // Per-page override: query current effective state for this tab/page
    if (message.type === 'override:get') {
      try {
        const convId = message.convId || (location.href.match(/\/(?:c|share)\/([0-9a-f-]{36})/i) || [])[1] || null;
        if (!convId) { sendResponse({ ok: false, reason: 'no-conv' }); return true; }
        const override = localStorage.getItem(`cl:opt:override:${convId}`) || null;
        const gsRaw = localStorage.getItem(SETTINGS_KEY);
        let optimizerEnabled = true;
        try { optimizerEnabled = (JSON.parse(gsRaw||'{}').optimizerEnabled !== false); } catch {}
        const effective = (override === 'on') ? true : (override === 'off') ? false : optimizerEnabled;
        sendResponse({ ok: true, convId, override, effective });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || 'error' });
      }
      return true;
    }

    // Per-page override: set value and reload page to apply
    if (message.type === 'override:set') {
      try {
        const convId = message.convId || (location.href.match(/\/(?:c|share)\/([0-9a-f-]{36})/i) || [])[1] || null;
        const val = message.value === 'on' ? 'on' : 'off';
        if (!convId) { sendResponse({ ok: false, reason: 'no-conv' }); return true; }
        localStorage.setItem(`cl:opt:override:${convId}`, val);
        // Notify MAIN world listeners just in case
        try { window.dispatchEvent(new CustomEvent('cl:settings-changed', { detail: { convId, override: val } })); } catch {}
        setTimeout(() => { try { location.reload(); } catch {} }, 50);
        sendResponse({ ok: true, convId, override: val });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || 'error' });
      }
      return true;
    }
  });

  // Load settings on script start
  loadAndInjectSettings();
})();
