// Tanka bridge script, injected last into every page load of g.tanka.ai.
// Detects unread messages via two unambiguous signals — never favicon
// URL matching, which was prone to false positives and recalibration bugs.
//
//  1. window.Notification constructor invocations.
//     The site calls `new Notification(...)` for each incoming message;
//     Pake's event.js wraps that to forward to macOS. We wrap it once
//     more to increment a counter when the app is NOT focused.
//
//  2. document.title regex.
//     If the SPA ever prefixes the title with "(N) …" or "N - …" we
//     parse it. Unconfirmed for Tanka; if they don't use this convention
//     the regex simply never matches.
//
// Focus means "the user is reading Tanka", so we consume state on focus:
//   - notificationCount → 0 (counts things that arrived while away)
//   - titleWatermark    → current titleCount (the title value that was
//     on screen at focus time is treated as already-read; only further
//     increments past the watermark count as new unread)
//
// Without the watermark, a stale title like "(3) Tanka" would re-surface
// as unread the moment the user blurred again, even though they had just
// been actively looking at it.
//
// Diagnostic state on window.__tankaUnread.

(function tankaBridge() {
  if (window.__tankaBridgeLoaded) return;
  window.__tankaBridgeLoaded = true;

  const invoke = () => window.__TAURI__?.core?.invoke;

  const state = {
    notificationCount: 0,
    titleCount: 0,
    titleWatermark: 0,
    lastReported: -1,
  };
  window.__tankaUnread = state;

  const REPORT_DEBOUNCE_MS = 60;
  let reportTimer = null;
  let titleObserver = null;
  let currentTitleEl = null;

  function parseTitleCount(title) {
    if (!title) return 0;
    const m = title.match(/^\s*[(\[【](\d+)\+?[)\]】]/);
    if (m) return parseInt(m[1], 10);
    const n = title.match(/^\s*(\d+)\+?\s*[·\-:]/);
    if (n) return parseInt(n[1], 10);
    return 0;
  }

  function recomputeTitleCount() {
    const parsed = parseTitleCount(document.title);
    state.titleCount = parsed;
    if (isAppFocused()) {
      // While the user is looking at Tanka, every observed title value
      // is "already consumed" — pin the watermark to match. Without this
      // a title that dipped then returned to its prior value while
      // focused would leak a stale unread when the user later blurred.
      state.titleWatermark = parsed;
    } else if (parsed < state.titleWatermark) {
      // Backgrounded: a decreasing title means the user read some
      // messages through another surface (phone, other window). Lower
      // the watermark so a subsequent increment isn't masked.
      state.titleWatermark = parsed;
    }
  }

  function isAppFocused() {
    return (
      document.hasFocus() &&
      (document.visibilityState === undefined ||
        document.visibilityState === "visible")
    );
  }

  function computeUnread() {
    if (isAppFocused()) return 0;
    const titleUnread = Math.max(0, state.titleCount - state.titleWatermark);
    return Math.max(state.notificationCount, titleUnread);
  }

  function report(count) {
    const fn = invoke();
    if (!fn) return;
    if (count === state.lastReported) return;
    state.lastReported = count;
    fn("set_unread", { count }).catch((err) => {
      console.warn("[tanka] set_unread failed:", err);
    });
  }

  function scheduleReport() {
    if (reportTimer) return;
    reportTimer = setTimeout(() => {
      reportTimer = null;
      recomputeTitleCount();
      report(computeUnread());
    }, REPORT_DEBOUNCE_MS);
  }

  function consumeOnFocus() {
    // User is looking at Tanka. Everything currently reflected in the
    // counters has been "seen" for our purposes; don't resurrect it on
    // the next blur.
    state.notificationCount = 0;
    recomputeTitleCount();
    state.titleWatermark = state.titleCount;
    scheduleReport();
  }

  function wrapNotificationConstructor() {
    const original = window.Notification;
    if (typeof original !== "function") {
      // Pake's event.js should have installed a shim; if it's missing
      // the title-regex path still functions.
      return;
    }

    const wrapped = function (title, options) {
      if (!isAppFocused()) {
        state.notificationCount += 1;
        scheduleReport();
      }
      return new original(title, options);
    };

    for (const key of Object.getOwnPropertyNames(original)) {
      if (key === "length" || key === "name" || key === "prototype") continue;
      const desc = Object.getOwnPropertyDescriptor(original, key);
      if (desc) Object.defineProperty(wrapped, key, desc);
    }
    if (original.prototype) wrapped.prototype = original.prototype;

    window.Notification = wrapped;
  }

  function attachTitleObserver() {
    const titleEl = document.querySelector("head > title");
    if (!titleEl || titleEl === currentTitleEl) return;
    if (titleObserver) titleObserver.disconnect();
    currentTitleEl = titleEl;
    titleObserver = new MutationObserver(scheduleReport);
    titleObserver.observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    scheduleReport();
  }

  function observeTitle() {
    attachTitleObserver();
    // Some SPAs replace the whole <title> node rather than mutate its
    // text. Watch the <head> for childList changes and reattach our
    // observer whenever a new <title> appears.
    const head = document.head;
    if (!head) return;
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type !== "childList") continue;
        const replaced =
          Array.from(r.removedNodes).some((n) => n === currentTitleEl) ||
          Array.from(r.addedNodes).some(
            (n) => n.nodeType === Node.ELEMENT_NODE && n.tagName === "TITLE",
          );
        if (replaced) {
          attachTitleObserver();
          return;
        }
      }
    }).observe(head, { childList: true });
  }

  function init() {
    wrapNotificationConstructor();
    observeTitle();

    window.addEventListener("focus", consumeOnFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") consumeOnFocus();
      else scheduleReport();
    });

    // If the app launches already focused (Tauri typically does this),
    // treat the starting state as consumed too. Prevents an initial
    // stale-title badge that would appear the moment the user blurs.
    if (isAppFocused()) consumeOnFocus();
    else scheduleReport();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
