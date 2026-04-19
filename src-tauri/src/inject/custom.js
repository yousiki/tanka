// Tanka bridge script, injected last into every page load of g.tanka.ai.
// Detects unread state from DOM signals and reports it to the Rust side
// so it can render a dock badge and swap the tray icon.
//
// Detection rules (each reviewed against the real g.tanka.ai DOM):
//
//  1. document.title — looks for a "(N)" / "N - " prefix that counts unread.
//     Defensive: if the site doesn't do this, the regex simply won't match.
//
//  2. favicon URL — records the *baseline* favicon we see once the SPA has
//     stabilized, and treats any deviation from that baseline as unread.
//     We do NOT use substring heuristics like "contains the word 'red'"
//     because they false-positive on completely normal URLs (the original
//     version flagged "/tanka-favicon.png" as unread in some cases).
//
// Diagnostics are exposed on `window.__tankaUnread` so you can inspect the
// current state from the dev-mode devtools.

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
  };
  window.__tankaUnread = state;

  let debounceTimer = null;

  function currentFaviconHref() {
    const link =
      document.querySelector('link[rel="icon"]') ||
      document.querySelector('link[rel="shortcut icon"]') ||
      document.querySelector('link[rel*="icon"]');
    return link ? link.getAttribute("href") || "" : "";
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

    if (
      state.baselineFavicon !== null &&
      state.currentFavicon !== "" &&
      state.currentFavicon !== state.baselineFavicon
    ) {
      return 1;
    }

    return 0;
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
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      report(computeUnread());
    }, 100);
  }

  function captureBaseline() {
    // Called once the SPA has had time to settle. Anything that looks like
    // a valid favicon URL at this point is treated as the "no unread" state.
    // If the site swaps the favicon for unread later, we'll see the deviation.
    const href = currentFaviconHref();
    if (href) {
      state.baselineFavicon = href;
      state.baselineCapturedAt = Date.now();
    }
    report(0);
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
        if (
          r.type === "childList" ||
          (r.type === "attributes" && r.target.tagName === "LINK")
        ) {
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
    // Give the SPA time to hydrate and finalize its favicon before we
    // capture the "no unread" baseline.
    setTimeout(captureBaseline, 2500);
    // When the app regains focus the user is likely reading messages, so
    // recompute (the site will usually have cleared the unread indicator).
    window.addEventListener("focus", scheduleReport);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
