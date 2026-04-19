# Tanka

A native macOS wrapper for [g.tanka.ai](https://g.tanka.ai) — the Tanka
work app as a proper desktop client with menu bar presence, dock badge,
and system notifications. Forked from [tw93/Pake](https://github.com/tw93/Pake).

Internal project, macOS only.

## Install via Homebrew

```sh
brew install --cask yousiki/tanka/tanka
```

The cask automatically runs `xattr -dr com.apple.quarantine` on the
installed app because we don't pay for an Apple Developer ID. If
Gatekeeper still complains, run it yourself:

```sh
xattr -dr com.apple.quarantine /Applications/Tanka.app
```

## Install from a downloaded DMG

Download the latest `.dmg` from [Releases](https://github.com/yousiki/tanka/releases),
drag `Tanka.app` to `/Applications`, then:

```sh
xattr -dr com.apple.quarantine /Applications/Tanka.app
```

## What you get

- Loads `https://g.tanka.ai/` in a native WKWebView. Login persists.
- Red-X hides the window instead of quitting; the app stays alive in the
  menu bar and continues to receive notifications.
- System notifications for new messages (bridged from the site's
  `Notification` API into `UserNotifications`).
- Dock badge with unread count; menu bar tray icon changes when there's
  unread activity.
- Click the menu bar icon to toggle the window.
- `Cmd+Q` or the tray menu → `Quit` actually quits.

## Building from source

Requires:

- macOS 13+
- [Bun](https://bun.sh/) ≥ 1.1
- Rust toolchain (stable; `rust-toolchain.toml` pins the minimum)
- Xcode command line tools

```sh
bun install
bun run tauri build
```

Output: `src-tauri/target/release/bundle/dmg/Tanka_*.dmg`.

For a quicker local-dev build (unbundled, with devtools):

```sh
bun run tauri build --debug --no-bundle
open src-tauri/target/debug/pake     # the binary is still named "pake"
```

## Releasing

1. Bump `version` in both `src-tauri/tauri.conf.json` and `package.json`.
2. Commit and push.
3. `git tag v0.x.y && git push --tags`.
4. GitHub Actions (`.github/workflows/release.yml`) builds arm64 + x86_64
   DMGs and publishes a GitHub Release.
5. Update the cask in `yousiki/homebrew-tanka` — bump `version` in
   `Casks/tanka.rb`. A copy of the current cask lives at
   [homebrew/tanka.rb](./homebrew/tanka.rb).

## Keeping in sync with upstream Pake

```sh
git fetch upstream
git log upstream/main ^main --oneline   # see what's new
git cherry-pick <sha>                   # for fixes we want
```

Prefer cherry-picking specific fixes over merging the whole upstream; our
Tanka customizations are mostly in new files (`src-tauri/src/app/unread.rs`,
`src-tauri/src/inject/custom.js`) but touch `lib.rs`, `mod.rs`, `pake.json`,
and a few config files, so a full merge will conflict.

## Architecture

See [`docs/superpowers/specs/2026-04-19-tanka-macos-app-design.md`](docs/superpowers/specs/2026-04-19-tanka-macos-app-design.md).

## Credits

- [tw93/Pake](https://github.com/tw93/Pake) — the Tauri-based web-to-desktop
  scaffold that made this a weekend project rather than a month-long one.
- Tanka AI for the app itself.
