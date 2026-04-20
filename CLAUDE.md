# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo actually is

A **fork of [tw93/Pake](https://github.com/tw93/Pake)** that ships as a native
macOS wrapper around <https://g.tanka.ai/>. Upstream Pake is tracked at the
`upstream` remote. Most of `src-tauri/` is inherited code; Tanka-specific
additions live in a small number of clearly-named files (`unread.rs`,
`custom.js`, config JSONs, `docs/`, `homebrew/`, `.github/`, `scripts/`).

When a bug looks strange, first check whether the relevant file is ours or
upstream Pake's — refactoring Pake files makes rebases miserable.

Sync with upstream:

```sh
git fetch upstream
git log upstream/main ^main --oneline      # see what's new
git cherry-pick <sha>                      # for fixes we want
```

**Never merge `upstream/main` wholesale** — we touch shared files
(`lib.rs`, `mod.rs`, `pake.json`, `tauri.*.conf.json`) and merges will
conflict.

## Package manager

**Bun only.** Do not introduce pnpm or npm. `bun install` is the only
install command. `bun run tauri …` is the way to call the Tauri CLI.

## Common commands

```sh
# Install JS deps (only @tauri-apps/api + @tauri-apps/cli)
bun install

# Release build → produces an aarch64 .dmg at
#   src-tauri/target/release/bundle/dmg/Tanka_0.1.0_aarch64.dmg
bun run tauri build

# Fast debug build (unbundled, no DMG)
bun run tauri build --debug --no-bundle
open src-tauri/target/debug/pake   # the binary is still named "pake"

# Rust-only type check (skips bundling)
cd src-tauri && cargo check

# Regenerate the tray-dot.png overlay from tray-plain.png
swift scripts/render-tray-dot.swift
```

### Tests

The repo inherits a vitest suite at `tests/unit/` and `tests/integration/`
(plus `vitest.config.ts`), but it is currently **dormant**: most of those
tests exercise Pake's Node CLI under `bin/`, and `package.json` no longer
declares `vitest` or the other CLI-build dev deps. `bunx vitest run` will
fail with `Cannot find package 'vitest'` until you add it back.

Of the inherited tests, `tests/unit/event-link-guard.test.js` is the only
one that directly exercises something we still ship — it parses
`src-tauri/src/inject/event.js`, which is Pake-owned but is part of the
runtime webview we launch. If you touch that file, restoring the vitest
dev dep and running just that test is worth the one-off install.

There are no tests yet for **our own** additions (`unread.rs`,
`custom.js`). Correctness of the unread bridge has been verified by
reading code and manual UI testing across four stop-time review rounds;
if you find yourself re-deriving the watermark rules, write a vitest
test instead of re-deriving them a fifth time.

If `tauri build` fails with `bundle_dmg.sh` errors and leaves half-made
DMGs mounted, detach them before retrying:

```sh
hdiutil detach /Volumes/Tanka 2>/dev/null
hdiutil info | awk '/dmg\.y[A-Za-z0-9]+$/{print $2}' | xargs -I{} hdiutil detach {} 2>/dev/null
```

## Architecture

```
Tanka.app (.app bundle)
├── Rust main process (Tauri 2.10)
│   ├── Inherited from Pake:
│   │   - window, menu, tray (src-tauri/src/app/{window,menu,setup}.rs)
│   │   - hide-on-close behaviour
│   │   - tauri-plugin-notification bridge (send_notification IPC)
│   │   - initialization_script pipeline: injects
│   │     src-tauri/src/inject/{component,event,style,theme_refresh,auth,custom}.js
│   │     into every page load, in that order (custom.js last).
│   │
│   └── Added for Tanka:
│       - src-tauri/src/app/unread.rs
│           UnreadState (atomic u32), set_unread IPC,
│           NSDockTile.setBadgeLabel via objc2, tray-plain/dot swap.
│
└── WKWebView → https://g.tanka.ai/
    └── Tanka bridge (src-tauri/src/inject/custom.js)
        - Wraps Pake's window.Notification once more to increment a
          counter when the app is NOT focused.
        - MutationObserver on <title>; re-attaches if the SPA
          replaces the <title> node instead of mutating its text.
        - syncTitleState() runs synchronously in the observer — not
          inside the debounced report — so a focus→blur race during a
          title mutation can't land against the wrong focus state.
        - On focus / visible: consumeOnFocus zeros notificationCount.
          titleCount is NEVER consumed by focus — it mirrors the
          site's own view of unread (persistent count), and the site
          lowers it when the user actually reads, not when they merely
          focus the window.
        - Reported count = isAppFocused() ? 0 : max(notificationCount, titleCount).
        - When the site's own title counter DECREASES, delta-subtract
          notificationCount so cross-device reads (phone, etc.) drop
          our badge too.
```

### Why the webview must run while backgrounded

`window.rs` sets `background_throttling(BackgroundThrottlingPolicy::Disabled)`.
WKWebView's default (Suspend) freezes JS, timers, and WebSocket
callbacks the moment the app loses focus — which means:

- the site never calls `new Notification(...)` while backgrounded
  (it never runs the message handler),
- `<title>` never updates,
- our bridge has no signals to observe,
- the page doesn't refresh at all.

Without this, the dock badge only surfaced when macOS happened to
wake WKWebView briefly (e.g. auto-hide dock tile rendering). Do not
revert — Tanka is an IM client, it's expected to keep the page alive.

### Why the unread bridge is the way it is

It took four review rounds to settle. Don't revisit these without
understanding the failure modes they avoid:

- **No favicon-URL heuristics.** Substring matching ("red", "unread")
  false-positives on unrelated hrefs. Any baseline calibration we tried
  had pathological cases (launch-with-unread, recalibrate-while-focused,
  etc.). Notification-counter + title regex are the only reliable signals.
- **Title state syncs in the observer, not the debounced report.**
  If syncTitleState ran inside the 60ms debounce, a title mutation at T=0
  + blur at T=30ms would have the debounce fire at T=60ms observing
  `isAppFocused()=false` under a stale sync.
- **`previous > 0` guard on the delta-subtract.** Without it, the very
  first observation of a title with a numeric prefix could retroactively
  zero legitimate notification counts on a site that doesn't actually use
  title-based unread.
- **No title "watermark".** An earlier design pinned a watermark to the
  current titleCount on focus and computed `titleCount - watermark`. The
  intent was "don't re-surface a title value the user has already seen",
  but for Tanka's persistent unread (title is "(5) Tanka" whenever there
  are 5 unread, regardless of focus), this swallowed the very unread
  the badge is supposed to show. Focusing the window ≠ reading the
  messages; the site is the source of truth, and the site lowers its
  count when the user actually reads. We now mirror titleCount directly.

