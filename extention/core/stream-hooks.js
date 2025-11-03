(function () {
  'use strict';
  // ReadableStream + EventSource + Bootstrap interceptors for conversation trimming
  // Ensures trimming works for SPA navigation, streaming, and embedded JSON

  const { LOG } = window.TailLog || { LOG: function () { } };
  const { TOOL_TYPES, convIdFromLocation, isToolNoiseText, extractConvId, findLeafNode, buildNodeChain } = window.TailShared;
  const { storage, globalSettings } = window.TailCore || {};
  const td = new TextDecoder();
  const te = new TextEncoder();

  function shrinkConversation(conv) {
    // Check if optimizer is enabled (per-conversation override wins)
    const convId = extractConvId(conv) || 'unknown';
    try {
      if (window.TailCore && typeof window.TailCore.isOptimizerEnabledFor === 'function') {
        if (!window.TailCore.isOptimizerEnabledFor(convId)) {
          LOG('stream:optimizer-disabled', { convId });
          return conv;
        }
      } else if (globalSettings && !globalSettings.optimizerEnabled) {
        LOG('stream:optimizer-disabled', { convId });
        return conv;
      }
    } catch {}

    const mapping = conv?.mapping || {};
    if (!mapping || typeof mapping !== 'object') return conv;

    const leaf = conv.current_node || findLeafNode(mapping);
    const chain = buildNodeChain(mapping, leaf);

    const flat = [];
    for (const id of chain) {
      const node = mapping[id];
      const msg = node.message; if (!msg) continue;
      const role = msg.author?.role || msg.role;
      if (role !== 'user' && role !== 'assistant') continue;

      let parts = [];
      if (msg.content?.parts) parts = msg.content.parts;
      else if (msg.parts) parts = msg.parts;
      else if (typeof msg.text === 'string') parts = [{ text: msg.text }];

      const clean = [];
      for (const part of (Array.isArray(parts) ? parts : [])) {
        const t = (part?.content_type || part?.type || '').toLowerCase();
        if (TOOL_TYPES.has(t)) continue;
        clean.push(part);
      }
      const text = window.CLTheme?.stringifyParts(clean, { caps: role === 'assistant' }) || '';
      if (!text || isToolNoiseText(text)) continue;
      flat.push({ id, role, text, time: node.update_time || node.create_time || 0 });
    }

  // convId already computed above
    const defaultTail = (globalSettings && globalSettings.defaultTail) || 10;
    const tail = storage?.getNum(`cl:tail:${convId}`, defaultTail) || defaultTail;
    const renderableTotal = flat.length;

    // CRITICAL: Don't trim if conversation is already small enough
    if (renderableTotal <= tail) {
      LOG('stream:no-trim-needed', { convId, total: renderableTotal, tail });

      // Still save metadata for toolbar
      const existingFlat = storage?.getJSON(`cl:flat:${convId}`, []) || [];
      const existingMeta = storage?.getJSON(`cl:meta:${convId}`, {}) || {};
      const existingTotal = existingMeta.renderableTotal || existingFlat.length || 0;

      if (renderableTotal > existingTotal) {
        storage?.setJSON(`cl:flat:${convId}`, flat);
        storage?.setJSON(`cl:meta:${convId}`, { renderableTotal, keptRenderableByReact: renderableTotal });
        storage?.setNum(`cl:inj:${convId}`, 0);
        setTimeout(() => window.dispatchEvent(new CustomEvent('cl:tail-meta')), 0);
      }

      return conv; // Return original, no trimming
    }

    const keep = Math.min(tail, renderableTotal);
    const tailSlice = flat.slice(renderableTotal - keep);

    const keepIds = new Set(tailSlice.map(x => x.id));
    for (const id of Array.from(keepIds)) {
      let n = mapping[id];
      while (n && n.parent && !keepIds.has(n.parent)) { keepIds.add(n.parent); n = mapping[n.parent]; }
    }

    const newMapping = {};
    for (const id of keepIds) {
      const old = mapping[id]; if (!old) continue;
      const neo = structuredClone(old);
      if (neo.message) {
        const role = neo.message.author?.role || neo.message.role;
        if (role === 'user' || role === 'assistant') {
          const f = tailSlice.find(x => x.id === id);
          if (f) {
            neo.message.content = { content_type: 'text', parts: [f.text] };
            delete neo.message.parts; delete neo.message.text;
          }
        }
      }
      if (Array.isArray(neo.children)) neo.children = neo.children.filter(cid => keepIds.has(cid));
      newMapping[id] = neo;
    }

    const newCurrent = tailSlice.length ? tailSlice[tailSlice.length - 1].id : conv.current_node;
    conv.mapping = newMapping;
    conv.current_node = newCurrent;

    // Only save if current flat is larger than existing (prevent overwriting full data with trimmed stream)
    const existingFlat = storage?.getJSON(`cl:flat:${convId}`, []) || [];
    const existingMeta = storage?.getJSON(`cl:meta:${convId}`, {}) || {};
    const existingTotal = existingMeta.renderableTotal || existingFlat.length || 0;

    if (renderableTotal > existingTotal) {
      storage?.setJSON(`cl:flat:${convId}`, flat);
      storage?.setJSON(`cl:meta:${convId}`, { renderableTotal, keptRenderableByReact: keep });
      storage?.setNum(`cl:inj:${convId}`, 0);
      setTimeout(() => window.dispatchEvent(new CustomEvent('cl:tail-meta')), 0);
      LOG('stream:shrink', { convId, total: renderableTotal, kept: keep });
    }

    return conv;
  }

  function extractJSONObject(str, startIdx) {
    let i = startIdx, depth = 0;
    for (; i < str.length; i++) {
      const ch = str[i];
      if (ch === '"') { i++; for (; i < str.length; i++) { if (str[i] === '\\') { i++; continue; } if (str[i] === '"') break; } }
      else if (ch === '{') { depth++; }
      else if (ch === '}') { depth--; if (depth === 0) return [str.slice(startIdx, i + 1), i + 1]; }
    }
    return [null, str.length];
  }

  function findAndReplaceKey(text, key, processor) {
    let i = 0, out = '', changes = 0;
    const searchKey = `"${key}"`;
    LOG('stream:findkey:start', { key, textSize: text.length, searchKey });

    while (true) {
      const keyIdx = text.indexOf(searchKey, i);
      if (keyIdx < 0) {
        out += text.slice(i);
        LOG('stream:findkey:notfound', { key, fromPos: i });
        break;
      }

      LOG('stream:findkey:found', { key, pos: keyIdx });
      out += text.slice(i, keyIdx);
      const colon = text.indexOf(':', keyIdx);
      const brace = text.indexOf('{', colon);
      if (colon < 0 || brace < 0) {
        LOG('stream:findkey:no-brace', { key, colon, brace });
        out += text.slice(keyIdx);
        break;
      }

      const [objStr, end] = extractJSONObject(text, brace);
      if (!objStr) {
        LOG('stream:findkey:no-json', { key });
        out += text.slice(keyIdx);
        break;
      }

      LOG('stream:findkey:extracted', { key, jsonSize: objStr.length });
      try {
        const processed = processor(objStr, text, keyIdx);
        if (processed) {
          LOG('stream:findkey:processed', { key });
          out += `"${key}":` + processed;
          i = end;
          changes++;
          continue;
        } else {
          LOG('stream:findkey:processor-returned-null', { key });
        }
      } catch (e) {
        LOG('stream:findkey:error', { key, error: e.message });
      }

      out += text.slice(keyIdx, end);
      i = end;
    }

    LOG('stream:findkey:done', { key, changes });
    return { text: out, changes };
  }

  function isLikelyConvMapping(map) {
    if (!map || typeof map !== 'object') return false;
    const keys = Object.keys(map);
    if (keys.length < 2) return false;
    const uuidRx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let uuidCount = 0, msgLike = 0;
    const sampleKeys = keys.slice(0, Math.min(5, keys.length));
    for (const k of keys.slice(0, Math.min(12, keys.length))) {
      if (uuidRx.test(k)) uuidCount++;
      const v = map[k];
      if (v && typeof v === 'object' && (v.message || 'parent' in v || Array.isArray(v.children))) msgLike++;
    }
    const isLikely = (uuidCount >= 2 && msgLike >= 1);
    LOG('stream:isLikelyConvMapping:details', { isLikely, uuidCount, msgLike, totalKeys: keys.length, sampleKeys });
    return isLikely;
  }

  function findConvIdInText(text) {
    try {
      const m1 = text.match(/"conversation_id"\s*:\s*"([0-9a-f-]{36})"/i);
      if (m1) return m1[1];
      const m2 = text.match(/\/(?:c|share)\/([0-9a-f-]{36})/i);
      if (m2) return m2[1];
    } catch { }
    return null;
  }

  function findCurrentNodeIdNear(text, fromIdx) {
    try {
      const re = /"current_node"\s*:\s*"([0-9a-f-]{36})"/ig;
      re.lastIndex = Math.max(0, fromIdx - 2000);
      const end = Math.min(text.length, fromIdx + 200000);
      let m; let best = null; let bestIdx = Infinity;
      while ((m = re.exec(text))) {
        const pos = m.index;
        if (pos >= fromIdx && pos < end) { best = m[1]; bestIdx = pos; break; }
        if (pos < fromIdx && (fromIdx - pos) < bestIdx) { best = m[1]; bestIdx = fromIdx - pos; }
        if (re.lastIndex > end) break;
      }
      return best;
    } catch { }
    return null;
  }

  function transformTextChunk(text) {
    LOG('stream:transform:start', { hasConversation: text.includes('"conversation"'), hasMapping: text.includes('"mapping"') });

    // Try standard conversation format
    let result = findAndReplaceKey(text, 'conversation', (objStr) => {
      LOG('stream:transform:found-conversation', { size: objStr.length });
      const conv = JSON.parse(objStr);
      if (conv?.mapping) {
        const shrunk = shrinkConversation(conv);
        return JSON.stringify(shrunk);
      }
      return null;
    });

    LOG('stream:transform:conversation-result', { changes: result.changes });

    // Fallback to mapping-only if no conversation changes
    if (result.changes === 0 && text.includes('"mapping"')) {
      LOG('stream:transform:trying-mapping-fallback');
      result = findAndReplaceKey(text, 'mapping', (objStr, fullText, keyIdx) => {
        const jsonSize = objStr.length;
        LOG('stream:transform:found-mapping', { size: jsonSize });

        // Skip if too small (likely not conversation mapping)
        if (jsonSize < 1000) {
          LOG('stream:transform:mapping-too-small', { size: jsonSize });
          return null;
        }

        const mapObj = JSON.parse(objStr);
        const isLikely = isLikelyConvMapping(mapObj);
        LOG('stream:transform:isLikelyConvMapping', { isLikely, keysCount: Object.keys(mapObj).length });

        if (isLikely) {
          const convId = findConvIdInText(fullText) || convIdFromLocation() || 'unknown';
          const curId = findCurrentNodeIdNear(fullText, keyIdx);
          LOG('stream:transform:shrinking-mapping', { convId, curId });
          const conv = { mapping: mapObj, current_node: curId || null, conversation_id: convId };
          const shrunk = shrinkConversation(conv);
          return JSON.stringify(shrunk.mapping);
        }
        return null;
      });
      LOG('stream:transform:mapping-result', { changes: result.changes });
    }

    return result.changes > 0 ? result : { text, changes: 0 };
  }

  // ReadableStream hook
  (function patchReadableStream() {
    try {
      const RS = window.ReadableStream; if (!RS) return;
      const proto = RS.prototype; if (!proto || proto.__clxPatchedGetReader) return;
      const origGetReader = proto.getReader; if (typeof origGetReader !== 'function') return;

      const patched = new WeakSet();
      proto.getReader = function (...args) {
        const reader = origGetReader.apply(this, args);
        if (!reader || patched.has(reader) || typeof reader.read !== 'function') return reader;
        patched.add(reader);

        const origRead = reader.read.bind(reader);
        reader.read = async function (...rArgs) {
          const res = await origRead(...rArgs);
          try {
            if (!res || res.done || !res.value) return res;
            let asText = '';
            if (res.value instanceof Uint8Array) asText = td.decode(res.value);
            else if (typeof res.value === 'string') asText = res.value;
            if (!asText) return res;

            const hasConvMap = asText.includes('"conversation"') || asText.includes('"mapping"');
            if (hasConvMap) {
              const { text, changes } = transformTextChunk(asText);
              if (changes > 0) return { done: false, value: te.encode(text) };
            }
          } catch { }
          return res;
        };
        return reader;
      };
      proto.__clxPatchedGetReader = true;
      LOG('stream:readablestream:patched');
    } catch { }
  })();

  // EventSource hook
  (function patchEventSource() {
    try {
      const ES = window.EventSource; if (!ES || ES.prototype.__clxESPatched) return;
      const proto = ES.prototype; proto.__clxESPatched = true;
      const origAdd = proto.addEventListener;
      const wrappers = new WeakMap();

      function wrapListener(type, listener) {
        if (type !== 'message' || typeof listener !== 'function') return listener;
        const wrapped = function (ev) {
          try {
            const data = ev && ev.data; if (!data || typeof data !== 'string') return listener.call(this, ev);
            const inclConv = data.includes('"conversation"');
            const inclMap = data.includes('"mapping"');
            if (inclConv || inclMap) {
              const { text, changes } = transformTextChunk(data);
              if (changes > 0) {
                const cloned = new MessageEvent('message', { data: text, lastEventId: ev.lastEventId, origin: ev.origin, ports: ev.ports, source: ev.source });
                return listener.call(this, cloned);
              }
            }
          } catch { }
          return listener.call(this, ev);
        };
        wrappers.set(listener, wrapped); return wrapped;
      }

      proto.addEventListener = function (type, listener, options) {
        return origAdd.call(this, type, wrapListener(type, listener), options);
      };

      Object.defineProperty(proto, 'onmessage', {
        configurable: true,
        get() { return this.__clxOnMsg || null; },
        set(fn) { this.__clxOnMsg = fn; if (typeof fn === 'function') { origAdd.call(this, 'message', wrapListener('message', fn)); } }
      });

      LOG('stream:eventsource:patched');
    } catch { }
  })();

  // Bootstrap JSON interceptor
  (function patchBootstrapScripts() {
    try {
      const MARK = 'data-clx-boot-processed';
      const shouldProcess = (s) => {
        if (!s || s.nodeName !== 'SCRIPT') return false;
        if (s.hasAttribute(MARK)) return false;
        const type = (s.type || '').toLowerCase();
        if (!(type.startsWith('application/') || type === '')) return false;
        const txt = s.textContent || ''; if (!txt) return false;
        return txt.includes('"mapping"') || txt.includes('"conversation"');
      };
      const processOne = (s) => {
        try {
          const txt = s.textContent || ''; if (!txt) return;
          const { text: newText, changes } = transformTextChunk(txt);
          if (changes > 0 && typeof newText === 'string') {
            s.textContent = newText; s.setAttribute(MARK, '1');
          }
        } catch { }
      };
      const scanAll = () => {
        try {
          const list = document.querySelectorAll('script');
          for (const s of list) { if (shouldProcess(s)) processOne(s); }
        } catch { }
      };
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of (m.addedNodes || [])) {
            if (n && n.nodeType === 1) {
              if (n.nodeName === 'SCRIPT') { if (shouldProcess(n)) processOne(n); }
              else {
                const inner = n.querySelectorAll?.('script');
                if (inner) for (const s of inner) { if (shouldProcess(s)) processOne(s); }
              }
            }
          }
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanAll, { once: true }); else scanAll();
      LOG('stream:bootstrap:patched');
    } catch { }
  })();

  // SPA Navigation Watcher - triggers on URL changes
  (function watchSPANavigation() {
    let lastUrl = location.href;
    let lastConvId = convIdFromLocation();

    const checkNavigation = () => {
      const currentUrl = location.href;
      const currentConvId = convIdFromLocation();

      if (currentUrl !== lastUrl || currentConvId !== lastConvId) {
        LOG('stream:spa-navigation', {
          from: lastConvId,
          to: currentConvId,
          urlChanged: currentUrl !== lastUrl
        });

        lastUrl = currentUrl;
        lastConvId = currentConvId;

        // Trigger metadata refresh for toolbar
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('cl:tail-meta'));
          window.dispatchEvent(new CustomEvent('cl:navigation-changed'));
        }, 100);
      }
    };

    // Method 1: History API hooks
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;

    history.pushState = function (...args) {
      origPushState.apply(this, args);
      checkNavigation();
    };

    history.replaceState = function (...args) {
      origReplaceState.apply(this, args);
      checkNavigation();
    };

    // Method 2: popstate event
    window.addEventListener('popstate', checkNavigation);

    // Method 3: Polling fallback (catches React Router updates)
    setInterval(checkNavigation, 500);

    LOG('stream:spa-watcher:active');
  })();

  LOG('stream:init:complete');
})();
