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
// Focus semantics:
//   - notificationCount → 0 (things that arrived while away; consumed).
//   - titleWatermark    → current titleCount (the title value shown at
//     focus time is treated as already-read; only further increments
//     past the watermark count as new unread).
//
// Without the watermark, a stale "(3) Tanka" title would re-surface as
// unread the moment the user blurred, even though they had just been
// actively looking at it.
//
// Title state MUST be synced synchronously in the MutationObserver
// callback. If it were deferred to the debounced report handler, a
// title change at T=0 that races with a blur at T=30ms would be
// watermarked under the WRONG focus state (the debounce fires at T=60
// after blur has already flipped isAppFocused() to false).
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

  function isAppFocused() {
    return (
      document.hasFocus() &&
      (document.visibilityState === undefined ||
        document.visibilityState === "visible")
    );
  }

  function syncTitleState() {
    // Called synchronously from whichever observer/event realized the
    // title might have changed. Must run before control returns to the
    // event loop so that a focus→blur transition doesn't land between
    // the mutation and our watermark update.
    const previous = state.titleCount;
    const parsed = parseTitleCount(document.title);
    state.titleCount = parsed;
    if (isAppFocused()) {
      // While focused, every observed title value is "already consumed".
      state.titleWatermark = parsed;
      return;
    }
    if (parsed < state.titleWatermark) {
      // Backgrounded + decreasing title = user read on another surface;
      // lower the watermark so future increments aren't masked.
      state.titleWatermark = parsed;
    }
    // When the site's own counter drops, the user has read some
    // messages through another surface (phone, other window). Subtract
    // the delta from notificationCount so the two signals stay in sync
    // — a simple `Math.min(notif, parsed)` is NOT enough, because
    // partial reads can leave parsed higher than notif (e.g. watermark
    // 3 + notif 5 + title 8 → title 6 after two reads should drop
    // notif to 3, but min(5, 6) leaves it at 5).
    //
    // Guarded on `previous > 0` so sites that never emit title-based
    // counts can't retroactively zero out legitimate notifications the
    // first time they happen to stamp a numeric prefix.
    if (previous > 0 && parsed < previous) {
      const delta = previous - parsed;
      state.notificationCount = Math.max(0, state.notificationCount - delta);
    }
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
      report(computeUnread());
    }, REPORT_DEBOUNCE_MS);
  }

  function onTitleMutation() {
    syncTitleState();
    scheduleReport();
  }

  function consumeOnFocus() {
    state.notificationCount = 0;
    syncTitleState(); // pins watermark to titleCount since we're focused
    scheduleReport();
  }

  function onBlur() {
    // Re-sync so a decreasing title observed at blur time gets
    // recorded correctly; this doesn't bump the watermark up (we're not
    // focused), but it does let us drop it if the site just cleared.
    syncTitleState();
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
    titleObserver = new MutationObserver(onTitleMutation);
    titleObserver.observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    // Sync once immediately; the new <title> may have a different value.
    onTitleMutation();
  }

  function observeTitle() {
    attachTitleObserver();
    // Some SPAs replace the whole <title> node rather than mutate its
    // text. Watch <head> childList and reattach when <title> swaps.
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
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") consumeOnFocus();
      else onBlur();
    });

    // If the app launches already focused (Tauri typically does this),
    // treat the starting state as consumed. Prevents a stale initial
    // title from appearing as unread the moment the user blurs.
    if (isAppFocused()) consumeOnFocus();
    else {
      syncTitleState();
      scheduleReport();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