### Security boundary

- `src-tauri/capabilities/default.json` scopes remote IPC to
  `https://*.tanka.ai/*`. Do not widen this back to `https://*.*`.
- `src-tauri/src/app/invoke.rs::sanitize_download_filename` reduces
  caller-supplied filenames to a basename. Any new command that writes
  to the filesystem must apply the same sanitization — Pake's download
  commands previously allowed path traversal via the `filename` param.

## Release flow

1. Bump `version` in `src-tauri/tauri.conf.json` AND `package.json`.
2. Commit, push.
3. `git tag v0.x.y && git push origin v0.x.y`.
4. `.github/workflows/release.yml` builds both arches, publishes a
   GitHub Release with the DMGs, `SHA256SUMS`, and a pre-rendered
   `tanka.rb` — then pushes that cask to `yousiki/homebrew-tanka`
   automatically (requires `HOMEBREW_TAP_TOKEN` secret).

The cask generator is `.github/scripts/render_cask.py`. It reads
`homebrew/tanka.rb` (template) and `dist/SHA256SUMS`, substitutes the
version + both per-arch hashes, writes `dist/tanka.rb`. It **refuses to
emit** a cask that still contains the all-zeros placeholder hash, so a
bugged matrix that produces only one arch fails loudly.

### CI gotcha

`rust-toolchain.toml` pins Rust 1.93.0. `dtolnay/rust-toolchain@stable`
installs targets against the *stable* channel, not 1.93.0, so the
release workflow has an explicit `rustup target add` step run from
`src-tauri/` (so rustup sees the toml and adds the target to 1.93.0).
Don't remove that step.

## Design doc

Full design rationale in
`docs/superpowers/specs/2026-04-19-tanka-macos-app-design.md`. When
redesigning the unread bridge, update that doc in the same commit.
