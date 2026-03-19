(function(){
  'use strict';
  // Port toolbar from userscript lines 228-285
  
  function waitForDeps(cb) {
    let attempts = 0;
    const maxAttempts = 100; // 5 seconds max
    const check = () => {
      attempts++;
      if (window.TailCore && window.CLTheme && window.CLX_ICONS) {
        cb();
      } else if (attempts >= maxAttempts) {
        console.error('[ChatGPT-Opt] toolbar: dependencies timeout', {
          TailCore: !!window.TailCore,
          CLTheme: !!window.CLTheme,
          CLX_ICONS: !!window.CLX_ICONS
        });
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  }

  waitForDeps(() => {
    const { getTail, setTail, getMeta, getFlat, setInjected, getInjected, convIdFromLocation, CFG } = window.TailCore;
    const CLX_ICONS = window.CLX_ICONS;
    const CLTheme = window.CLTheme;
    const { LOG } = window.TailLog || { LOG: function(){} };
    
    LOG('toolbar:deps-ready');

  // -------------------- Status bar (messages + load time) --------------------
  function ensureStatusBarStyles(){
    if(document.getElementById('clx-statusbar-styles')) return;
    const s=document.createElement('style');
    s.id='clx-statusbar-styles';
    s.textContent = `
      .clx-statusbar {
        display: flex;
        align-items: center;
        margin-left: 12px;
        gap: 14px;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        opacity: .85;
        color: var(--text-primary, #374151);
        pointer-events: auto;
      }

      .clx-statusbar .sb-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: help;
      }

      .clx-statusbar .sb-icn {
        width: 16px;
        height: 16px;
        color: var(--icon-secondary, #9CA3AF)
      }
  `;
    (document.head||document.documentElement).appendChild(s);
  }

  const MSG_ICON = '<svg class="sb-icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v9z"></path></svg>';
  const TIME_ICON = '<svg class="sb-icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>';

  function findStatusContainer(){
    return document.querySelector('#page-header .flex-1.items-center') ||
           document.querySelector('#page-header > div:first-child');
  }

  function isConversationRoute(){
    try { return !!convIdFromLocation(); } catch { return false; }
  }

  function computeStatus(){
    const id = convIdFromLocation();
    let total = 0;
    let displayed = 0;
    if (id) {
      try {
        const meta = getMeta(id) || {};
        const flat = getFlat(id) || [];
        total = meta.renderableTotal || flat.length || 0;
        const inj = getInjected(id) || 0;
        displayed = (meta.keptRenderableByReact || 0) + inj;
      } catch {}
    }
    if (!total) {
      // Fallback to DOM count if meta not ready
      total = document.querySelectorAll('[data-testid^="conversation-turn-"]').length || 0;
      displayed = total;
    }
    
    // Safety bounds
    displayed = Math.min(displayed, total);
    if (displayed === 0 && total > 0) displayed = total;

    let secs = null;
    if (id) {
      const msStr = localStorage.getItem(`cl:last-load-ms:${id}`);
      if (msStr && !isNaN(+msStr)) {
        const s = (+msStr)/1000;
        secs = Math.round(s * 10) / 10; // 0.1s precision
      }
    }
    return { id, total, displayed, secs };
  }

  function stopStatusTimer(bar){
    const t = bar && bar.__sbTimer;
    if (t && t.i) clearInterval(t.i);
    if (bar) bar.__sbTimer = null;
  }

  function renderStatusBar(){
    // Only render on conversation pages
    if (!isConversationRoute()) {
      const stray = document.getElementById('clx-statusbar');
      if (stray) stray.remove();
      return false;
    }
    ensureStatusBarStyles();
    const host = findStatusContainer();
    if(!host) {
      const stray = document.getElementById('clx-statusbar');
      if (stray) stray.remove();
      return false;
    }
    let bar = document.getElementById('clx-statusbar');
    if(!bar){
      bar = document.createElement('div');
      bar.id = 'clx-statusbar';
      bar.className = 'clx-statusbar';
      bar.innerHTML = `
        <span class="sb-item" title="Total messages">${MSG_ICON}<span class="sb-val sb-messages">–</span></span>
        <span class="sb-item" title="Load time">${TIME_ICON}<span class="sb-val sb-seconds">–</span></span>`;
    }
    if (bar.parentElement !== host) {
      host.appendChild(bar);
    }
    const { id, total, displayed, secs } = computeStatus();
    // Reset timer if conversation changed
    if (bar.__convId !== id) {
      stopStatusTimer(bar);
      bar.__convId = id;
    }
    const msgEl = bar.querySelector('.sb-messages');
    const secEl = bar.querySelector('.sb-seconds');
    if (msgEl) msgEl.textContent = `${displayed}/${total}`;
    if (secEl) {
      if (secs == null) {
        // Start live timer if not already running
        if (!bar.__sbTimer) {
          const start = performance.now();
          bar.__sbTimer = {
            i: setInterval(() => {
              // If final value becomes available, switch to it and stop
              const curId = bar.__convId || convIdFromLocation();
              if (curId) {
                const msStr = localStorage.getItem(`cl:last-load-ms:${curId}`);
                if (msStr && !isNaN(+msStr)) {
                  const finalSecs = Math.round((+msStr/1000)*10)/10;
                  secEl.textContent = String(finalSecs);
                  stopStatusTimer(bar);
                  return;
                }
              }
              const elapsed = (performance.now() - start)/1000;
              const v = Math.round(elapsed*10)/10;
              secEl.textContent = String(v);
              // Safety stop after 30s in case of errors/timeouts
              if (v >= 30) stopStatusTimer(bar);
            }, 100)
          };
        }
      } else {
        // Final time known: show it and stop any running timer
        secEl.textContent = String(secs);
        stopStatusTimer(bar);
      }
    }
    return true;
  }

  function mountStatusBar(){
    // Remove if not on conversation page
    if (!isConversationRoute()) { 
      const stray = document.getElementById('clx-statusbar');
      if (stray) stray.remove();
      return; 
    }
    if (renderStatusBar()) return; // mounted
    // Defer until container appears
    const mo = new MutationObserver(() => {
      if (renderStatusBar()) mo.disconnect();
    });
    mo.observe(document.documentElement, { childList:true, subtree:true });
    setTimeout(()=>mo.disconnect(), 10000);
  }

  function resetStatusBarClock(){
    const bar = document.getElementById('clx-statusbar');
    if (!bar) return;
    // Stop any running timer
    stopStatusTimer(bar);
    // Reset visible seconds immediately
    const secEl = bar.querySelector('.sb-seconds');
    if (secEl) secEl.textContent = '0';
    // Clear stored time for current conversation so computeStatus() starts fresh
    try {
      const id = convIdFromLocation();
      if (id) localStorage.removeItem(`cl:last-load-ms:${id}`);
      // Mark current conv id to avoid reusing previous timer state
      bar.__convId = id;
    } catch {}
  }

  function ensureLocalStack(){
    const first=document.querySelector('[data-testid^="conversation-turn-"], main article, main section');
    if(!first) {
        console.warn('[ChatGPT-Opt] Cannot find first conversation element to inject #cl-older-stack');
        return null;
    }
    let stack=document.getElementById('cl-older-stack');
    if(!stack){ 
      stack=document.createElement('div'); 
      stack.id='cl-older-stack'; 
      first.parentElement.insertBefore(stack, first); 
    }
    return stack;
  }

  function makeBar(){
    const defaultTail = (window.TailCore?.globalSettings?.defaultTail) || 10;
    const bar=document.createElement('div'); 
    bar.id='chatgpt-restore-btn'; 
    bar.className='clx-bar clx-header-bar';
    bar.innerHTML=`
      <button id="show-all-btn" class="clx-linkbtn clx-reset">
        <span class="clx-txt-long">Show all</span><span class="clx-txt-short">all</span>
      </button>
      <button id="show-old-btn" class="clx-pill clx-reset">
        <span class="clx-icn">${CLX_ICONS.plus || '+'}</span>
        <span class="clx-pill-text">
          <span class="clx-txt-long">10 previous (…) </span>
          <span class="clx-txt-short">10</span>
        </span>
      </button>
      <button id="reset-to-latest-btn" class="clx-linkbtn clx-reset">
        <span class="clx-txt-long">Show only ${defaultTail} latest</span><span class="clx-txt-short">only ${defaultTail}</span>
      </button>`;
    
    // Inject styles for the header bar version
    if (!document.getElementById('clx-header-bar-styles')) {
      const s = document.createElement('style');
      s.id = 'clx-header-bar-styles';
      s.textContent = `
        .clx-header-bar {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-left: 16px;
          pointer-events: auto;
          /* Reset basic styling since it's no longer a full width banner */
          background: transparent !important;
          border: none !important;
          padding: 0 !important;
        }
        .clx-header-bar .clx-linkbtn { font-size: 13px; cursor: pointer; color: var(--text-primary); text-decoration: underline; background: transparent; border: none; }
        .clx-header-bar .clx-pill { display: flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 9999px; background: var(--main-surface-tertiary); border: 1px solid var(--border-light); cursor: pointer; color: var(--text-primary); font-size: 13px; }
        .clx-header-bar .clx-icn { width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; margin: 0; line-height: 1; }
        .clx-header-bar .clx-icn svg { width: 100%; height: 100%; }
        .clx-header-bar .is-disabled { opacity: 0.5; pointer-events: none; }
        
        .clx-txt-short { display: none; }
        @media (max-width: 1150px) {
          .clx-txt-long { display: none; }
          .clx-txt-short { display: inline; }
        }

        .sticky:has(#page-header), .sticky:has(.clx-header-bar), #page-header, .sticky.bg-white\\/95 {
          background-color: var(--main-surface-primary, #ffffff) !important;
          background: var(--main-surface-primary, #ffffff) !important;
          backdrop-filter: none !important;
        }
      `;
      (document.head||document.documentElement).appendChild(s);
    }
      
    return bar;
  }

  function mountBar(){
    const tryInsert=()=>{ 
      // Only show toolbar if optimizer is enabled for current conversation
      const isOn = (window.TailCore?.isOptimizerEnabledForCurrent?.()) !== false;
      if (!isOn) {
        const existing=document.getElementById('chatgpt-restore-btn');
        if (existing) existing.remove();
        LOG('toolbar:optimizer-disabled');
        return false;
      }
      
      const host = document.getElementById('clx-statusbar');
      if(!host) return false;
      
      // Check if bar already in correct position
      if(host.nextElementSibling?.id==='chatgpt-restore-btn') {
        LOG('toolbar:already-in-position');
        return true;
      }
      
      // Get existing bar or create new one
      const bar=document.getElementById('chatgpt-restore-btn')||makeBar(); 
      host.parentElement.insertBefore(bar, host.nextSibling);
      LOG('toolbar:mounted');

  const showBtn=document.getElementById('show-old-btn');
  const allBtn=document.getElementById('show-all-btn');
  const resetBtn=document.getElementById('reset-to-latest-btn');

      const refreshLabels=()=>{ 
        const id=convIdFromLocation(); 
        if(!id) return; 
        const {renderableTotal=0,keptRenderableByReact=0}=getMeta(id); 
        const inj=getInjected(id);
        const olderLeft=Math.max(0, renderableTotal-keptRenderableByReact-inj);
        
        const defaultTail = (window.TailCore?.globalSettings?.defaultTail) || 10;
        const step = CFG?.STEP || 10;
        
        const text=`<span class="clx-icn">${CLX_ICONS.plus || '+'}</span>` +
                   `<span class="clx-pill-text">` +
                     `<span class="clx-txt-long">${step} previous (${olderLeft})</span>` +
                     `<span class="clx-txt-short">${step}</span>` +
                   `</span>`;
        showBtn.innerHTML=text;
        showBtn.classList.toggle('is-disabled', olderLeft<=0);
        allBtn.classList.toggle('is-disabled', olderLeft<=0);
        
        allBtn.innerHTML = olderLeft>0 
          ? `<span class="clx-txt-long">Show all (${olderLeft})</span><span class="clx-txt-short">all(${olderLeft})</span>` 
          : `<span class="clx-txt-long">Show all</span><span class="clx-txt-short">all</span>`;
          
        resetBtn.innerHTML = `<span class="clx-txt-long">Show only ${defaultTail} latest</span><span class="clx-txt-short">only ${defaultTail}</span>`;
        
        allBtn.setAttribute('aria-disabled', (olderLeft<=0) ? 'true' : 'false');
        showBtn.setAttribute('aria-disabled', (olderLeft<=0) ? 'true' : 'false');
      };
      
      // Store refresh function on button for external access
      showBtn.__refresh = refreshLabels;

      function loadOlderMessages(count) {
        LOG('toolbar:load-older-clicked', count);
        const id = convIdFromLocation();
        if (!id) {
          return;
        }
        const stack = ensureLocalStack();
        if (!stack) {
          return;
        }
        
        const meta = getMeta(id);
        const flat = getFlat(id);
        const base = meta.keptRenderableByReact || 0;
        const inj = getInjected(id);
        const total = meta.renderableTotal || flat.length;
        const left = Math.max(0, total - (base + inj));
        
        const addN = count === 'all' ? left : Math.min(count, left);
        if (addN <= 0) {
          return;
        }
        
        const start = total - (base + inj + addN);
        const end = total - (base + inj);
        const frag = document.createDocumentFragment();
        let lastInsertedEl = null; // bottom-most of the inserted batch
        for (let i = start; i < end; i++) {
          const it = flat[i];
          if (!it) continue;
          const el = CLTheme.makeArticle(it.role, it.text);
          // Remember the last element in this batch (closest to current view)
          lastInsertedEl = el;
          frag.appendChild(el);
        }
        
        stack.prepend(frag);
        setInjected(id, inj + addN);
        refreshLabels();
        renderStatusBar(); // Update top right status message (10/50 -> 20/50, etc)

        // After DOM updates, scroll so that the last inserted item sits at the top of the viewport
        // This preserves context and avoids a large jump to the very top of the newly added block
        if (lastInsertedEl) {
          requestAnimationFrame(() => {
            try {
              lastInsertedEl.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
            } catch {}
          });
        }
      }

      showBtn.onclick = () => loadOlderMessages(CFG.STEP || 10);

      allBtn.onclick = () => {
        if (allBtn.classList.contains('is-disabled')) return;
        loadOlderMessages('all');
      };

      resetBtn.onclick=()=>{ 
        const id=convIdFromLocation(); 
        if(!id) return; 
        document.getElementById('cl-older-stack')?.replaceChildren(); 
        setInjected(id,0);
        const defaultTail = (window.TailCore?.globalSettings?.defaultTail) || 10;
        setTail(id, defaultTail); 
        refreshLabels(); 
        renderStatusBar(); // Synchronize top status bar
      };

      // no per-page toggle in toolbar

      window.addEventListener('cl:tail-meta', refreshLabels);
      
      refreshLabels(); 
      return true;
    };

    if(!tryInsert()){ 
      const mo=new MutationObserver(()=>{ 
        if(tryInsert()) mo.disconnect(); 
      }); 
      mo.observe(document.documentElement,{childList:true,subtree:true}); 
      setTimeout(()=>mo.disconnect(),15000); 
    }
  }

    CLTheme.ensureStyles();
  // Mount status bar early
  mountStatusBar();
    
    // Persistent MutationObserver to keep toolbar mounted
    let persistentObserver = null;
    let remountTimeout = null;
    
    function startPersistentWatch() {
      if (persistentObserver) persistentObserver.disconnect();
      
      persistentObserver = new MutationObserver(() => {
        // Debounce remounting to avoid spam
        if (remountTimeout) return;
        
        remountTimeout = setTimeout(() => {
          remountTimeout = null;
          
          const isOnNow = (window.TailCore?.isOptimizerEnabledForCurrent?.()) !== false;
          const rootBar = document.getElementById('chatgpt-restore-btn');
          
          if (!isOnNow) {
            if (rootBar) { LOG('toolbar:removing-optimizer-disabled'); rootBar.remove(); }
            return;
          }

          // Also verify status bar is mounted and in right position (needs to be done FIRST because mountBar depends on it)
          if (isConversationRoute()) {
            const sb = document.getElementById('clx-statusbar');
            const host = findStatusContainer();
            if (!sb && host) {
              renderStatusBar();
            } else if (sb && host && sb.parentElement !== host) {
              host.appendChild(sb);
            }
          }

          // Now check the action bar
          const bar = document.getElementById('chatgpt-restore-btn');
          const statusHost = document.getElementById('clx-statusbar');
          
          if (!bar && statusHost) {
            LOG('toolbar:auto-remount');
            mountBar();
          }
          else if (bar && statusHost && statusHost.nextSibling !== bar) {
            LOG('toolbar:auto-reposition');
            statusHost.parentElement.insertBefore(bar, statusHost.nextSibling);
          }
          // Avoid constant refreshes post-load; status bar updates via events/navigation
        }, 100); // 100ms debounce
      });
      
      // Ensure document.body exists before observing
      if (document.body) {
        persistentObserver.observe(document.body, {
          childList: true,
          subtree: true
        });
      } else {
        LOG('toolbar:body-not-ready');
      }
    }
    
    // Initial mount
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', mountBar, {once:true}); 
    else mountBar();
    
    // Start watching after initial mount
    setTimeout(startPersistentWatch, 1000);
    
    // Re-mount toolbar on SPA navigation (in case DOM changed)
    window.addEventListener('cl:navigation-changed', () => {
      LOG('toolbar:navigation-changed');
      // Immediately reset status bar seconds for the upcoming chat
      resetStatusBarClock();
      // If it's not a conversation route anymore, remove status bar immediately
      if (!isConversationRoute()) {
        const stray = document.getElementById('clx-statusbar');
        if (stray) stray.remove();
      }
      
      // Clear injected stack on navigation
      const stack = document.getElementById('cl-older-stack');
      if (stack) stack.replaceChildren();
      
      const id = convIdFromLocation();
      if (id) setInjected(id, 0);
      
      // Wait for React to fully render new page
      setTimeout(() => {
        const existing = document.getElementById('chatgpt-restore-btn');
        if (!existing) {
          LOG('toolbar:remount-needed');
          mountBar();
        } else {
          LOG('toolbar:already-mounted');
          // Refresh labels even if toolbar exists
          const showBtn = document.getElementById('show-old-btn');
          if (showBtn && showBtn.__refresh) {
            showBtn.__refresh();
          }
        }
        // Mount/update status bar for new conversation (no-op on non-conversation pages)
        mountStatusBar();
      }, 800);
    });

    // Update status bar when meta changes (total messages)
    window.addEventListener('cl:tail-meta', () => {
      renderStatusBar();
    });
  }); // End waitForDeps callback
})();
