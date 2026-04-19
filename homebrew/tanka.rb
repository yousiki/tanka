cask "tanka" do
  version "0.1.0"
  sha256 :no_check

  on_arm do
    url "https://github.com/yousiki/tanka/releases/download/v#{version}/Tanka-aarch64.dmg"
  end
  on_intel do
    url "https://github.com/yousiki/tanka/releases/download/v#{version}/Tanka-x86_64.dmg"
  end

  name "Tanka"
  desc "Native macOS wrapper for g.tanka.ai"
  homepage "https://github.com/yousiki/tanka"

  auto_updates false
  depends_on macos: ">= :monterey"

  app "Tanka.app"

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
