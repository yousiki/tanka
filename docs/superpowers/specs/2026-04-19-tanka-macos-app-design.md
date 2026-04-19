# Tanka macOS App — Design

Date: 2026-04-19
Status: Approved, implementation in progress

## Goal

Ship a macOS-native desktop wrapper for <https://g.tanka.ai/> that behaves like
traditional IM apps (WeChat / QQ / Telegram): persistent menu bar presence,
system notifications, dock badge for unread counts, and a tray-icon dot
indicator. macOS-only for now.

## Non-goals

- Global hotkey to summon the window.
- Auto-start at login (users add it manually via System Settings if wanted).
- Notification-click routes to a specific conversation (requires site-side
  wiring that doesn't exist upstream).
- Multi-account support.
- Windows / Linux builds (Pake still supports them; we inherit the code but
  don't test or ship).

## Architecture

This repo is a fork of <https://github.com/tw93/Pake> with `upstream` pointing
at `tw93/Pake` so we can `git fetch upstream` and cherry-pick fixes. We
hardcode Tanka's configuration instead of exposing a CLI, and layer a small
amount of Tanka-specific Rust + JS on top.

```
┌─────────────────────────────────────────┐
│  Tanka.app                              │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ Rust main process (from Pake)     │  │
│  │                                   │  │
│  │ Inherited from Pake:              │  │
│  │  · window, native menu, tray      │  │
│  │  · hide-on-close                  │  │
│  │  · send_notification IPC →        │  │
│  │    tauri-plugin-notification →    │  │
│  │    UserNotifications              │  │
│  │                                   │  │
│  │ Added for Tanka:                  │  │
│  │  · UnreadState (app state)        │  │
│  │  · set_unread IPC                 │  │
│  │  · NSDockTile.setBadgeLabel via   │  │
│  │    objc2 (macOS only)             │  │
│  │  · tray icon swap (plain /        │  │
│  │    with-dot) on unread change     │  │
│  └───────────────┬───────────────────┘  │
│                  │ Tauri IPC             │
│  ┌───────────────┴───────────────────┐  │
│  │ WKWebView → https://g.tanka.ai/   │  │
│  │                                   │  │
│  │ Inherited (Pake event.js):        │  │
│  │  · window.Notification constructor│  │
│  │    → invoke("send_notification")  │  │
│  │                                   │  │
│  │ Added (custom.js → tanka-bridge): │  │
│  │  · wraps window.Notification once │  │
│  │    more to count unread arrivals  │  │
│  │    (but only when the window is   │  │
│  │    NOT focused)                   │  │
│  │  · document.title regex for       │  │
│  │    "(N) …" unread prefixes        │  │
│  │  · focus / visibilitychange →     │  │
│  │    counter = 0                    │  │
│  │  · debounced invoke("set_unread", │  │
│  │    {count})                       │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Key design decisions

### Remote URL, not packaged assets

The webview loads `https://g.tanka.ai/` live every launch. Web-side updates
therefore propagate to users with zero action — same as Slack/Telegram
desktop. Only changes to the native shell (new IPC commands, updated
icons, Rust fixes) require an app-side release.

### Web Notifications API is already wired

Pake's `event.js` replaces `window.Notification` with a Tauri-IPC shim that
calls `send_notification` → `tauri-plugin-notification`. Verified: the site
uses this API (user confirmed the browser already shows popups today). We
inherit this path unchanged. The site's custom notification sound is played
by its own `<audio>` element and works inside the webview.

### Unread detection: Notification-constructor counter + title regex

The site is a Vue/iView SPA with no PWA manifest and no public unread API.
We infer unread from two *unambiguous* signals and avoid favicon URL
parsing entirely — earlier attempts to match favicon URLs against
substring hints (`red`, `unread`, `badge`) false-positived, and any
calibration scheme for mapping "which favicon URL means clean" has
pathological edge cases (opening the app with unread, recalibrating
while focused with unread, etc.).

1. **`window.Notification` wrapper.** Pake's `event.js` already replaces
   the `Notification` constructor with a shim that forwards to
   `tauri-plugin-notification`. `custom.js` wraps *that* shim to also
   increment an unread counter whenever the site fires a notification
   **while the Tanka window is not focused**. Focus means the user is
   already looking at Tanka, so a concurrent notification is not unread
   from their perspective (the macOS alert still fires, independent).
2. **`document.title` regex.** If the SPA ever prefixes the title with
   `(N) …`, `【N】…`, or `N - …` we parse that. Unconfirmed for Tanka; if
   they don't use this convention the regex simply never matches.

The reported count is `max(notificationCount, titleCount)`. Focusing the
window resets `notificationCount` to 0 — standard IM semantic (same as
macOS Mail: opening the app clears the badge). `visibilitychange` also
counts as focus for this purpose, so hiding/showing the window behaves
intuitively.

Debounced at 60ms to collapse bursts.

Trade-off: the counter is reset-on-focus, not reset-on-read-each-message.
If the user focuses briefly without reading, the badge clears. That
matches every other desktop IM app. If the user quits and relaunches
the app, the counter starts at 0 and prior unread (if any) isn't
represented in the badge — the site's own UI indicates unread state
once the window loads.

### Dock badge via objc2

Tauri doesn't expose `NSDockTile` bindings, so we call them directly via
`objc2 + objc2-app-kit`. ~20 lines of `unsafe`, macOS-gated:

```rust
#[cfg(target_os = "macos")]
fn set_dock_badge(label: Option<&str>) {
    use objc2_app_kit::NSApplication;
    use objc2_foundation::NSString;
    let mtm = MainThreadMarker::new().unwrap();
    let app = NSApplication::sharedApplication(mtm);
    let tile = app.dockTile();
    let ns = label.map(NSString::from_str);
    unsafe { tile.setBadgeLabel(ns.as_deref()) };
}
```

Called from the main thread on every unread-state change.

### Tray icon dot via asset swap

Two template PNGs bundled: `tray-plain.png` and `tray-dot.png`. On unread
change the Rust side calls `tray.set_icon(image)`. Pake already owns the
tray lifecycle; we just swap the image.

### Single-instance hardcoded on

Pake ships multi-instance as optional. For an IM app it's strictly wrong
(two windows racing against the same cookie jar and notification stream),
so `multi_instance=false` and `multi_window=false` are hardcoded.

### Stripped Pake CLI

We keep `src-tauri/` and `package.json`'s `tauri` scripts, but remove the
`bin/` Node CLI and its tests. Building is just `pnpm install && pnpm
tauri build`. This cuts our maintenance surface and avoids an npm-publish
lifecycle we don't need.

## Distribution

- **GitHub Releases**: tag `v*` triggers a CI workflow on `macos-latest`
  that builds arm64 and x86_64 `.dmg` artifacts and attaches them.
- **Homebrew tap**: a separate repo `yousiki/homebrew-tanka` holds a cask
  that points at the GitHub release `.dmg`. Install:
  `brew install --cask yousiki/tanka/tanka`.
- **Unsigned app**: coworkers run one `xattr -dr com.apple.quarantine
  /Applications/Tanka.app` command after install, same pattern as
  [Quotio](https://github.com/) uses. README documents this clearly. Mixed
  with the Homebrew cask, we can include a `postflight` that emits a
  printed hint but can't safely strip quarantine on the user's behalf.

## Updates

- **Web-side updates**: free. Reload or relaunch the app and the latest
  front-end is served.
- **App shell updates**: `brew upgrade` is the primary channel. No Sparkle
  or Tauri updater for v1 — it adds a signing-key ceremony we don't want
  yet. Revisit if users start skipping releases.

## Repo layout after customization

```
tanka/
├── .github/workflows/release.yml     # new: tag-driven dmg build
├── docs/
│   └── superpowers/specs/            # this doc
├── homebrew/tanka.rb                 # cask template (copied to tap repo)
├── src-tauri/
│   ├── pake.json                     # Tanka-specific config
│   ├── tauri.conf.json               # productName=Tanka, identifier
│   ├── tauri.macos.conf.json         # bundle icon, signing "-"
│   ├── icons/tanka.icns              # app icon
│   ├── png/tray-plain.png            # tray: no unread
│   ├── png/tray-dot.png              # tray: has unread
│   └── src/
│       ├── app/
│       │   ├── invoke.rs             # + set_unread
│       │   ├── setup.rs              # tray icon helpers callable from set_unread
│       │   └── unread.rs             # new: UnreadState + dock badge + icon swap
│       ├── inject/
│       │   └── custom.js             # new: tanka-bridge (favicon/title observers)
│       └── lib.rs                    # register set_unread; manage UnreadState
├── package.json                      # rename pake-cli → tanka, strip bin
└── README.md                         # install instructions, xattr command
```

## Testing

- **Smoke test** (manual, macOS): launch `.app`, verify (1) loads g.tanka.ai,
  (2) window hides on red-X, (3) tray click toggles window, (4) sending
  yourself a message triggers a macOS notification.
- **Badge test** (manual): open a conversation, receive a message while
  window hidden, verify dock shows a numeric badge AND tray icon switches
  to the dot variant.
- **CI build**: `pnpm tauri build` completes on `macos-latest` with no
  errors for both archs.
- **No unit tests added for now** — the Rust additions are thin glue and
  the JS observer is DOM-coupled. If either grows, split logic from
  platform calls for testability.

## Risks

- **Main-thread NSDockTile calls**: if invoked off the main thread we'll
  crash. Mitigation: route through Tauri's `run_on_main_thread`
  (implemented in `unread.rs`).
- **Notification-wrapper coupling to Pake's shim**: we wrap whatever
  `window.Notification` is at custom.js load. If a future Pake refactor
  changes that injection order or replaces the shim mid-session, our
  wrapper wraps something unexpected. Mitigation: Pake's `event.js`
  layout is stable and custom.js is explicitly documented as the
  last-inject slot; if that changes we'll notice on rebase.
- **Future Pake rebases**: they may refactor `src/inject/` or `src/app/`
  and our patches will conflict. Mitigation: keep Tanka additions in
  NEW files (`unread.rs`, `custom.js` content) where possible; minimize
  edits to upstream files to clearly-diffable lines.
