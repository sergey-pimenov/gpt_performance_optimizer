(function () {
  'use strict';
  const { LOG } = window.TailLog || { LOG: function () { } };
  const { URL_RX, convIdFromUrl, convIdFromLocation, isToolNoiseText, isReasoningType, extractConvId, findLeafNode, buildNodeChain } = window.TailShared;

  // Core config from userscript lines 187-195
  const CFG = { DEFAULT_TAIL: 10, STEP: 10, MIN_TAIL: 10, MAX_TAIL: 800 };

  // Global settings (stored in localStorage for MAIN world access and persistence)
  const SETTINGS_KEY = 'cl:global-settings';

  function getGlobalSettings() {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      LOG('settings:parse-error', e);
    }
    return {
      defaultTail: CFG.DEFAULT_TAIL,
      optimizerEnabled: true
    };
  }

  function saveGlobalSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      LOG('settings:saved', settings);
    } catch (e) {
      LOG('settings:save-error', e);
    }
  }

  // Load settings on startup (will be updated by settings-loader.js)
  let globalSettings = getGlobalSettings();
  let settingsReady = false;

  // Listen for initial settings load from settings-loader.js
  window.addEventListener('cl:settings-loaded', (e) => {
    globalSettings = e.detail || getGlobalSettings();
    settingsReady = true;
    LOG('settings:loaded-from-storage', globalSettings);
  });

  // Watch for settings changes via custom event
  window.addEventListener('cl:settings-changed', (e) => {
    globalSettings = e.detail || getGlobalSettings();
    LOG('settings:updated', globalSettings);
    // Reload page to apply new settings
    setTimeout(() => window.location.reload(), 100);
  });

  // If settings haven't loaded after 500ms, proceed with defaults
  setTimeout(() => {
    if (!settingsReady) {
      LOG('settings:timeout-using-defaults', globalSettings);
      settingsReady = true;
    }
  }, 500);

  const kTail = id => `cl:tail:${id}`, kMeta = id => `cl:meta:${id}`, kFlat = id => `cl:flat:${id}`, kInjected = id => `cl:inj:${id}`;
  const kOptOverride = id => `cl:opt:override:${id}`; // 'on' | 'off'

  // Generic storage helpers - use localStorage for persistence across tabs/sessions
  const storage = {
    getNum: (key, def = 0) => +(localStorage.getItem(key) || def),
    setNum: (key, val) => localStorage.setItem(key, String(val)),
    getJSON: (key, def) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(def)); } catch { return def; } },
    setJSON: (key, val) => localStorage.setItem(key, JSON.stringify(val || {})),
    getStr: (key, def = '') => {
      try { const v = localStorage.getItem(key); return (v == null ? def : String(v)); } catch { return def; }
    },
    setStr: (key, val) => { try { localStorage.setItem(key, String(val)); } catch {} },
    remove: (key) => { try { localStorage.removeItem(key); } catch {} }
  };

  // Helper to clamp tail value within valid range
  const clampTail = n => Math.max(CFG.MIN_TAIL, Math.min(CFG.MAX_TAIL, n));

  // Storage accessors using generic helpers
  const getTail = id => clampTail(storage.getNum(kTail(id), globalSettings.defaultTail));
  const setTail = (id, n) => storage.setNum(kTail(id), clampTail(n));
  const getMeta = id => storage.getJSON(kMeta(id), {});
  const setMeta = (id, m) => storage.setJSON(kMeta(id), m);
  const getFlat = id => storage.getJSON(kFlat(id), []);
  const setFlat = (id, arr) => storage.setJSON(kFlat(id), arr);
  const getInjected = id => storage.getNum(kInjected(id), 0);
  const setInjected = (id, n) => storage.setNum(kInjected(id), n);

  // Per-conversation optimizer override ('on' | 'off' | null)
  const getOptOverride = (id) => !id ? '' : storage.getStr(kOptOverride(id), '');
  const setOptOverride = (id, val) => {
    if (!id) return;
    if (!val) storage.remove(kOptOverride(id));
    else storage.setStr(kOptOverride(id), val === 'on' ? 'on' : 'off');
  };
  const clearOptOverride = (id) => { if (id) storage.remove(kOptOverride(id)); };
  const isOptimizerEnabledFor = (id) => {
    const ov = id ? getOptOverride(id) : '';
    if (ov === 'on') return true;
    if (ov === 'off') return false;
    return globalSettings.optimizerEnabled !== false;
  };
  const isOptimizerEnabledForCurrent = () => {
    try { const id = convIdFromLocation(); return isOptimizerEnabledFor(id); } catch { return globalSettings.optimizerEnabled !== false; }
  };

  // Helper functions from userscript lines 197-226

  const isRenderableNode = (node) => {
    const role = node?.message?.author?.role;
    if (!['user', 'assistant'].includes(role || '')) return false;
    const parts = node?.message?.content?.parts || [node?.message?.text];
    return !!window.CLTheme?.stringifyParts(parts);
  };

  function sliceByRenderable(chain, map, wantRenderable) {
    let seen = 0, start = chain.length;
    for (let i = chain.length - 1; i >= 0; i--) {
      const id = chain[i];
      if (isRenderableNode(map[id])) seen++;
      start = i;
      if (seen >= wantRenderable) break;
    }
    return chain.slice(start);
  }

  // Helper: Parse conversation response and extract data structure
  function parseConversationResponse(text) {
    let data;
    try { data = JSON.parse(text); }
    catch { return null; }

    // Accept either root {mapping,...} or nested {conversation: {mapping,...}}
    let conv = data, convPath = 'root';
    if (!(data?.mapping && typeof data.mapping === 'object')) {
      if (data?.conversation?.mapping && typeof data.conversation.mapping === 'object') {
        conv = data.conversation;
        convPath = 'data.conversation';
      } else {
        return null;
      }
    }

    const map = conv.mapping;
    if (!map || typeof map !== 'object') return null;

    return { data, conv, convPath, map };
  }

  // Helper: Extract flat messages and trim conversation to tail size
  function trimConversationData(map, conv, convId) {
    const leaf = (conv.current_node && map[conv.current_node]) ? conv.current_node : findLeafNode(map);
    const chain = buildNodeChain(map, leaf);

    // Extract flat messages for storage
    const flat = [];
    for (const id of chain) {
      const node = map[id];
      const role = node?.message?.author?.role;
      if (!['user', 'assistant'].includes(role || '')) continue;
      if (isReasoningType(node?.message?.content?.content_type)) continue;
      const parts = node.message?.content?.parts || [node.message?.text];
      const t = window.CLTheme?.stringifyParts(parts, { caps: role === 'assistant' }) || '';
      if (!t || isToolNoiseText(t)) continue;
      flat.push({ id, role, text: t, time: node.message.update_time || node.message.create_time || 0 });
    }

    // Save flat if larger than existing (prevent overwrite from re-fetch)
    const existingFlat = convId ? getFlat(convId) : [];
    if (convId && flat.length > existingFlat.length) {
      setFlat(convId, flat);
    }
    const fullFlatLength = Math.max(flat.length, existingFlat.length);

    // Determine which IDs to keep based on tail setting
    const tailRenderable = convId ? getTail(convId) : globalSettings.defaultTail;

    // CRITICAL: Don't trim if conversation is already small enough
    if (fullFlatLength <= tailRenderable) {
      // Keep all messages - no trimming needed
      if (convId) {
        setInjected(convId, 0);
        setMeta(convId, { renderableTotal: fullFlatLength, keptRenderableByReact: fullFlatLength });
      }
      return null; // Signal: no trimming needed
    }

    const keptIdsArr = sliceByRenderable(chain, map, Math.min(tailRenderable, fullFlatLength || tailRenderable));

    let keptRenderableByReact = 0;
    for (const id of keptIdsArr) if (isRenderableNode(map[id])) keptRenderableByReact++;

    if (convId) {
      setInjected(convId, 0);
      setMeta(convId, { renderableTotal: fullFlatLength, keptRenderableByReact });
    }

    return { keptIdsArr, leaf, fullFlatLength, keptRenderableByReact };
  }

  // Helper: Rebuild data object with trimmed mapping
  function rebuildWithTrimmedMapping(data, map, keptIdsArr, leaf, convPath) {
    const keepIds = new Set(keptIdsArr);
    const out = {};

    for (const id of keepIds) {
      const src = map[id];
      if (!src) continue;
      const parent = keepIds.has(src.parent) ? src.parent : null;
      const kids = Array.isArray(src.children) ? src.children.filter(k => keepIds.has(k)) : [];
      const role = src.message?.author?.role;
      const c = src.message?.content || {};
      const caps = role === 'assistant';
      const textNorm = window.CLTheme?.stringifyParts(c.parts, { caps }) || (typeof c.text === 'string' ? c.text.trim() : '');
      const msg = { ...src.message, content: { content_type: 'text', parts: [isToolNoiseText(textNorm) ? '' : textNorm] } };
      out[id] = { ...src, parent, children: kids, message: msg };
    }

    const newData = structuredClone(data);
    if (convPath === 'root') {
      newData.mapping = out;
      if (!keepIds.has(newData.current_node)) newData.current_node = leaf;
    } else {
      newData.conversation.mapping = out;
      if (!keepIds.has(newData.conversation.current_node)) newData.conversation.current_node = leaf;
    }

    return newData;
  }

  // Fetch hook from userscript lines 288-336
  const origFetch = window.fetch?.bind(window);
  if (origFetch) {
    window.fetch = async function (input, init) {
      const res = await origFetch(input, init);
      const url = typeof input === 'string' ? input : input?.url || '';
      try {
        // Check if optimizer is enabled (per-conversation override wins)
        const urlConvId = convIdFromUrl(url);
        if (!isOptimizerEnabledFor(urlConvId)) {
          LOG('fetch:optimizer-disabled', { convId: urlConvId || null });
          return res;
        }

        const ct = res.headers.get('content-type') || '';
        if (!/json/i.test(ct)) return res;

        const text = await res.text();
        const parsed = parseConversationResponse(text);
        if (!parsed) return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });

        const { data, conv, convPath, map } = parsed;
        const convId = extractConvId(conv) || extractConvId(url);

        const trimResult = trimConversationData(map, conv, convId);

        // If no trimming needed (conversation is small), return original response
        if (!trimResult) {
          LOG('fetch:no-trim-needed', { convId });
          return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
        }

        const { keptIdsArr, leaf, fullFlatLength, keptRenderableByReact } = trimResult;
        const newData = rebuildWithTrimmedMapping(data, map, keptIdsArr, leaf, convPath);

        const h = new Headers(res.headers);
        h.set('content-type', 'application/json; charset=utf-8');
        h.delete('content-length');
        setTimeout(() => window.dispatchEvent(new CustomEvent('cl:tail-meta')), 0);
        LOG('fetch:trimmed', { convId, total: fullFlatLength, kept: keptRenderableByReact });
        return new Response(JSON.stringify(newData), { status: res.status, statusText: res.statusText, headers: h });
      } catch (e) {
        return res;
      }
    };
  }

  // Export API (only what's actually used externally)
  window.TailCore = {
    CFG,
    getTail, setTail, getMeta, getFlat, setFlat, setInjected, getInjected,
    convIdFromLocation, storage, globalSettings,
    // overrides
    getOptOverride, setOptOverride, clearOptOverride,
    isOptimizerEnabledFor, isOptimizerEnabledForCurrent
  };

  LOG('core:ready');
})();
