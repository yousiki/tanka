// Tanka bridge script, injected last into every page load of g.tanka.ai.
// Detects unread messages via TWO unambiguous signals — never favicon
// string matching, which was prone to false positives and recalibration
// bugs.
//
//  1. window.Notification constructor invocations.
//     The site calls `new Notification(...)` for each incoming message;
//     Pake's event.js already wraps that to forward to macOS
//     UserNotifications. We wrap it again to count the calls.
//
//  2. document.title regex.
//     If the SPA ever prefixes the title with "(N) …" or "N - …" we
//     parse it. Tanka's title convention isn't confirmed, so the regex
//     simply won't match if the site doesn't use one.
//
// Clear rule: focusing the Tanka window counts as "user is reading",
// so the reported count goes to 0 until a new notification arrives.
// Same semantic as macOS Mail or the system notification center.
//
// Diagnostic state on window.__tankaUnread.

(function tankaBridge() {
  if (window.__tankaBridgeLoaded) return;
  window.__tankaBridgeLoaded = true;

  const invoke = () => window.__TAURI__?.core?.invoke;

  const state = {
    notificationCount: 0,
    titleCount: 0,
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
    state.titleCount = parseTitleCount(document.title);
  }

  function isAppFocused() {
    return (
      document.hasFocus() &&
      (document.visibilityState === undefined ||
        document.visibilityState === "visible")
    );
  }

  function computeUnread() {
    // Focus means the user is reading Tanka, so both signals should
    // be treated as 0. Without this short-circuit, a title-derived
    // count (the site setting "(3) Tanka" as its title) would survive
    // focus, since clearCount() only zeros notificationCount.
    if (isAppFocused()) return 0;
    return Math.max(state.notificationCount, state.titleCount);
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

  function clearCount() {
    state.notificationCount = 0;
    scheduleReport();
  }

  function wrapNotificationConstructor() {
    const original = window.Notification;
    if (typeof original !== "function") {
      // Pake's event.js should already have installed a shim; if it's
      // missing we do nothing. The title-regex path still functions.
      return;
    }

    const wrapped = function (title, options) {
      // If the window is focused the user is already looking at Tanka;
      // an incoming Notification doesn't represent an "unread" from
      // their perspective, so we skip the counter bump. The macOS alert
      // still fires via Pake's original wrapper — that's independent.
      if (!isAppFocused()) {
        state.notificationCount += 1;
        scheduleReport();
      }
      return new original(title, options);
    };

    // Preserve the static members Pake set up (permission getter/setter,
    // requestPermission, any class-level props). Copying descriptors
    // rather than calling Object.assign keeps getters live.
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

    // Focusing the window = user is (about to be) reading; clear state.
    window.addEventListener("focus", clearCount);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") clearCount();
      else scheduleReport();
    });

    // Initial safe report — 0 until we actually see a notification.
    scheduleReport();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
