cask "tanka" do
  version "0.1.0"

  # Per-architecture hashes must match the bytes published on GitHub Releases.
  # The release workflow writes SHA256SUMS alongside the DMGs and also emits
  # a ready-to-commit cask (tanka-<version>.rb) with these fields filled in —
  # so in practice you don't hand-edit this template, you copy the one the
  # workflow produces.
  on_arm do
    url "https://github.com/yousiki/tanka/releases/download/v#{version}/Tanka-aarch64.dmg"
    sha256 "5cde1d9d8989d839a76920b43d5c2a36d6503f901feff2bc5c775a787eed04b0"
  end
  on_intel do
    url "https://github.com/yousiki/tanka/releases/download/v#{version}/Tanka-x86_64.dmg"
    # x86_64 DMG is produced by CI on first tagged release; populate from
    # SHA256SUMS when bumping the cask.
    sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  end

  name "Tanka"
  desc "Native macOS wrapper for g.tanka.ai"
  homepage "https://github.com/yousiki/tanka"

  auto_updates false
  depends_on macos: ">= :monterey"

  app "Tanka.app"

  # The DMG is ad-hoc signed, not Developer-ID signed, so macOS applies a
  # quarantine xattr on first launch. Homebrew has already verified the
  # sha256 above, which means the bits on disk match what our release
  # workflow published — so stripping the xattr here is strictly an
  # informed trust decision, not a blanket Gatekeeper bypass.
  postflight do
    set_permissions "#{appdir}/Tanka.app", "0755"
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Tanka.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/ai.tanka.desktop",
    "~/Library/Caches/ai.tanka.desktop",
    "~/Library/Preferences/ai.tanka.desktop.plist",
    "~/Library/Saved Application State/ai.tanka.desktop.savedState",
    "~/Library/WebKit/ai.tanka.desktop",
  ]
end
