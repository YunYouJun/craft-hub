import AppKit
import WebKit

/// Resolve the same semantic colors used by native pages instead of maintaining a second macOS palette in CSS.
@MainActor
enum NativeWebAppearance {
  static func script(
    appearance: NSAppearance? = nil, windowMaterial: Bool? = nil
  ) -> String {
    let appearance = appearance ?? NSApplication.shared.effectiveAppearance
    let windowMaterial = windowMaterial ?? NativeWorkbenchWebView.supportsWindowMaterial
    let contrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
    let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    let lightAppearance = isDark ? NSAppearance(named: contrast ? .accessibilityHighContrastAqua : .aqua)! : appearance
    let darkAppearance =
      isDark ? appearance : NSAppearance(named: contrast ? .accessibilityHighContrastDarkAqua : .darkAqua)!
    let light = declarations(appearance: lightAppearance)
    let dark = declarations(appearance: darkAppearance)
    let css = """
      :root { \(light) }
      @media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { \(dark) } }
      :root[data-theme='dark'] { \(dark) }
      """
    guard let data = try? JSONEncoder().encode(css), let value = String(data: data, encoding: .utf8) else { return "" }
    return """
      (() => {
        const install = () => {
          if (!document.documentElement) return false;
          document.documentElement.toggleAttribute('data-native-window-material', \(windowMaterial));
          let style = document.getElementById('craft-hub-native-appearance');
          if (!style) {
            style = document.createElement('style');
            style.id = 'craft-hub-native-appearance';
            document.documentElement.append(style);
          }
          style.textContent = \(value);
          return true;
        };
        if (!install()) {
          const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
          observer.observe(document, { childList: true, subtree: true });
        }
      })();
      """
  }

  private static func declarations(appearance: NSAppearance) -> String {
    var result: [String] = []
    appearance.performAsCurrentDrawingAppearance {
      for (token, color) in [
        ("window-background", NSColor.windowBackgroundColor), ("control-background", .controlBackgroundColor),
        ("label", .labelColor), ("secondary-label", .secondaryLabelColor), ("separator", .separatorColor),
        ("accent", .controlAccentColor), ("on-accent", .alternateSelectedControlTextColor),
        ("focus-ring", .keyboardFocusIndicatorColor), ("placeholder", .placeholderTextColor),
      ] {
        guard let rgb = color.usingColorSpace(.sRGB) else { continue }
        let red = Int((rgb.redComponent * 255).rounded())
        let green = Int((rgb.greenComponent * 255).rounded())
        let blue = Int((rgb.blueComponent * 255).rounded())
        result.append("--native-\(token): rgba(\(red), \(green), \(blue), \(rgb.alphaComponent));")
      }
    }
    return result.joined(separator: "\n")
  }
}

/// Keep page loading/overscroll and retained web content aligned when system appearance or accent colors change.
final class NativeWorkbenchWebView: WKWebView {
  /// WebKit exposes no public macOS transparency switch. Keep this optional compatibility call in one place;
  /// unsupported WebKit versions retain the opaque semantic palette instead of leaving an unreadable page.
  static var supportsWindowMaterial: Bool {
    instancesRespond(to: NSSelectorFromString("_setDrawsBackground:"))
  }

  override init(frame: CGRect, configuration: WKWebViewConfiguration) {
    super.init(frame: frame, configuration: configuration)
    if Self.supportsWindowMaterial { setValue(false, forKey: "drawsBackground") }
    underPageBackgroundColor = Self.supportsWindowMaterial ? .clear : .windowBackgroundColor
    NotificationCenter.default.addObserver(
      self, selector: #selector(refreshNativeAppearance), name: NSColor.systemColorsDidChangeNotification, object: nil)
    NSWorkspace.shared.notificationCenter.addObserver(
      self, selector: #selector(refreshNativeAppearance),
      name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification,
      object: nil)
  }

  required init?(coder: NSCoder) { nil }

  deinit { stopObservingAppearance() }

  func stopObservingAppearance() {
    NotificationCenter.default.removeObserver(self)
    NSWorkspace.shared.notificationCenter.removeObserver(self)
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    refreshNativeAppearance()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    refreshNativeAppearance()
  }

  @objc func refreshNativeAppearance() {
    underPageBackgroundColor = Self.supportsWindowMaterial ? .clear : .windowBackgroundColor
    evaluateJavaScript(NativeWebAppearance.script(appearance: effectiveAppearance), completionHandler: nil)
  }
}
