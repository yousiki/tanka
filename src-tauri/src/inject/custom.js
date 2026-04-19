// Tanka bridge script, injected last into every page load of g.tanka.ai.
// Detects unread state from DOM signals and reports it to the Rust side
// so it can render a dock badge and swap the tray icon.

(function tankaBridge() {
  if (window.__tankaBridgeLoaded) return;
  window.__tankaBridgeLoaded = true;

  const invoke = () => window.__TAURI__?.core?.invoke;

  let lastReported = -1;
  let debounceTimer = null;

  const UNREAD_FAVICON_HINTS = ["unread", "notify", "badge", "dot", "red"];

  function parseTitleCount(title) {
    if (!title) return 0;
    const m = title.match(/^\s*[(\[【](\d+)\+?[)\]】]/);
    if (m) return parseInt(m[1], 10);
    const n = title.match(/^\s*(\d+)\+?\s*[·\-:]/);
    if (n) return parseInt(n[1], 10);
    return 0;
  }

  function faviconSuggestsUnread() {
    const links = document.querySelectorAll('link[rel*="icon"]');
    for (const link of links) {
      const href = (link.getAttribute("href") || "").toLowerCase();
      if (UNREAD_FAVICON_HINTS.some((hint) => href.includes(hint))) return true;
    }
    return false;
  }

  function computeUnread() {
    const fromTitle = parseTitleCount(document.title);
    if (fromTitle > 0) return fromTitle;
    return faviconSuggestsUnread() ? 1 : 0;
  }

  function report(count) {
    const fn = invoke();
    if (!fn) return;
    if (count === lastReported) return;
    lastReported = count;
    fn("set_unread", { count }).catch((err) => {
      console.warn("[tanka] set_unread failed:", err);
    });
  }

  function scheduleReport() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      report(computeUnread());
    }, 100);
  }

  function observeTitle() {
    const titleEl = document.querySelector("head > title");
    if (!titleEl) return;
    new MutationObserver(scheduleReport).observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  function observeFavicon() {
    const head = document.head;
    if (!head) return;
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "childList") {
          scheduleReport();
          return;
        }
        if (r.type === "attributes" && r.target.tagName === "LINK") {
          scheduleReport();
          return;
        }
      }
    }).observe(head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "rel"],
    });
  }

  function init() {
    observeTitle();
    observeFavicon();
    // initial snapshot after the SPA has a chance to hydrate
    setTimeout(scheduleReport, 1500);
    // and again when the tab comes back into focus
    window.addEventListener("focus", scheduleReport);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
