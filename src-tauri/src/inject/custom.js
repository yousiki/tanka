// Tanka bridge script, injected last into every page load of g.tanka.ai.
// Detects unread state from DOM signals and reports it to the Rust side,
// which renders a dock badge and swaps the tray icon.
//
// Detection rules:
//
//  1. document.title — regex for "(N) …" / "N · …" style unread prefixes.
//     If the site doesn't use this convention the regex simply won't match.
//
//  2. favicon URL — observed for changes against a calibrated baseline.
//     The baseline is captured ONLY when two conditions hold for 3 seconds
//     continuously: the app is focused, and the favicon hasn't changed.
//     That means we don't calibrate during the SPA's hydration churn, and
//     we don't calibrate while the app is in the background (where an
//     unread-variant favicon could be mistaken for the clean state).
//     Before calibration, favicon-based detection returns 0 — we never
//     pretend certainty we don't have.
//
// Diagnostics live on `window.__tankaUnread`; attach devtools in a debug
// build to inspect.

(function tankaBridge() {
  if (window.__tankaBridgeLoaded) return;
  window.__tankaBridgeLoaded = true;

  const invoke = () => window.__TAURI__?.core?.invoke;

  const state = {
    lastReported: -1,
    baselineFavicon: null,
    baselineCapturedAt: 0,
    currentFavicon: null,
    lastTitle: "",
    lastCalibrationReason: null,
  };
  window.__tankaUnread = state;

  const STABILITY_MS = 3000;
  const REPORT_DEBOUNCE_MS = 100;

  let reportTimer = null;
  let stabilityTimer = null;

  function currentFaviconHref() {
    const link =
      document.querySelector('link[rel="icon"]') ||
      document.querySelector('link[rel="shortcut icon"]') ||
      document.querySelector('link[rel*="icon"]');
    return link ? link.getAttribute("href") || "" : "";
  }

  function isAppFocused() {
    return (
      document.hasFocus() &&
      (document.visibilityState === undefined ||
        document.visibilityState === "visible")
    );
  }

  function parseTitleCount(title) {
    if (!title) return 0;
    // "(3) Tanka", "[12] Tanka", "【3】Tanka"
    const m = title.match(/^\s*[(\[【](\d+)\+?[)\]】]/);
    if (m) return parseInt(m[1], 10);
    // "3 · Tanka", "12 - Tanka", "5: Tanka"
    const n = title.match(/^\s*(\d+)\+?\s*[·\-:]/);
    if (n) return parseInt(n[1], 10);
    return 0;
  }

  function computeUnread() {
    state.currentFavicon = currentFaviconHref();
    state.lastTitle = document.title;

    const fromTitle = parseTitleCount(state.lastTitle);
    if (fromTitle > 0) return fromTitle;

    // Without a calibrated baseline, every non-empty favicon would look
    // "unknown" — default to 0 rather than guess. System notifications
    // still fire independently; a missing dock badge is safer than a
    // false one.
    if (state.baselineFavicon === null) return 0;

    const current = state.currentFavicon;
    if (!current || current === state.baselineFavicon) return 0;
    return 1;
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

  function resetStabilityTimer(reason) {
    if (stabilityTimer) clearTimeout(stabilityTimer);
    if (!isAppFocused()) return;
    stabilityTimer = setTimeout(() => {
      stabilityTimer = null;
      // The app has been focused AND the favicon hasn't moved for
      // STABILITY_MS. Treat whatever we see now as "the clean state".
      // If the user opened the app already-focused with unread messages
      // and just sat there doing nothing, we'd miscalibrate — but that
      // case self-corrects the moment they read a message: the site
      // updates the favicon, the stability timer resets, and the next
      // stable window captures the clean variant.
      state.baselineFavicon = currentFaviconHref();
      state.baselineCapturedAt = Date.now();
      state.lastCalibrationReason = reason;
      scheduleReport();
    }, STABILITY_MS);
  }

  function onFaviconOrTitleChange(reason) {
    resetStabilityTimer(reason);
    scheduleReport();
  }

  function observeTitle() {
    const titleEl = document.querySelector("head > title");
    if (!titleEl) return;
    new MutationObserver(() => onFaviconOrTitleChange("title")).observe(
      titleEl,
      { childList: true, characterData: true, subtree: true },
    );
  }

  function observeFavicon() {
    const head = document.head;
    if (!head) return;
    new MutationObserver((records) => {
      for (const r of records) {
        if (
          r.type === "childList" ||
          (r.type === "attributes" && r.target.tagName === "LINK")
        ) {
          onFaviconOrTitleChange("favicon");
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

  function onFocus() {
    resetStabilityTimer("focus");
    scheduleReport();
  }

  function onBlur() {
    if (stabilityTimer) clearTimeout(stabilityTimer);
    stabilityTimer = null;
    scheduleReport();
  }

  function init() {
    observeTitle();
    observeFavicon();
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") onFocus();
      else onBlur();
    });

    // If the app launches already focused, start the stability clock. If
    // it isn't focused, we stay uncalibrated (and report 0) until the
    // user focuses the window.
    if (isAppFocused()) resetStabilityTimer("initial");

    scheduleReport();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
