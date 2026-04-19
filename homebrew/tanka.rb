cask "tanka" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.0"
  sha256 arm:   "3732c1d6529039949440506d570d10e068b9f1804e5f2191d0174959ef95b906",
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
