// ==UserScript==
// @name         Reddit Subreddit Blocker (New Reddit + Shreddit)
// @namespace    https://0mfg.wtf/
// @version      0.4.0
// @description  Hide posts from blocked subreddits on Reddit feeds. Adds per-post Block buttons, manager UI, import/export, and SPA/Shreddit support.
// @author       Cannicus
// @license      MIT
// @match        https://www.reddit.com/*
// @match        https://new.reddit.com/*
// @exclude      https://old.reddit.com/*
// @icon         https://www.redditstatic.com/desktop2x/img/favicon/favicon-32x32.png
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const INSTANCE_KEY = '__tmRedditSubredditBlocker_v040';
  if (window[INSTANCE_KEY]) return;
  window[INSTANCE_KEY] = true;

  // -------------------------
  // Constants / storage
  // -------------------------
  const APP = 'tm-rsb';
  const STORAGE_KEY = 'tm.reddit.blockedSubs.v2';
  const SETTINGS_KEY = 'tm.reddit.blocker.settings.v1';

  const DEFAULT_SETTINGS = Object.freeze({
    hideLoginNag: false,
    confirmBlock: true,
    showFab: true,
    animateUi: true,
    hideBlockedByCss: true,
    debug: false,
  });

  const CLS = Object.freeze({
    hidden: `${APP}-hidden`,
    inline: `${APP}-inline`,
    float: `${APP}-float`,
    fab: `${APP}-fab`,
    fabPop: `${APP}-fab-pop`,
    backdrop: `${APP}-backdrop`,
    modal: `${APP}-modal`,
    toastWrap: `${APP}-toast-wrap`,
    toast: `${APP}-toast`,
    hideLoginNag: `${APP}-hide-login-nag`,
  });

  const IDS = Object.freeze({
    style: `${APP}-style`,
    blockStyle: `${APP}-block-style`,
    fab: `${APP}-fab`,
    modal: `${APP}-modal-backdrop`,
  });

  const SUB_NAME_RE = /^[A-Za-z0-9_]{2,21}$/;

  const POST_SELECTOR = [
    'shreddit-post',
    'div[data-testid="post-container"]',
    'article[data-testid="post-container"]',
    'article[data-testid*="post"]',
    'article[id^="t3_"]',
    'div[id^="t3_"]',
    'div[data-fullname^="t3_"]',
  ].join(',');

  const SUB_LINK_SELECTOR = [
    'a[data-testid="subreddit-name"]',
    'a[data-testid="subreddit-name-prefixed"]',
    'a[data-click-id="subreddit"]',
    'a[href^="/r/"]:not([href*="/comments/"])',
    'a[href*="/r/"]:not([href*="/comments/"])',
    'a[href^="https://www.reddit.com/r/"]:not([href*="/comments/"])',
    'a[href^="https://new.reddit.com/r/"]:not([href*="/comments/"])',
  ].join(',');

  const SUB_ATTRS = [
    'subreddit-prefixed-name',
    'subreddit-name',
    'subreddit',
    'data-subreddit',
    'data-subreddit-name',
    'data-subreddit-prefixed-name',
    'data-community-name',
    'community-name',
  ];

  const URL_ATTRS = ['permalink', 'data-permalink', 'content-href', 'href'];
  const SUB_ATTR_SELECTOR = SUB_ATTRS.map((attr) => `[${attr}]`).join(',');
  const OBSERVED_ATTRS = Array.from(new Set([...SUB_ATTRS, ...URL_ATTRS]));

  const OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: OBSERVED_ATTRS,
  };

  const BASIC_OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
  };

  // -------------------------
  // Small helpers
  // -------------------------
  const isElement = (node) => node && node.nodeType === Node.ELEMENT_NODE;
  const isScannableNode = (node) =>
    node &&
    (node.nodeType === Node.ELEMENT_NODE ||
      node.nodeType === Node.DOCUMENT_NODE ||
      node.nodeType === Node.DOCUMENT_FRAGMENT_NODE);

  const byId = (id, root = document) => root.getElementById?.(id) || root.querySelector?.(`#${id}`) || null;

  const debugLog = (...args) => {
    if (settings.debug) console.log('[RedditBlocker]', ...args);
  };

  const safeJsonParse = (raw, fallback) => {
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return fallback;
    }
  };

  const uniqSorted = (items) => Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));

  const cssString = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const appendOrUpdateStyle = (id, css) => {
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement('style');
      style.id = id;
      (document.head || document.documentElement).appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
    return style;
  };

  // -------------------------
  // Subreddit parsing
  // -------------------------
  const normalizeSub = (input) => {
    let value = String(input || '').trim();
    if (!value) return '';

    value = value
      .replace(/^https?:\/\/(?:www\.|new\.|old\.)?reddit\.com\/r\//i, '')
      .replace(/^\/?r\//i, '')
      .split(/[\s,/?#]+/)[0]
      .trim();

    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep undecoded value and let validation reject it if needed.
    }

    return SUB_NAME_RE.test(value) ? value.toLowerCase() : '';
  };

  const parseSubFromText = (input) => {
    const value = String(input || '').trim();
    if (!value) return '';

    const prefixed = value.match(/(?:^|[\s/(])r\/([A-Za-z0-9_]{2,21})(?=$|[\s/).,?#])/i);
    if (prefixed?.[1]) return normalizeSub(prefixed[1]);

    return normalizeSub(value);
  };

  const parseSubFromHref = (href) => {
    const value = String(href || '');
    const match = value.match(/(?:^|\/|reddit\.com\/)r\/([^/?#]+)/i);
    return match?.[1] ? normalizeSub(match[1]) : '';
  };

  const parseImportInput = (input) => {
    const raw = String(input || '').trim();
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return uniqSorted(parsed.map(normalizeSub).filter(Boolean));
      if (Array.isArray(parsed?.subreddits)) return uniqSorted(parsed.subreddits.map(normalizeSub).filter(Boolean));
      if (Array.isArray(parsed?.blocked)) return uniqSorted(parsed.blocked.map(normalizeSub).filter(Boolean));
    } catch {
      // Fallback below.
    }

    return uniqSorted(raw.split(/[\s,]+/).map(normalizeSub).filter(Boolean));
  };

  const currentSubFromLocation = () => parseSubFromHref(window.location.pathname);

  // -------------------------
  // Settings / blocklist
  // -------------------------
  const loadSettings = () => {
    const raw = GM_getValue(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
    return { ...DEFAULT_SETTINGS, ...safeJsonParse(raw, {}) };
  };

  const saveSettings = (next) => GM_setValue(SETTINGS_KEY, JSON.stringify(next));

  const loadBlocked = () => {
    const raw = GM_getValue(STORAGE_KEY, '[]');
    const parsed = safeJsonParse(raw, []);
    const arr = Array.isArray(parsed) ? parsed : [];
    return new Set(arr.map(normalizeSub).filter(Boolean));
  };

  const saveBlocked = () => GM_setValue(STORAGE_KEY, JSON.stringify(uniqSorted(blocked)));

  let settings = loadSettings();
  let blocked = loadBlocked();

  // -------------------------
  // Styles
  // -------------------------
  const injectBaseStyles = () => {
    appendOrUpdateStyle(
      IDS.style,
      `
        .${CLS.hidden} { display: none !important; }

        .${CLS.inline} {
          all: unset !important;
          display: inline-flex !important;
          align-items: center !important;
          margin-left: 7px !important;
          padding: 1px 8px !important;
          border-radius: 999px !important;
          font: inherit !important;
          font-size: .78em !important;
          line-height: 1.7 !important;
          cursor: pointer !important;
          white-space: nowrap !important;
          color: var(--newRedditTheme-metaText, #5f6977) !important;
          border: 1px solid rgba(95, 105, 119, .28) !important;
          background: rgba(255,255,255,.84) !important;
        }
        .${CLS.inline}:hover {
          color: #1d5dff !important;
          border-color: rgba(29,93,255,.42) !important;
          background: rgba(29,93,255,.09) !important;
          text-decoration: none !important;
        }
        .${CLS.inline}::before { content: "· "; opacity: .65; }

        .${CLS.float} {
          position: absolute !important;
          top: 8px !important;
          right: 10px !important;
          z-index: 20 !important;
          padding: 4px 10px !important;
          border-radius: 999px !important;
          font-size: 12px !important;
          line-height: 1.4 !important;
          letter-spacing: .01em !important;
          cursor: pointer !important;
          user-select: none !important;
          background: rgba(255,255,255,.95) !important;
          border: 1px solid rgba(20,28,42,.14) !important;
          color: #1f2937 !important;
          box-shadow: 0 4px 12px rgba(0,0,0,.16) !important;
        }
        .${CLS.float}:hover {
          transform: translateY(-1px) !important;
          border-color: rgba(29,93,255,.42) !important;
          color: #1247ca !important;
        }

        .${CLS.fab} {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 99999;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          box-sizing: border-box !important;
          min-height: 38px !important;
          padding: 10px 14px !important;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.26);
          background: linear-gradient(140deg, #ff5f2a, #ff7b2c);
          color: #fff;
          box-shadow: 0 10px 20px rgba(0,0,0,.32);
          cursor: pointer;
          font-size: 12px !important;
          font-weight: 800 !important;
          line-height: 1.25 !important;
          letter-spacing: .02em;
          white-space: nowrap;
        }
        .${CLS.fab}:hover { filter: brightness(1.06); }
        .${CLS.fab}.${CLS.fabPop} { animation: ${APP}-pop .23s ease-out; }

        .${CLS.backdrop} {
          position: fixed;
          inset: 0;
          z-index: 100000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: radial-gradient(1400px 900px at 50% 120%, rgba(255,123,44,.14), transparent 55%), rgba(8, 11, 18, .58);
        }

        .${CLS.modal} {
          --rsb-bg: #f7f9fd;
          --rsb-card: #ffffff;
          --rsb-text: #111827;
          --rsb-muted: #5a6576;
          --rsb-border: #d6ddea;
          --rsb-accent: #1d5dff;
          --rsb-accent-2: #1348cf;
          --rsb-danger: #d13232;
          width: min(720px, 95vw);
          max-height: min(84vh, 840px);
          overflow: auto;
          color: var(--rsb-text);
          background: var(--rsb-card);
          border: 1px solid var(--rsb-border);
          border-radius: 18px;
          box-shadow: 0 16px 36px rgba(12, 19, 34, .24);
          padding: 16px;
          font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .${CLS.modal} * { box-sizing: border-box; }
        .${CLS.modal} h2 { margin: 0; font-size: 22px; line-height: 1.1; letter-spacing: -.01em; }
        .${CLS.modal} p { margin: 5px 0 0; color: var(--rsb-muted); font-size: 13px; }
        .${APP}-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
        .${APP}-panel { margin-top: 10px; padding: 12px; border: 1px solid var(--rsb-border); border-radius: 12px; background: var(--rsb-bg); }
        .${APP}-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .${APP}-switch-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(195px, 1fr)); gap: 8px; }
        .${APP}-switch { display: flex; align-items: center; gap: 8px; border: 1px solid var(--rsb-border); background: #fff; border-radius: 10px; padding: 7px 9px; font-size: 13px; }
        .${APP}-input { width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid var(--rsb-border); border-radius: 10px; background: #fff; color: var(--rsb-text); font: inherit; }
        .${APP}-input:focus { outline: 2px solid rgba(29,93,255,.2); border-color: rgba(29,93,255,.55); }
        .${APP}-btn {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          min-height: 36px !important;
          padding: 0 13px !important;
          border-radius: 10px;
          border: 1px solid var(--rsb-border);
          background: #f6f8fc;
          color: var(--rsb-text);
          cursor: pointer;
          font: inherit !important;
          font-size: 13px !important;
          font-weight: 800 !important;
          line-height: 1.1 !important;
          white-space: nowrap !important;
          appearance: none !important;
        }
        .${APP}-btn:hover { filter: brightness(1.02); }
        .${APP}-btn.primary { background: linear-gradient(180deg, var(--rsb-accent), var(--rsb-accent-2)); border-color: #2a73df; color: #fff; }
        .${APP}-btn.danger { background: linear-gradient(180deg, #f16060, var(--rsb-danger)); border-color: #d74646; color: #fff; }
        .${APP}-btn.slim { min-height: 32px !important; padding: 0 11px !important; font-size: 12px !important; }
        .${APP}-icon-btn { width: 34px; height: 34px; padding: 0 !important; font-size: 20px !important; }
        .${APP}-list { margin-top: 10px; border: 1px solid var(--rsb-border); border-radius: 12px; overflow: hidden; background: #fff; }
        .${APP}-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-bottom: 1px solid #e9eef6; }
        .${APP}-row:last-child { border-bottom: 0; }
        .${APP}-row-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
        .${APP}-pill { font-size: 12px; font-weight: 800; border-radius: 999px; padding: 3px 8px; color: #b84b1d; border: 1px solid #ffd5c2; background: linear-gradient(180deg, #fff4ee, #ffe9de); }
        .${APP}-row a { color: var(--rsb-accent); text-decoration: none; font-size: 12px; }
        .${APP}-row a:hover { text-decoration: underline; }
        .${APP}-empty { padding: 12px; font-size: 13px; color: var(--rsb-muted); }
        .${APP}-banner { margin-top: 8px; padding: 8px 10px; border-radius: 10px; border: 1px solid #f4d7a8; background: #fff7ea; color: #8a4b00; font-size: 12px; }

        .${CLS.toastWrap} {
          position: fixed;
          right: 16px;
          bottom: 74px;
          z-index: 100001;
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: none;
        }
        .${CLS.toast} {
          display: flex;
          align-items: center;
          gap: 10px;
          max-width: min(420px, calc(100vw - 32px));
          padding: 10px 12px;
          border-radius: 10px;
          color: #fff;
          background: rgba(20, 24, 34, .95);
          box-shadow: 0 10px 20px rgba(0,0,0,.25);
          pointer-events: auto;
          font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .${CLS.toast}.good { background: rgba(16, 107, 59, .96); }
        .${CLS.toast}.warn { background: rgba(166, 86, 20, .96); }
        .${CLS.toast}.pop { transform: translateY(8px); opacity: 0; animation: ${APP}-toast-in .18s ease-out forwards; }
        .${CLS.toast} button { all: unset; cursor: pointer; font-weight: 800; text-decoration: underline; white-space: nowrap; }

        body.${CLS.hideLoginNag} shreddit-logged-out-experience,
        body.${CLS.hideLoginNag} div[data-testid="login-wall"],
        body.${CLS.hideLoginNag} xpromo-app-selector,
        body.${CLS.hideLoginNag} .XPromoPopup {
          display: none !important;
        }
        body.${CLS.hideLoginNag} { overflow: auto !important; }

        @keyframes ${APP}-toast-in { to { transform: translateY(0); opacity: 1; } }
        @keyframes ${APP}-pop { 0% { transform: scale(1); } 45% { transform: scale(1.08); } 100% { transform: scale(1); } }

        @media (prefers-color-scheme: dark) {
          .${CLS.inline} { background: rgba(20, 24, 31, .78) !important; border-color: rgba(170,180,193,.24) !important; color: #a9b3c2 !important; }
          .${CLS.float} { background: rgba(22, 26, 34, .94) !important; border-color: rgba(170,180,193,.25) !important; color: #d8dee8 !important; }
          .${CLS.modal} {
            --rsb-bg: #151920;
            --rsb-card: #1a1f28;
            --rsb-text: #dce2eb;
            --rsb-muted: #a9b3c2;
            --rsb-border: #323a48;
            --rsb-accent: #6f99ff;
            --rsb-accent-2: #4f7def;
            box-shadow: 0 14px 30px rgba(0,0,0,.52);
          }
          .${APP}-switch,
          .${APP}-list,
          .${APP}-input,
          .${APP}-btn,
          .${APP}-row { background: #11161f; color: var(--rsb-text); }
          .${APP}-row { border-bottom-color: #283040; }
          .${APP}-pill { color: #fed7aa; border-color: #7c2d12; background: linear-gradient(180deg, #3b1e12, #2a160f); }
        }
      `
    );
  };

  const updateBlockCss = () => {
    const existing = document.getElementById(IDS.blockStyle);
    if (!settings.hideBlockedByCss || !blocked.size) {
      existing?.remove();
      return;
    }

    const selectors = [];
    for (const sub of blocked) {
      const name = cssString(sub);
      const prefixed = cssString(`r/${sub}`);
      selectors.push(
        `shreddit-post[subreddit-name="${name}"]`,
        `shreddit-post[subreddit-prefixed-name="${prefixed}"]`,
        `shreddit-post[subreddit-prefixed-name="${name}"]`,
        `shreddit-post[data-subreddit="${name}"]`,
        `article[data-subreddit="${name}"]`,
        `div[data-subreddit="${name}"][id^="t3_"]`,
        `div[data-subreddit-name="${name}"][id^="t3_"]`
      );
    }

    appendOrUpdateStyle(IDS.blockStyle, `${selectors.join(',\n')} { display: none !important; }`);
  };

  const updateBodyClasses = () => {
    if (!document.body) return;
    document.body.classList.toggle(CLS.hideLoginNag, !!settings.hideLoginNag);
  };

  // -------------------------
  // Feedback UI
  // -------------------------
  let toastWrap = null;

  const ensureToastWrap = () => {
    if (toastWrap?.isConnected) return toastWrap;
    if (!document.body) return null;

    toastWrap = document.createElement('div');
    toastWrap.className = CLS.toastWrap;
    document.body.appendChild(toastWrap);
    return toastWrap;
  };

  const toast = (message, tone = 'info', action = null) => {
    const wrap = ensureToastWrap();
    if (!wrap) return;

    const el = document.createElement('div');
    el.className = `${CLS.toast} ${tone === 'good' ? 'good' : tone === 'warn' ? 'warn' : ''} ${settings.animateUi ? 'pop' : ''}`.trim();

    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);

    if (action?.label && typeof action.onClick === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        action.onClick();
        el.remove();
      });
      el.appendChild(btn);
    }

    wrap.appendChild(el);

    window.setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-4px)';
      window.setTimeout(() => el.remove(), 220);
    }, settings.animateUi ? 2200 : 1500);
  };

  const bumpFab = () => {
    const fab = document.getElementById(IDS.fab);
    if (!fab || !settings.animateUi) return;

    fab.classList.remove(CLS.fabPop);
    void fab.offsetWidth;
    fab.classList.add(CLS.fabPop);
  };

  // -------------------------
  // Subreddit extraction
  // -------------------------
  const subCache = new WeakMap();

  const findFirstDeep = (root, selector) => {
    if (!root || !selector) return null;

    const queue = [root];
    const seen = new WeakSet();

    while (queue.length) {
      const node = queue.shift();
      if (!node || seen.has(node)) continue;
      seen.add(node);

      if (isElement(node) && node.matches?.(selector)) return node;

      const hit = node.querySelector?.(selector);
      if (hit) return hit;

      if (node.shadowRoot) queue.push(node.shadowRoot);

      const hosts = node.querySelectorAll?.('*') || [];
      for (const host of hosts) {
        if (host.shadowRoot) queue.push(host.shadowRoot);
      }
    }

    return null;
  };

  const collectPostsInRoot = (root, out) => {
    if (!root?.querySelectorAll) return;
    if (root.matches?.(POST_SELECTOR)) out.add(root);
    root.querySelectorAll(POST_SELECTOR).forEach((post) => out.add(post));
  };

  const getSubFromAttributes = (el) => {
    if (!el?.getAttribute) return '';

    for (const attr of SUB_ATTRS) {
      const raw = el.getAttribute(attr);
      const parsed = parseSubFromText(raw);
      if (parsed) return parsed;
    }

    return '';
  };

  const getSubFromKnownPlaces = (postEl) => {
    const directCandidates = [
      postEl,
      postEl.querySelector?.('shreddit-post'),
      postEl.closest?.('shreddit-post'),
    ].filter(Boolean);

    for (const candidate of directCandidates) {
      const sub = getSubFromAttributes(candidate);
      if (sub) return { normalized: sub, anchor: findFirstDeep(postEl, SUB_LINK_SELECTOR) };
    }

    const attrNode = findFirstDeep(postEl, SUB_ATTR_SELECTOR);
    if (attrNode) {
      const sub = getSubFromAttributes(attrNode);
      if (sub) return { normalized: sub, anchor: findFirstDeep(postEl, SUB_LINK_SELECTOR) };
    }

    const anchor = findFirstDeep(postEl, SUB_LINK_SELECTOR);
    if (anchor) {
      const sub = parseSubFromHref(anchor.getAttribute('href') || '') || parseSubFromText(anchor.textContent || '');
      if (sub) return { normalized: sub, anchor };
    }

    const commentLink = findFirstDeep(postEl, 'a[href*="/comments/"][href*="/r/"]');
    if (commentLink) {
      const sub = parseSubFromHref(commentLink.getAttribute('href') || '');
      if (sub) return { normalized: sub, anchor: null };
    }

    for (const candidate of directCandidates) {
      for (const attr of URL_ATTRS) {
        const sub = parseSubFromHref(candidate.getAttribute?.(attr));
        if (sub) return { normalized: sub, anchor: anchor || null };
      }
    }

    return null;
  };

  const extractSubFromPost = (postEl) => {
    const cached = subCache.get(postEl);
    if (cached?.normalized && (!cached.anchor || cached.anchor.isConnected)) return cached;

    const found = getSubFromKnownPlaces(postEl);
    if (!found?.normalized) return null;

    const info = {
      name: found.normalized,
      normalized: found.normalized,
      anchor: found.anchor || null,
    };

    subCache.set(postEl, info);
    return info;
  };

  // -------------------------
  // Blocklist operations
  // -------------------------
  const updateFab = () => {
    const fab = document.getElementById(IDS.fab);
    if (!fab) return;

    fab.textContent = `Blocked: ${blocked.size}`;
    fab.title = blocked.size
      ? `Hiding ${blocked.size} subreddit${blocked.size === 1 ? '' : 's'}`
      : 'No blocked subreddits';
  };

  const afterBlocklistChange = () => {
    saveBlocked();
    updateFab();
    updateBlockCss();
    bumpFab();
    scheduleFullRescan(0);
  };

  const addSub = (subName, options = {}) => {
    const { silent = false, deferSave = false, deferRefresh = false } = options;
    const sub = normalizeSub(subName);
    if (!sub) return false;

    const existed = blocked.has(sub);
    blocked.add(sub);

    if (!deferSave && !deferRefresh) afterBlocklistChange();
    else if (!deferSave) saveBlocked();

    if (!silent) toast(existed ? `r/${sub} is already blocked` : `Added r/${sub}`, existed ? 'warn' : 'good');
    return !existed;
  };

  const blockSub = (subName) => {
    const sub = normalizeSub(subName);
    if (!sub) return false;

    if (blocked.has(sub)) {
      toast(`r/${sub} is already blocked`, 'warn');
      return false;
    }

    if (settings.confirmBlock && !window.confirm(`Block r/${sub} on your feed?`)) return false;

    blocked.add(sub);
    afterBlocklistChange();
    debugLog('blocked', sub);

    toast(`Blocked r/${sub}`, 'good', {
      label: 'Undo',
      onClick: () => unblockSub(sub, { silent: true }),
    });

    return true;
  };

  const unblockSub = (subName, options = {}) => {
    const { silent = false, deferSave = false, deferRefresh = false } = options;
    const sub = normalizeSub(subName);
    if (!sub || !blocked.has(sub)) return false;

    blocked.delete(sub);

    if (!deferSave && !deferRefresh) afterBlocklistChange();
    else if (!deferSave) saveBlocked();

    if (!silent) toast(`Unblocked r/${sub}`);
    return true;
  };

  // -------------------------
  // Per-post actions
  // -------------------------
  const makeBlockButton = (className, info, label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.dataset.tmRsbSub = info.normalized;
    btn.textContent = label;
    btn.title = `Hide posts from r/${info.normalized}`;
    btn.setAttribute('aria-label', `Block r/${info.normalized}`);

    btn.addEventListener(
      'click',
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation?.();
        blockSub(info.normalized);
      },
      true
    );

    return btn;
  };

  const ensureInlineButton = (postEl, info) => {
    let anchor = info.anchor;
    if (!anchor || !anchor.isConnected) {
      anchor = findFirstDeep(postEl, SUB_LINK_SELECTOR);
      info.anchor = anchor;
      subCache.set(postEl, info);
    }

    if (!anchor?.parentElement) return false;

    const next = anchor.nextElementSibling;
    if (next?.classList?.contains(CLS.inline)) {
      next.dataset.tmRsbSub = info.normalized;
      next.title = `Hide posts from r/${info.normalized}`;
      return true;
    }

    const existing = Array.from(anchor.parentElement.children).find(
      (child) => child.classList?.contains(CLS.inline) && child.dataset.tmRsbSub === info.normalized
    );
    if (existing) return true;

    anchor.insertAdjacentElement('afterend', makeBlockButton(CLS.inline, info, 'Block'));
    return true;
  };

  const ensureFloatingButton = (postEl, info) => {
    const existing = postEl.querySelector?.(`.${CLS.float}`);
    if (existing) {
      existing.dataset.tmRsbSub = info.normalized;
      existing.textContent = `Block r/${info.normalized}`;
      existing.title = `Hide posts from r/${info.normalized}`;
      return;
    }

    const computed = getComputedStyle(postEl);
    if (computed.position === 'static') postEl.style.position = 'relative';

    postEl.appendChild(makeBlockButton(CLS.float, info, `Block r/${info.normalized}`));
  };

  const processPost = (postEl) => {
    if (!isElement(postEl)) return;

    const info = extractSubFromPost(postEl);
    if (!info?.normalized) return;

    postEl.dataset.tmRsbSub = info.normalized;

    const shouldHide = blocked.has(info.normalized);
    postEl.classList.toggle(CLS.hidden, shouldHide);
    postEl.toggleAttribute('aria-hidden', shouldHide);

    if (shouldHide) return;

    const inlineOk = ensureInlineButton(postEl, info);
    if (!inlineOk) ensureFloatingButton(postEl, info);
  };

  // -------------------------
  // Observation / scanning
  // -------------------------
  const queue = new Set();
  const observedRoots = new WeakSet();
  const observedRootList = [];

  let queueScheduled = false;
  let fullRescanTimer = 0;
  let mutationObserver = null;

  const pruneObservedRoots = () => {
    for (let i = observedRootList.length - 1; i >= 0; i -= 1) {
      const root = observedRootList[i];
      const host = root?.host;
      if (host && !host.isConnected) observedRootList.splice(i, 1);
    }
  };

  const flushQueue = () => {
    if (!queue.size) return;

    const posts = new Set();

    for (const node of queue) {
      if (!isScannableNode(node)) continue;

      collectPostsInRoot(node, posts);
      if (node.shadowRoot) collectPostsInRoot(node.shadowRoot, posts);

      if (isElement(node)) {
        const parentPost = node.closest?.(POST_SELECTOR);
        if (parentPost) posts.add(parentPost);
      }
    }

    queue.clear();
    posts.forEach(processPost);
  };

  const scheduleFlush = () => {
    if (queueScheduled) return;
    queueScheduled = true;

    const run = () => {
      queueScheduled = false;
      flushQueue();
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 120 });
    } else {
      window.requestAnimationFrame(run);
    }
  };

  const enqueue = (node) => {
    if (!isScannableNode(node)) return;
    queue.add(node);

    if (isElement(node)) {
      const parentPost = node.closest?.(POST_SELECTOR);
      if (parentPost) queue.add(parentPost);
    }

    scheduleFlush();
  };

  const observeRoot = (root) => {
    if (!root || observedRoots.has(root) || !mutationObserver) return;

    observedRoots.add(root);
    observedRootList.push(root);

    try {
      mutationObserver.observe(root, OBSERVER_OPTIONS);
    } catch {
      mutationObserver.observe(root, BASIC_OBSERVER_OPTIONS);
    }

    enqueue(root);
    debugLog('observing root', root.host?.tagName || root.nodeName);
  };

  const discoverShadowRootsFromNode = (node) => {
    if (!node) return;

    if (node.shadowRoot) observeRoot(node.shadowRoot);
    if (!node.querySelectorAll) return;

    node.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) observeRoot(el.shadowRoot);
    });
  };

  const rescanAll = () => {
    pruneObservedRoots();

    const posts = new Set();
    collectPostsInRoot(document, posts);

    observedRootList.forEach((root) => {
      const host = root?.host;
      if (host && !host.isConnected) return;
      collectPostsInRoot(root, posts);
    });

    posts.forEach(processPost);

    debugLog('rescan', {
      postCount: posts.size,
      blockedCount: blocked.size,
      shadowRoots: observedRootList.length,
    });
  };

  const scheduleFullRescan = (delay = 120) => {
    clearTimeout(fullRescanTimer);
    fullRescanTimer = window.setTimeout(rescanAll, delay);
  };

  const handleMutations = (mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (!isScannableNode(node)) return;
          discoverShadowRootsFromNode(node);
          enqueue(node);
        });

        if (isElement(mutation.target)) enqueue(mutation.target);
        continue;
      }

      if (mutation.type === 'attributes') {
        const post = mutation.target.closest?.(POST_SELECTOR);
        if (post) subCache.delete(post);
        enqueue(post || mutation.target);
      }
    }
  };

  // -------------------------
  // Manager UI
  // -------------------------
  const createFab = () => {
    if (!document.body) return;

    const existing = document.getElementById(IDS.fab);
    if (!settings.showFab) {
      existing?.remove();
      return;
    }

    if (existing) {
      updateFab();
      return;
    }

    const fab = document.createElement('button');
    fab.id = IDS.fab;
    fab.className = CLS.fab;
    fab.type = 'button';
    fab.addEventListener('click', openManager);
    document.body.appendChild(fab);
    updateFab();
  };

  const writeClipboard = async (text) => {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return true;
    }

    await navigator.clipboard.writeText(text);
    return true;
  };

  const openManager = () => {
    document.getElementById(IDS.modal)?.remove();

    const backdrop = document.createElement('div');
    backdrop.id = IDS.modal;
    backdrop.className = CLS.backdrop;

    const modal = document.createElement('div');
    modal.className = CLS.modal;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', `${APP}-title`);

    modal.innerHTML = `
      <div class="${APP}-head">
        <div>
          <h2 id="${APP}-title">Subreddit Block Manager</h2>
          <p id="${APP}-subtitle"></p>
        </div>
        <button id="${APP}-close-x" class="${APP}-btn ${APP}-icon-btn" type="button" aria-label="Close manager">×</button>
      </div>

      <div class="${APP}-panel">
        <div class="${APP}-actions">
          <input id="${APP}-add-input" class="${APP}-input" style="flex: 1 1 260px;" placeholder="Add subreddit: AskReddit or r/AskReddit" />
          <button id="${APP}-add-btn" class="${APP}-btn primary" type="button">Add</button>
          <button id="${APP}-export-btn" class="${APP}-btn" type="button">Export</button>
          <button id="${APP}-import-btn" class="${APP}-btn" type="button">Import</button>
          <button id="${APP}-clear-btn" class="${APP}-btn danger" type="button">Clear all</button>
        </div>
      </div>

      <div class="${APP}-panel">
        <div class="${APP}-switch-grid">
          <label class="${APP}-switch"><input id="${APP}-hide-nag" type="checkbox" /> Hide Reddit login nags</label>
          <label class="${APP}-switch"><input id="${APP}-confirm-block" type="checkbox" /> Confirm before blocking</label>
          <label class="${APP}-switch"><input id="${APP}-show-fab" type="checkbox" /> Show counter button</label>
          <label class="${APP}-switch"><input id="${APP}-animate-ui" type="checkbox" /> Animate feedback</label>
          <label class="${APP}-switch"><input id="${APP}-css-hide" type="checkbox" /> Fast CSS hiding</label>
          <label class="${APP}-switch"><input id="${APP}-debug" type="checkbox" /> Debug logging</label>
        </div>
        <div id="${APP}-debug-banner" class="${APP}-banner" style="display:none;">Debug is ON. Open DevTools and filter console logs by <code>[RedditBlocker]</code>.</div>
      </div>

      <div class="${APP}-panel">
        <div class="${APP}-actions">
          <input id="${APP}-filter" class="${APP}-input" placeholder="Filter blocked list..." />
        </div>
        <div id="${APP}-list" class="${APP}-list"></div>
      </div>

      <div class="${APP}-actions" style="justify-content:flex-end; margin-top:10px;">
        <button id="${APP}-close-btn" class="${APP}-btn" type="button">Close</button>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const q = (selector) => modal.querySelector(selector);
    const subtitle = q(`#${APP}-subtitle`);
    const addInput = q(`#${APP}-add-input`);
    const filterInput = q(`#${APP}-filter`);
    const listEl = q(`#${APP}-list`);
    const debugBanner = q(`#${APP}-debug-banner`);

    q(`#${APP}-hide-nag`).checked = !!settings.hideLoginNag;
    q(`#${APP}-confirm-block`).checked = !!settings.confirmBlock;
    q(`#${APP}-show-fab`).checked = !!settings.showFab;
    q(`#${APP}-animate-ui`).checked = !!settings.animateUi;
    q(`#${APP}-css-hide`).checked = !!settings.hideBlockedByCss;
    q(`#${APP}-debug`).checked = !!settings.debug;

    const close = () => {
      document.removeEventListener('keydown', onEsc, true);
      backdrop.remove();
    };

    const onEsc = (event) => {
      if (event.key === 'Escape') close();
    };

    const updateDebugBanner = () => {
      debugBanner.style.display = settings.debug ? 'block' : 'none';
    };

    const renderList = () => {
      subtitle.textContent = `${blocked.size} blocked subreddit${blocked.size === 1 ? '' : 's'}`;

      const filter = normalizeSub(filterInput.value || '') || String(filterInput.value || '').trim().toLowerCase();
      const arr = uniqSorted(blocked).filter((sub) => !filter || sub.includes(filter));

      listEl.textContent = '';

      if (!arr.length) {
        const empty = document.createElement('div');
        empty.className = `${APP}-empty`;
        empty.textContent = blocked.size ? 'No matches.' : 'No subreddits blocked yet.';
        listEl.appendChild(empty);
        return;
      }

      const frag = document.createDocumentFragment();

      for (const sub of arr) {
        const row = document.createElement('div');
        row.className = `${APP}-row`;

        const left = document.createElement('div');
        left.className = `${APP}-row-left`;

        const pill = document.createElement('span');
        pill.className = `${APP}-pill`;
        pill.textContent = `r/${sub}`;

        const link = document.createElement('a');
        link.href = `/r/${sub}/`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Open';

        left.append(pill, link);

        const unblockBtn = document.createElement('button');
        unblockBtn.type = 'button';
        unblockBtn.className = `${APP}-btn danger slim`;
        unblockBtn.dataset.unblock = sub;
        unblockBtn.textContent = 'Unblock';

        row.append(left, unblockBtn);
        frag.appendChild(row);
      }

      listEl.appendChild(frag);
    };

    const addFromInput = () => {
      const sub = normalizeSub(addInput.value);
      if (!sub) {
        toast('That does not look like a subreddit name.', 'warn');
        return;
      }

      addSub(sub);
      addInput.value = '';
      renderList();
    };

    const bindToggle = (id, key, onChange) => {
      q(`#${APP}-${id}`).addEventListener('change', (event) => {
        settings[key] = !!event.target.checked;
        saveSettings(settings);
        onChange?.();
      });
    };

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });

    document.addEventListener('keydown', onEsc, true);

    q(`#${APP}-close-x`).addEventListener('click', close);
    q(`#${APP}-close-btn`).addEventListener('click', close);
    q(`#${APP}-add-btn`).addEventListener('click', addFromInput);
    addInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') addFromInput();
    });
    filterInput.addEventListener('input', renderList);

    listEl.addEventListener('click', (event) => {
      const btn = event.target.closest?.('button[data-unblock]');
      if (!btn) return;

      if (unblockSub(btn.dataset.unblock)) renderList();
    });

    q(`#${APP}-export-btn`).addEventListener('click', async () => {
      const text = JSON.stringify(uniqSorted(blocked), null, 2);
      try {
        await writeClipboard(text);
        toast('Blocklist copied to clipboard.', 'good');
      } catch {
        window.prompt('Copy your blocklist JSON:', text);
      }
    });

    q(`#${APP}-import-btn`).addEventListener('click', () => {
      const input = window.prompt('Paste a JSON array, {"subreddits": [...]}, or comma/space-separated names:');
      if (!input) return;

      const subs = parseImportInput(input);
      if (!subs.length) {
        toast('No valid subreddits found.', 'warn');
        return;
      }

      let added = 0;
      for (const sub of subs) {
        if (!blocked.has(sub)) {
          blocked.add(sub);
          added += 1;
        }
      }

      afterBlocklistChange();
      renderList();
      toast(`Imported ${added} new subreddit${added === 1 ? '' : 's'}.`, added ? 'good' : 'warn');
    });

    q(`#${APP}-clear-btn`).addEventListener('click', () => {
      if (!blocked.size) return;
      if (!window.confirm('Clear all blocked subreddits?')) return;

      blocked = new Set();
      afterBlocklistChange();
      renderList();
      toast('Blocklist cleared.', 'warn');
    });

    bindToggle('hide-nag', 'hideLoginNag', updateBodyClasses);
    bindToggle('confirm-block', 'confirmBlock');
    bindToggle('show-fab', 'showFab', createFab);
    bindToggle('animate-ui', 'animateUi');
    bindToggle('css-hide', 'hideBlockedByCss', () => {
      updateBlockCss();
      scheduleFullRescan(0);
    });
    bindToggle('debug', 'debug', () => {
      updateDebugBanner();
      debugLog('debug logging enabled');
    });

    updateDebugBanner();
    renderList();
    addInput.focus();
  };

  // -------------------------
  // Menu commands / route hooks
  // -------------------------
  const initMenuCommands = () => {
    if (typeof GM_registerMenuCommand !== 'function') return;

    GM_registerMenuCommand('Open Blocked Subs Manager', openManager);

    GM_registerMenuCommand('Block Current Subreddit', () => {
      const sub = currentSubFromLocation();
      if (!sub) {
        toast('Not currently on a subreddit page.', 'warn');
        return;
      }
      blockSub(sub);
    });

    GM_registerMenuCommand('Export Blocklist', async () => {
      const text = JSON.stringify(uniqSorted(blocked), null, 2);
      try {
        await writeClipboard(text);
        toast('Blocklist copied to clipboard.', 'good');
      } catch {
        window.prompt('Copy your blocklist JSON:', text);
      }
    });

    GM_registerMenuCommand('Force Rescan Now', () => {
      scheduleFullRescan(0);
      toast('Feed rescan queued.');
    });

    GM_registerMenuCommand('Toggle Login Nag Hiding', () => {
      settings.hideLoginNag = !settings.hideLoginNag;
      saveSettings(settings);
      updateBodyClasses();
      toast(`Login nag hiding ${settings.hideLoginNag ? 'enabled' : 'disabled'}.`);
    });

    GM_registerMenuCommand('Toggle Debug Logging', () => {
      settings.debug = !settings.debug;
      saveSettings(settings);
      toast(`Debug logging ${settings.debug ? 'enabled' : 'disabled'}.`);
      debugLog('debug toggled via menu');
    });
  };

  const initRouteHooks = () => {
    const routeKey = '__tmRedditSubredditBlocker_routeHooked';
    if (window[routeKey]) return;
    window[routeKey] = true;

    const emitRoute = () => window.dispatchEvent(new CustomEvent(`${APP}:routechange`));

    for (const key of ['pushState', 'replaceState']) {
      const original = history[key];
      if (typeof original !== 'function') continue;

      history[key] = function wrappedHistory(...args) {
        const result = original.apply(this, args);
        emitRoute();
        return result;
      };
    }

    window.addEventListener('popstate', emitRoute, { passive: true });
    window.addEventListener('hashchange', emitRoute, { passive: true });
    window.addEventListener(`${APP}:routechange`, () => scheduleFullRescan(150), { passive: true });
  };

  // -------------------------
  // Init
  // -------------------------
  const init = () => {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', init, { once: true });
      return;
    }

    injectBaseStyles();
    updateBodyClasses();
    updateBlockCss();
    createFab();
    initMenuCommands();
    initRouteHooks();

    mutationObserver = new MutationObserver(handleMutations);
    mutationObserver.observe(document.body, OBSERVER_OPTIONS);
    discoverShadowRootsFromNode(document.body);

    rescanAll();

    window.setInterval(() => {
      if (document.visibilityState === 'visible') scheduleFullRescan(0);
    }, 45000);

    debugLog('init complete', {
      blocked: blocked.size,
      settings,
      shadowRoots: observedRootList.length,
    });
  };

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  } catch (err) {
    console.error('[RedditBlocker] fatal init error', err);
  }
})();
