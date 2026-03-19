(function () {
  'use strict';
  // Port CLTheme from userscript lines 24-185

  const escAttr = (s) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // Configure marked if available
  if (window.marked) {
    window.marked.setOptions({ gfm: true, breaks: false, smartypants: true });
    window.marked.use({
      renderer: {
        link(href, title, text) {
          const t = title ? ` title="${escAttr(title)}"` : '';
          const safe = escAttr(href || '#');
          return `<a href="${safe}"${t} target="_blank" rel="nofollow noopener noreferrer">${text}</a>`;
        }
      }
    });
  }

  const SMART_CAPS_RX = [/^\s*```/, /^\s*#/, /^\s*>/, /^\s*[-*+]\s/, /^\s*\d+\.\s/, /^\s*<\w/];
  const firstLetterUpper = (s) => {
    if (!s) return s;
    if (SMART_CAPS_RX.some(rx => rx.test(s))) return s;
    const m = s.match(/[A-Za-zА-Яа-яЁёІіЇїЄєҐґ]/);
    if (!m) return s;
    const i = m.index, ch = m[0];
    return s.slice(0, i) + ch.toLocaleUpperCase() + s.slice(i + 1);
  };

  const wrapFence = (code, lang) => `\n\`\`\`${(lang || '').toString().trim().toLowerCase()}\n${String(code || '').replace(/\s+$/, '')}\n\`\`\`\n`;

  function stringifyParts(parts, { caps = false } = {}) {
    if (!Array.isArray(parts)) return '';
    const out = [];
    for (const p of parts) {
      if (typeof p === 'string') { out.push(p); continue; }
      if (!p || typeof p !== 'object') continue;
      const t = (p.content_type || p.type || '').toLowerCase();
      if (t === 'multimodal_text' && typeof p.text === 'string') { out.push(p.text); continue; }
      if (t === 'code' || p.language) {
        const code = (typeof p.text === 'string' ? p.text : typeof p.code === 'string' ? p.code : typeof p.content === 'string' ? p.content : '');
        out.push(wrapFence(code, p.language || p.lang || p.metadata?.language || ''));
        continue;
      }
      if (typeof p.text === 'string') { out.push(p.text); continue; }
      if (typeof p.content === 'string') { out.push(p.content); continue; }
      if (typeof p.value === 'string') { out.push(p.value); continue; }
    }
    let s = out.join('\n').trim();
    if (caps) s = firstLetterUpper(s);
    return s;
  }

  function mdToSafeHTML(text) {
    let html = String(text || '');
    if (window.marked) html = window.marked.parse(html);
    if (window.DOMPurify) {
      html = window.DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['target', 'rel', 'data-lang', 'class'],
        FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'script', 'link']
      });
    }
    return html;
  }

  function ensureStyles() {
    if (document.getElementById('clx-styles')) return;
    const s = document.createElement('style'); s.id = 'clx-styles';
    s.textContent = `
      #clx-root,
      #clx-root * {
        box-sizing: border-box;
      }

      .clx-reset {
        all: unset;
        box-sizing: border-box;
      }

      .is-disabled {
        opacity: .35 !important;
        cursor: not-allowed !important;
        pointer-events: none !important
      }

      /* Cards */
      #cl-older-stack {
        width: 100%;
      }

      /* Markdown overrides for GPT styling */
      .clx-md {
        font: 15px/1.65 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: var(--text-primary, #111)
      }

      .clx-md p {
        margin: 14px 0
      }

      .clx-md ul,
      .clx-md ol {
        margin: 12px 0 12px 24px
      }

      .clx-md li+li {
        margin-top: 6px
      }

      .clx-md h1 {
        font-size: 1.35rem;
        margin: 18px 0 10px;
        font-weight: 700
      }

      .clx-md h2 {
        font-size: 1.22rem;
        margin: 16px 0 10px;
        font-weight: 700
      }

      .clx-md h3 {
        font-size: 1.12rem;
        margin: 14px 0 8px;
        font-weight: 700
      }

      .clx-md strong,
      .clx-md b {
        font-weight: 600
      }

      .clx-md h1 strong,
      .clx-md h2 strong,
      .clx-md h3 strong {
        font-weight: 700
      }

      .clx-md a {
        color: var(--link, #2563eb);
        text-decoration: underline
      }

      .clx-md table {
        border-collapse: collapse;
        margin: 14px 0;
        width: 100%
      }

      .clx-md th,
      .clx-md td {
        border: 1px solid var(--border-light, #e5e7eb);
        padding: 8px 10px;
        text-align: left
      }

      .clx-md hr {
        border: none;
        border-top: 1px solid var(--border-light, #e5e7eb);
        margin: 16px 0
      }

      .clx-md blockquote {
        border-left: 4px solid var(--border-light, #e5e7eb);
        padding-left: 12px;
        color: var(--text-secondary, #444);
        margin: 12px 0
      }

      .clx-md img {
        max-width: 100%;
        border-radius: 10px;
        margin: 8px 0
      }

      .clx-empty {
        opacity: .6
      }

      .clx-md ul {
        list-style: disc;
        padding-left: 0
      }

      .clx-md ul ul {
        list-style: circle
      }

      .clx-md ol {
        list-style: decimal;
        padding-left: 0
      }

      .clx-md li::marker {
        color: #64748b;
        font-weight: 700
      }

      /* Code & copy */
      .clx-md pre {
        background: transparent;
        border: none;
        padding: 0 16px 16px 16px;
        margin: 0;
        border-radius: 0;
        overflow-x: auto;
        scrollbar-width: thin;
        scrollbar-color: var(--scrollbar-color, #cbd5e1) transparent;
      }

      .clx-md code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 13.5px;
        background: var(--composer-surface, var(--message-surface, #f6f8fa));
        border: 1px solid var(--border-light, #e5e7eb);
        padding: 1px 4px;
        border-radius: 6px;
        color: var(--text-primary, #111)
      }

      .clx-md pre code {
        background: transparent;
        border: none;
        padding: 0
      }

      .clx-md *::-webkit-scrollbar {
        height: 8px;
        width: 10px
      }

      .clx-md *::-webkit-scrollbar-track {
        background: var(--bg-secondary, #e9eef5);
        border-radius: 999px
      }

      .clx-md *::-webkit-scrollbar-thumb {
        background: var(--scrollbar-color, #cbd5e1);
        border-radius: 999px;
        border: 2px solid var(--bg-secondary, #e9eef5)
      }

      .clx-md *::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-color-hover, #94a3b8)
      }

      .hljs {
        display: block;
        overflow-x: auto;
        color: #24292e
      }

      .hljs-comment,
      .hljs-quote {
        color: #9ca3af;
        font-style: italic
      }

      .hljs-keyword,
      .hljs-selector-tag,
      .hljs-subst {
        color: #d73a49;
        font-weight: 600
      }

      .hljs-string,
      .hljs-title,
      .hljs-name,
      .hljs-type,
      .hljs-attribute {
        color: #2563eb
      }

      .hljs-literal,
      .hljs-number {
        color: #f59e0b
      }

      .hljs-section {
        color: #10b981;
        font-weight: 600
      }

      .hljs-symbol,
      .hljs-bullet,
      .hljs-link {
        color: #f59e0b
      }

      .hljs-meta {
        color: #a78bfa
      }

      .clx-codewrap {
        position: relative;
        background-color: #f9f9f9;
        border: 1px solid rgba(13,13,13,0.05);
        border-radius: 24px;
        margin: 16px 0;
        overflow: hidden;
      }
      
      @media (prefers-color-scheme: dark) {
         .clx-codewrap {
             background-color: var(--token-bg-elevated-secondary, #F9F9F9);
             border-color: rgba(255,255,255,0.1);
         }
      }

      .clx-codewrap-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        font-size: 13px;
        color: var(--text-primary, #333);
      }
      
      .clx-codewrap-lang {
        display: flex;
        align-items: center;
        font-weight: 500;
        text-transform: capitalize;
        color: var(--text-secondary, #666);
      }

      .clx-copy-btn {
        all: unset;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 10px;
        background: transparent;
        color: var(--text-tertiary, #5d5d5d);
        font-size: 12px;
        cursor: pointer;
        user-select: none;
      }

      .clx-copy-btn:hover {
        background: rgba(0,0,0,0.05);
      }
      @media (prefers-color-scheme: dark) {
        .clx-copy-btn:hover { background: rgba(255,255,255,0.1); }
      }

      .clx-copy-btn .clx-copy-icn {
        width: 20px;
        height: 20px;
        line-height: 0;
        color: #475569
      }

      .clx-copy-btn[data-copied="1"] {
        color: #10b981;
        background: rgba(16, 185, 129, .18)
      }

      .clx-copy-btn[data-copied="1"] .clx-copy-icn {
        color: #047857
      }

      /* Top bar */
      #chatgpt-restore-btn.clx-bar {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 18px;
        width: 100%;
        padding: 16px 0;
        margin: 6px 0 6px;
        position: relative;
        background: var(--main-surface-background, #fffffff2);
        z-index: 2;
      }

      #chatgpt-restore-btn.clx-bar::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        box-shadow: var(--sharp-edge-top-shadow, 0 1px 0 var(--border-sharp, rgba(0, 0, 0, .06)))
      }

      #chatgpt-restore-btn.clx-bar::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        box-shadow: var(--sharp-edge-bottom-shadow, 0 -1px 0 var(--border-sharp, rgba(0, 0, 0, .06)))
      }

      .clx-linkbtn {
        all: unset;
        cursor: pointer;
        background: transparent;
        color: var(--link, #2964aa);
        font: 500 13px/1.4 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
        padding: 10px 12px;
        border-radius: 9999px
      }

      .clx-linkbtn:hover {
        background: var(--interactive-bg-secondary-hover, #0000001a)
      }

      .clx-linkbtn:active {
        background: var(--interactive-bg-secondary-press, #0000000d)
      }

      @media (max-width: 494px) {
        #chatgpt-restore-btn.clx-bar {
          flex-direction: column;
          padding: 5px 0;
          gap: 0;
        }
      }

      /* Pills */
      .clx-pill {
        all: unset;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        min-height: 36px;
        padding: 0 14px;
        border-radius: 9999px;
        background: var(--interactive-bg-tertiary-default, #fff);
        color: var(--text-primary, #0d0d0d);
        border: 1px solid var(--border-medium, #00000026);
        box-shadow: none;
        transition: background .12s ease, color .12s ease;
      }

      .clx-pill:hover {
        background: var(--interactive-bg-tertiary-hover, #f9f9f9)
      }

      .clx-pill:active {
        background: var(--interactive-bg-tertiary-press, #f3f3f3)
      }

      .clx-icn {
        display: inline-flex;
        margin-right: 5px
      }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  const COPY_SVG = window.CLX_ICONS?.copy || '';

  function enhanceCodeBlocks(root) {
    if (!root) return;
    root.querySelectorAll('pre').forEach(pre => {
      if (pre.parentElement && pre.parentElement.classList.contains('clx-codewrap')) return;
      
      pre.style.padding = '0px 20px 12px';
      
      let lang = '';
      const codeEl = pre.querySelector('code');
      if (codeEl) {
        // e.g. language-cpp
        const match = Array.from(codeEl.classList).find(c => c.startsWith('language-'));
        if (match) {
          lang = match.replace('language-', '');
        }
        if (window.hljs) window.hljs.highlightElement(codeEl);
      }

      const wrap = document.createElement('div'); 
      wrap.className = 'clx-codewrap';
      
      // Header for language and copy button
      const header = document.createElement('div');
      header.className = 'clx-codewrap-header';
      
      const langSpan = document.createElement('span');
      langSpan.className = 'clx-codewrap-lang';
      langSpan.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" class="icon-sm me-2.5 shrink-0" style="display:inline-block; vertical-align:middle; margin-right:6px;"><use href="/cdn/assets/sprites-core-gmavja41.svg#e45ab3" fill="currentColor"></use></svg>${lang || 'code'}`;
      
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'clx-copy-btn';
      btn.setAttribute('aria-label', 'Copy code');
      btn.setAttribute('title', 'Copy code');
      btn.innerHTML = `<span class="clx-copy-icn">${COPY_SVG}</span><span class="clx-copy-txt">Copy code</span>`;
      btn.addEventListener('click', async () => {
        try {
          const text = codeEl ? codeEl.textContent : pre.textContent;
          await navigator.clipboard.writeText(text || '');
          btn.dataset.copied = '1';
          btn.querySelector('.clx-copy-txt').textContent = 'Copied';
          setTimeout(() => {
            btn.dataset.copied = '';
            btn.querySelector('.clx-copy-txt').textContent = 'Copy code';
          }, 1200);
        } catch {
          btn.querySelector('.clx-copy-txt').textContent = 'Copy failed';
          setTimeout(() => btn.querySelector('.clx-copy-txt').textContent = 'Copy code', 1200);
        }
      });
      
      header.appendChild(langSpan);
      header.appendChild(btn);
      
      pre.parentElement?.insertBefore(wrap, pre); 
      wrap.appendChild(header);
      wrap.appendChild(pre);
    });
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag]));
  }

  function makeArticle(role, text) {
    const section = document.createElement('section');
    section.setAttribute('data-cl-local', '1');
    section.setAttribute('data-role', role === 'user' ? 'user' : 'assistant');
    section.setAttribute('data-turn', role === 'user' ? 'user' : 'assistant');
    section.dir = 'auto';
    section.className = 'text-token-text-primary w-full focus:outline-none [--shadow-height:45px] has-data-writing-block:pointer-events-none has-data-writing-block:-mt-(--shadow-height) has-data-writing-block:pt-(--shadow-height) [&:has([data-writing-block])>*]:pointer-events-auto scroll-mt-(--header-height)';

    const isUser = role === 'user';
    const copySvgIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" class="icon"><use href="/cdn/assets/sprites-core-gmavja41.svg#ce3544" fill="currentColor"></use></svg>';

    if (isUser) {
      const escapedText = escapeHTML(text || '') || '<em class="clx-empty">[empty]</em>';
      section.innerHTML = `
        <h4 class="sr-only select-none">You said:</h4>
        <div class="text-base my-auto mx-auto pt-12 [--thread-content-margin:var(--thread-content-margin-xs,calc(var(--spacing)*4))] @w-sm/main:[--thread-content-margin:var(--thread-content-margin-sm,calc(var(--spacing)*6))] @w-lg/main:[--thread-content-margin:var(--thread-content-margin-lg,calc(var(--spacing)*16))] px-(--thread-content-margin)">
          <div class="[--thread-content-max-width:40rem] @w-lg/main:[--thread-content-max-width:48rem] mx-auto max-w-(--thread-content-max-width) flex-1 group/turn-messages focus-visible:outline-hidden relative flex w-full min-w-0 flex-col">
            <div class="flex max-w-full flex-col gap-4 grow">
              <div data-message-author-role="user" dir="auto" class="min-h-8 text-message relative flex w-full flex-col items-end gap-2 text-start break-words whitespace-normal outline-none keyboard-focused:focus-ring [.text-message+&]:mt-1">
                <div class="flex w-full flex-col gap-1 empty:hidden items-end rtl:items-start">
                  <div class="user-message-bubble-color corner-superellipse/0.98 relative rounded-[22px] px-4 py-2.5 leading-6 max-w-(--user-chat-width,70%)">
                    <div class="whitespace-pre-wrap">${escapedText}</div>
                  </div>
                </div>
              </div>
            </div>
            <div class="z-0 flex justify-end">
              <div aria-label="Your message actions" class="touch:-me-2 touch:-ms-3.5 -ms-2.5 -me-1 flex flex-wrap items-center gap-y-4 p-1 select-none focus-within:transition-none hover:transition-none touch:pointer-events-auto touch:opacity-100 duration-300 group-hover/turn-messages:delay-300 pointer-events-none opacity-0 motion-safe:transition-opacity group-hover/turn-messages:pointer-events-auto group-hover/turn-messages:opacity-100 group-focus-within/turn-messages:pointer-events-auto group-focus-within/turn-messages:opacity-100 has-data-[state=open]:pointer-events-auto has-data-[state=open]:opacity-100" role="group">
                <button class="text-token-text-secondary hover:bg-token-bg-secondary rounded-lg clx-msg-copy" aria-label="Copy message" type="button">
                  <span class="flex items-center justify-center touch:w-10 h-8 w-8">${copySvgIcon}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      const html = mdToSafeHTML(text) || '<em class="clx-empty">[empty]</em>';
      section.className = section.className.replace('scroll-mt-(--header-height)', 'scroll-mt-[calc(var(--header-height)+min(200px,max(70px,20svh)))]');
      section.innerHTML = `
        <h4 class="sr-only select-none">ChatGPT said:</h4>
        <div class="text-base my-auto mx-auto pb-10 [--thread-content-margin:var(--thread-content-margin-xs,calc(var(--spacing)*4))] @w-sm/main:[--thread-content-margin:var(--thread-content-margin-sm,calc(var(--spacing)*6))] @w-lg/main:[--thread-content-margin:var(--thread-content-margin-lg,calc(var(--spacing)*16))] px-(--thread-content-margin)">
          <div class="[--thread-content-max-width:40rem] @w-lg/main:[--thread-content-max-width:48rem] mx-auto max-w-(--thread-content-max-width) flex-1 group/turn-messages focus-visible:outline-hidden relative flex w-full min-w-0 flex-col agent-turn">
            <div class="flex max-w-full flex-col gap-4 grow">
              <div data-message-author-role="assistant" dir="auto" class="min-h-8 text-message relative flex w-full flex-col items-end gap-2 text-start break-words whitespace-normal outline-none keyboard-focused:focus-ring [.text-message+&]:mt-1">
                <div class="flex w-full flex-col gap-1 empty:hidden">
                  <div style="height: 40px;"></div>
                  <div class="markdown prose dark:prose-invert w-full wrap-break-word light markdown-new-styling">
                    ${html}
                  </div>
                </div>
              </div>
            </div>
            <div class="z-0 flex min-h-[46px] justify-start">
              <div aria-label="Response actions" class="touch:-me-2 touch:-ms-3.5 -ms-2.5 -me-1 flex flex-wrap items-center gap-y-4 p-1 select-none touch:w-[calc(100%+--spacing(3.5))] -mt-1 w-[calc(100%+--spacing(2.5))] duration-[1.5s] focus-within:transition-none hover:transition-none touch:pointer-events-auto pointer-events-none [mask-image:linear-gradient(to_right,black_33%,transparent_66%)] [mask-size:300%_100%] [mask-position:100%_0%] motion-safe:transition-[mask-position] group-hover/turn-messages:pointer-events-auto group-hover/turn-messages:[mask-position:0_0] group-focus-within/turn-messages:pointer-events-auto group-focus-within/turn-messages:[mask-position:0_0] has-data-[state=open]:pointer-events-auto has-data-[state=open]:[mask-position:0_0]" role="group">
                <button class="text-token-text-secondary hover:bg-token-bg-secondary rounded-lg clx-msg-copy" aria-label="Copy response" type="button">
                  <span class="flex items-center justify-center touch:w-10 h-8 w-8">${copySvgIcon}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // Attach copy event
    const copyBtn = section.querySelector('.clx-msg-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(text || '');
          const iconSpan = copyBtn.querySelector('span');
          iconSpan.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          setTimeout(() => { iconSpan.innerHTML = copySvgIcon; }, 1200);
        } catch {}
      });
    }

    enhanceCodeBlocks(section);
    return section;
  }

  window.CLTheme = { ensureStyles, stringifyParts, mdToSafeHTML, makeArticle };
})();
