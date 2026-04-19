cask "tanka" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.0"
  sha256 arm:   "5cde1d9d8989d839a76920b43d5c2a36d6503f901feff2bc5c775a787eed04b0",
         intel: "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/yousiki/tanka/releases/download/v#{version}/Tanka-#{arch}.dmg"
  name "Tanka"
  desc "Native macOS wrapper for g.tanka.ai"
  homepage "https://github.com/yousiki/tanka"

  auto_updates false
  depends_on macos: ">= :monterey"

  app "Tanka.app"

  caveats <<~EOS
    Tanka is ad-hoc signed (no Apple Developer ID, no notarization), so
    macOS will refuse to launch it until you remove the quarantine xattr:

      xattr -dr com.apple.quarantine "#{appdir}/Tanka.app"
  EOS

  zap trash: [
    "~/Library/Application Support/ai.tanka.desktop",
    "~/Library/Caches/ai.tanka.desktop",
    "~/Library/Preferences/ai.tanka.desktop.plist",
    "~/Library/Saved Application State/ai.tanka.desktop.savedState",
    "~/Library/WebKit/ai.tanka.desktop",
  ]
end
