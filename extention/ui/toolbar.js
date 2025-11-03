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
        margin-right: 20px;
        gap: 14px;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        opacity: .85;
        color: var(--text-primary, #374151);
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
    return document.querySelector('#thread-bottom + div');
  }

  function isConversationRoute(){
    try { return !!convIdFromLocation(); } catch { return false; }
  }

  function computeStatus(){
    const id = convIdFromLocation();
    let total = 0;
    if (id) {
      try {
        const meta = getMeta(id) || {};
        const flat = getFlat(id) || [];
        total = meta.renderableTotal || flat.length || 0;
      } catch {}
    }
    if (!total) {
      // Fallback to DOM count if meta not ready
      total = document.querySelectorAll('article[data-testid^="conversation-turn-"]').length || 0;
    }
    let secs = null;
    if (id) {
      const msStr = localStorage.getItem(`cl:last-load-ms:${id}`);
      if (msStr && !isNaN(+msStr)) {
        const s = (+msStr)/1000;
        secs = Math.round(s * 10) / 10; // 0.1s precision
      }
    }
    return { id, total, secs };
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
      host.prepend(bar);
    }
    const { id, total, secs } = computeStatus();
    // Reset timer if conversation changed
    if (bar.__convId !== id) {
      stopStatusTimer(bar);
      bar.__convId = id;
    }
    const msgEl = bar.querySelector('.sb-messages');
    const secEl = bar.querySelector('.sb-seconds');
    if (msgEl) msgEl.textContent = String(total);
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
    const first=document.querySelector('article[data-testid^="conversation-turn-"], main article');
    if(!first) return null;
    let stack=document.getElementById('cl-older-stack');
    const bar = document.getElementById('chatgpt-restore-btn');
    if(!stack){ 
      stack=document.createElement('div'); 
      stack.id='cl-older-stack'; 
      // Prefer placing stack right after toolbar if it exists, so the toolbar stays on top
      if (bar && bar.parentElement === first.parentElement) {
        // Safety: avoid inserting if that would create a DOM cycle (stack contains bar)
        try {
          if (!stack.contains(bar) && !bar.contains(stack)) {
            bar.insertAdjacentElement('afterend', stack);
          } else {
            // fallback to safe insert
            first.parentElement.insertBefore(stack, first);
          }
        } catch (e) {
          // In some edge cases insertAdjacentElement can throw; fallback to safe insert
          first.parentElement.insertBefore(stack, first);
        }
      } else {
        first.parentElement.insertBefore(stack, first); 
      }
    } else {
      // Keep stack positioned right after toolbar when present
      if (bar) {
        // If stack already contains the toolbar (bad state), move stack before first
        if (stack.contains(bar)) {
          try { first.parentElement.insertBefore(stack, first); } catch(e){}
        } else if (stack.previousElementSibling !== bar) {
          try {
            if (!stack.contains(bar) && !bar.contains(stack)) {
              bar.insertAdjacentElement('afterend', stack);
            } else {
              first.parentElement.insertBefore(stack, first);
            }
          } catch(e) {
            try { first.parentElement.insertBefore(stack, first); } catch(e){}
          }
        }
      }
    }
    return stack;
  }

  function makeBar(){
    const defaultTail = (window.TailCore?.globalSettings?.defaultTail) || 10;
    const bar=document.createElement('div'); 
    bar.id='chatgpt-restore-btn'; 
    bar.className='clx-bar';
    bar.innerHTML=`
      <button id="show-all-btn" class="clx-linkbtn clx-reset">Show all</button>
      <button id="show-old-btn" class="clx-pill clx-reset">
        <span class="clx-icn">${CLX_ICONS.plus || '+'}</span>
        <span class="clx-pill-text">10 previous (…) </span>
      </button>
      <button id="reset-to-latest-btn" class="clx-linkbtn clx-reset">Show only ${defaultTail} latest</button>`;
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
      const first=document.querySelector('article[data-testid^="conversation-turn-"], main article'); 
      if(!first) return false;
      
      // Check if bar already in correct position
      if(first.previousElementSibling?.id==='chatgpt-restore-btn') {
        LOG('toolbar:already-in-position');
        return true;
      }
      
      // Get existing bar or create new one
      const bar=document.getElementById('chatgpt-restore-btn')||makeBar(); 
      first.parentElement.insertBefore(bar, first);
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
        const text=`<span class="clx-icn">${CLX_ICONS.plus || '+'}</span><span class="clx-pill-text">10 previous (${olderLeft})</span>`;
        showBtn.innerHTML=text;
        showBtn.classList.toggle('is-disabled', olderLeft<=0);
        allBtn.classList.toggle('is-disabled', olderLeft<=0);
        allBtn.textContent = olderLeft>0?`Show all (${olderLeft})`:'Show all';
        allBtn.setAttribute('aria-disabled', (olderLeft<=0) ? 'true' : 'false');
        showBtn.setAttribute('aria-disabled', (olderLeft<=0) ? 'true' : 'false');
      };
      
      // Store refresh function on button for external access
      showBtn.__refresh = refreshLabels;

      function loadOlderMessages(count) {
        const id = convIdFromLocation();
        if (!id) return;
        const stack = ensureLocalStack();
        if (!stack) return;
        
        const meta = getMeta(id);
        const flat = getFlat(id);
        const base = meta.keptRenderableByReact || 0;
        const inj = getInjected(id);
        const total = meta.renderableTotal || flat.length;
        const left = Math.max(0, total - (base + inj));
        
        const addN = count === 'all' ? left : Math.min(count, left);
        if (addN <= 0) return;
        
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
        // Update button text with current default
        resetBtn.textContent = `Show only ${defaultTail} latest`;
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
          
          const bar = document.getElementById('chatgpt-restore-btn');
          const first = document.querySelector('article[data-testid^="conversation-turn-"], main article');
          const isOnNow = (window.TailCore?.isOptimizerEnabledForCurrent?.()) !== false;
          if (!isOnNow) {
            if (bar) { LOG('toolbar:removing-optimizer-disabled'); bar.remove(); }
            return;
          }
          // If bar doesn't exist but articles do and optimizer is on, remount
          if (!bar && first) {
            LOG('toolbar:auto-remount');
            mountBar();
          }
          // If bar exists but is not in correct position, fix it
          else if (bar && first && bar.nextElementSibling !== first) {
            LOG('toolbar:auto-reposition');
            first.parentElement.insertBefore(bar, first);
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
