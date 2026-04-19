# Tanka

A native macOS wrapper for [g.tanka.ai](https://g.tanka.ai) — the Tanka
work app as a proper desktop client with menu bar presence, dock badge,
and system notifications. Forked from [tw93/Pake](https://github.com/tw93/Pake).

Homebrew install: `brew install --cask yousiki/tanka/tanka`.

Internal project, macOS only.

## Install via Homebrew

```sh
brew install --cask yousiki/tanka/tanka
```

Because we don't pay for an Apple Developer ID, macOS will refuse to
launch the app until you strip the quarantine xattr. The cask prints
this instruction in its caveats; run it yourself after install:

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

- macOS 13+ (Ventura) to build with current Xcode.
  The *shipped* `.app` runs on macOS 12+ (Monterey), which is what the
  Homebrew cask's `depends_on macos` floor declares.
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
5. The cask in `yousiki/homebrew-tanka` updates itself. The release
   workflow renders `tanka.rb` from `homebrew/tanka.rb` with the real
   per-arch sha256 values, attaches it to the GitHub Release, and —
   if the `HOMEBREW_TAP_TOKEN` secret is configured — pushes it to the
   tap repo as `Casks/tanka.rb` with a commit message of the tag name.
   If the token is absent the step is skipped; the GitHub Release
   itself still succeeds and the tap can be updated by hand by
   downloading the release's `tanka.rb` asset.

   To enable the auto-update, create a fine-grained PAT with
   `Contents: read and write` scoped to `yousiki/homebrew-tanka` only,
   then add it as the `HOMEBREW_TAP_TOKEN` secret on `yousiki/tanka`.

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
