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
        --clx-card-w: 820px
      }

      #cl-older-stack>article[data-cl-local] {
        width: 100%;
        margin: 26px 0;
        display: flex;
        justify-content: center;
      }

      #cl-older-stack>article[data-cl-local] .clx-row {
        width: min(var(--clx-card-w), 100%)
      }

      #cl-older-stack>article[data-cl-local][data-role="assistant"] .clx-card {
        max-width: 100%;
        background: rgba(0, 0, 0, 0);
        color: var(--text-primary, #111);
        padding: 18px 22px;
      }

      #cl-older-stack>article[data-cl-local][data-role="user"] .clx-row {
        display: flex;
        justify-content: flex-end;
      }

      #cl-older-stack>article[data-cl-local][data-role="user"] .clx-card {
        display: inline-block;
        width: auto;
        max-width: var(--user-chat-width, 70%);
        background: var(--theme-user-msg-bg, var(--message-surface, #f7f8fa));
        color: var(--theme-user-msg-text, var(--text-primary, #111));
        border: 1px solid var(--border-light, #eaecef);
        border-radius: 16px;
        box-shadow: 0 3px 16px rgba(0, 0, 0, .05);
        padding: 14px 18px;
      }

      .clx-role {
        opacity: .55;
        font-size: 12.5px;
        margin-bottom: 8px
      }

      @media (max-width: 1283px) {
        #cl-older-stack {
          --clx-card-w: 640px;
          padding: 0 24px;
        }

        #cl-older-stack>article[data-cl-local][data-role="assistant"] .clx-card {
          padding: 0;
        }
      }

      @media (max-width: 639px) {
        #cl-older-stack {
          padding: 0 16px;
        }
      }

      /* Markdown */
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
        background: var(--composer-surface, var(--message-surface, #f9f9f9));
        border: 1px solid var(--border-light, #e5e7eb);
        padding: 14px 16px;
        border-radius: 12px;
        overflow: auto;
        margin: 14px 0;
        scrollbar-width: thin;
        scrollbar-color: var(--scrollbar-color, #cbd5e1) var(--bg-secondary, #e9eef5);
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
        position: relative
      }

      .clx-copy-btn {
        all: unset;
        position: absolute;
        top: 8px;
        right: 10px;
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
        background: var(--interactive-bg-secondary-hover, #eef2ff)
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
      if (window.hljs) pre.querySelectorAll('code').forEach(el => window.hljs.highlightElement(el));

      const wrap = document.createElement('div'); wrap.className = 'clx-codewrap';
      pre.parentElement?.insertBefore(wrap, pre); wrap.appendChild(pre);

      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'clx-copy-btn';
      btn.setAttribute('aria-label', 'Copy code');
      btn.setAttribute('title', 'Copy code');
      btn.innerHTML = `<span class="clx-copy-icn">${COPY_SVG}</span><span class="clx-copy-txt">Copy code</span>`;
      btn.addEventListener('click', async () => {
        try {
          const codeEl = pre.querySelector('code');
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
      wrap.appendChild(btn);
    });
  }

  function makeArticle(role, text) {
    const a = document.createElement('article');
    a.setAttribute('data-cl-local', '1');
    a.setAttribute('data-role', role === 'user' ? 'user' : 'assistant');

    const html = mdToSafeHTML(text);
    const header = (role === 'assistant') ? `<div class="clx-role">GPT simplified</div>` : '';
    a.innerHTML = `
      <div class="clx-row">
        <div class="clx-card">
          ${header}
          <div class="clx-md">${html || '<em class="clx-empty">[empty]</em>'}</div>
        </div>
      </div>`;
    enhanceCodeBlocks(a);
    return a;
  }

  window.CLTheme = { ensureStyles, stringifyParts, mdToSafeHTML, makeArticle };
})();
