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
//     If the SPA prefixes the title with "(N) …" or "N - …" we parse it
//     as the server's view of unread. Tanka does this for persistent
//     unread (messages that stay unread until explicitly read), so the
//     title count reflects actual unread at all times — not just
//     "notifications while tab was hidden".
//
// Focus semantics:
//   - Focused → we never show a badge. The dock/tray are a backgrounded
//     signal; while the app is in front, the user doesn't need them.
//   - notificationCount is zeroed on focus. Notifications are popups for
//     "something arrived while you weren't looking" — once the user is
//     looking, that buffer is consumed.
//   - titleCount is NEVER consumed by focus. It reflects the site's
//     view of unread; the site will lower it when the user actually
//     reads messages (in-app or on another device), not when they
//     merely focus the window. A prior "title watermark" design
//     consumed the title on focus and hid persistent unread after
//     launch — that was wrong for Tanka.
//
// Cross-device reads:
//   If the site's title count DECREASES (user read on phone/web while
//   our window was backgrounded), we subtract the delta from
//   notificationCount so the two signals stay in sync. Guarded on
//   `previous > 0` so the first observation of a numeric prefix can't
//   retroactively zero legitimate notifications on sites that don't
//   actually use title-based unread.
//
// Diagnostic state on window.__tankaUnread.

(function tankaBridge() {
  // Only run in the top frame. If the SPA embeds iframes (OAuth popups,
  // third-party widgets) each frame gets its own copy of this script —
  // independent focus state, independent Notification counter, both
  // racing set_unread with different values. Fight pattern: dock badge
  // cycles between frames' reports.
  if (window.top !== window) return;

  if (window.__tankaBridgeLoaded) return;
  window.__tankaBridgeLoaded = true;

  const invoke = () => window.__TAURI__?.core?.invoke;

  const state = {
    notificationCount: 0,
    titleCount: 0,
    lastReported: -1,
    // Ring buffer of recent transitions, for field-debugging via the web
    // inspector — open devtools and read `window.__tankaUnread.log`.
    log: [],
  };
  window.__tankaUnread = state;

  function trace(event, extra) {
    // Deliberately record only numeric/status fields. `document.title`
    // and Notification titles are message previews — recording them
    // here would leak private chat content through a log that the user
    // might copy into a bug report. Callers must pre-parse any text
    // they want to log into numbers or booleans before passing `extra`.
    state.log.push({
      t: Date.now(),
      event,
      titleLen: document.title.length,
      notif: state.notificationCount,
      titleCount: state.titleCount,
      focused: isAppFocused(),
      ...extra,
    });
    if (state.log.length > 200) state.log.shift();
  }

  const REPORT_DEBOUNCE_MS = 60;
  // Title drops to 0 are held this long before being committed. Handles
  // sites that "blink" the title ("(3) Tanka" ↔ "Tanka") to grab
  // attention, and React/Helmet-style swaps that briefly leave <title>
  // empty during a remove/replace. If the title comes back to a non-zero
  // value within this window, the drop is cancelled.
  const DROP_CONFIRM_MS = 2000;
  let reportTimer = null;
  let pendingDropTimer = null;
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

  function commitTitleCount(parsed) {
    const previous = state.titleCount;
    state.titleCount = parsed;
    // When the site's own counter drops, the user read some messages
    // through another surface (phone, other window). Subtract the delta
    // from notificationCount so the two signals stay in sync — a simple
    // `Math.min(notif, parsed)` is NOT enough, because partial reads can
    // leave parsed higher than notif (e.g. notif 5 + title 8 → title 6
    // after two reads should drop notif to 3, but min(5, 6) leaves 5).
    //
    // Guarded on `previous > 0` so sites that never emit title-based
    // counts can't retroactively zero out legitimate notifications the
    // first time they happen to stamp a numeric prefix.
    if (previous > 0 && parsed < previous) {
      const delta = previous - parsed;
      state.notificationCount = Math.max(0, state.notificationCount - delta);
    }
  }

  function syncTitleState() {
    // Called synchronously from whichever observer/event realized the
    // title might have changed. Must run before control returns to the
    // event loop so a focus→blur transition doesn't race the mutation.
    const previous = state.titleCount;
    const parsed = parseTitleCount(document.title);
    trace("sync", { parsed });

    // If a drop-to-0 was pending and the title is back to non-zero, the
    // earlier zero was a transient (blink, mid-swap) — cancel the drop.
    if (pendingDropTimer && parsed > 0) {
      clearTimeout(pendingDropTimer);
      pendingDropTimer = null;
      trace("drop-cancelled", { parsed });
    }

    if (parsed === 0 && previous > 0) {
      // Possible blink / mid-mutation. Defer the drop; only commit if
      // the title stays at 0 past DROP_CONFIRM_MS.
      if (!pendingDropTimer) {
        trace("drop-scheduled", { from: previous });
        pendingDropTimer = setTimeout(() => {
          pendingDropTimer = null;
          const confirmed = parseTitleCount(document.title);
          if (confirmed === 0) {
            trace("drop-confirmed", { from: previous });
            commitTitleCount(0);
            scheduleReport();
          } else {
            trace("drop-reverted", { confirmed });
          }
        }, DROP_CONFIRM_MS);
      }
      // Leave state.titleCount at `previous` until the drop is confirmed.
      return;
    }

    commitTitleCount(parsed);
  }

  function computeUnread() {
    if (isAppFocused()) return 0;
    return Math.max(state.notificationCount, state.titleCount);
  }

  function report(count) {
    const fn = invoke();
    if (!fn) return;
    if (count === state.lastReported) return;
    trace("report", { count });
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
    // Focusing the app consumes the Notification buffer (popups the user
    // saw while away). We deliberately do NOT touch titleCount — the site
    // will decrement it when the user actually reads messages.
    trace("focus");
    state.notificationCount = 0;
    syncTitleState();
    scheduleReport();
  }

  function onBlur() {
    trace("blur");
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
        // Record only the length; the title itself is the message
        // preview and must not enter the diagnostic log.
        trace("notification", {
          titleArgLen: typeof title === "string" ? title.length : 0,
        });
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

    // Initial observation without consumption. If the page launches with
    // "(5) Tanka" (persistent unread from before), we want that to
    // surface as a badge as soon as the user blurs — not be silently
    // swallowed by a watermark set at init time.
    syncTitleState();
    scheduleReport();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
