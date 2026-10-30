import CraftHubMacCore
import Foundation

/// The two native pages under Tools retain their own route across navigation and restarts.
enum ToolsPage: String {
  case favorites, navigation

  init?(path: String) {
    switch path {
    case "/tools": self = .favorites
    case "/navigation": self = .navigation
    default: return nil
    }
  }
  var path: String { self == .navigation ? "/navigation" : "/tools" }
}

/// A primary workbench destination shown in the native sidebar, mapped to a web route.
enum Destination: String, CaseIterable, Identifiable {
  case overview, projects, tools, software, environment, workbenches, marketplace, diagnostics

  var id: String { rawValue }

  static let primary: [Destination] = [.overview, .projects, .tools, .software, .environment, .workbenches]
  static let manage: [Destination] = [.marketplace, .diagnostics]

  var path: String {
    switch self {
    case .overview: "/overview"
    case .projects: "/"
    case .tools: "/tools"
    case .software: "/software"
    case .environment: "/environment"
    case .workbenches: "/workbenches"
    case .marketplace: "/marketplace"
    case .diagnostics: "/diagnostics"
    }
  }

  var symbol: String {
    switch self {
    case .overview: "house"
    case .projects: "folder"
    case .tools: "wrench.and.screwdriver"
    case .software: "shippingbox"
    case .environment: "terminal"
    case .workbenches: "rectangle.3.group"
    case .marketplace: "puzzlepiece.extension"
    case .diagnostics: "stethoscope"
    }
  }

  @MainActor var title: String { L10n.text.destination(self) }

  var isNative: Bool {
    [.overview, .projects, .tools, .environment, .software, .marketplace, .diagnostics].contains(self)
  }

  /// The destination a web route belongs to, so the sidebar follows in-page navigation.
  static func matching(path: String) -> Destination? {
    if path == "/" { return .projects }
    if path == "/navigation" { return .tools }
    if path.hasPrefix("/integrations/") { return .workbenches }
    return
      allCases
      .filter { $0 != .projects && (path == $0.path || path.hasPrefix($0.path + "/")) }
      .max { $0.path.count < $1.path.count }
  }
}

/// User-facing strings in the two locales the web workbench supports.
struct L10n {
  @MainActor static var text: L10n { L10n(chinese: NativePreferences.shared.language == .chinese) }

  let chinese: Bool

  func copy(_ zh: String, _ en: String) -> String { chinese ? zh : en }

  func toolStatus(_ status: String) -> String {
    switch status {
    case "available": copy("可用", "Available")
    case "missing": copy("未检测到", "Not Detected")
    case "error": copy("检查失败", "Check Failed")
    case "unsupported": copy("不支持", "Unsupported")
    default: copy("未知", "Unknown")
    }
  }

  func softwareStatus(_ status: String) -> String {
    switch status {
    case "detected": copy("已检测到", "Detected")
    case "not-detected": copy("未检测到", "Not Detected")
    default: copy("未知", "Unknown")
    }
  }

  func destination(_ destination: Destination) -> String {
    switch destination {
    case .overview: chinese ? "首页" : "Home"
    case .projects: chinese ? "项目" : "Projects"
    case .tools: chinese ? "工具" : "Tools"
    case .software: chinese ? "软件中心" : "Software"
    case .environment: chinese ? "开发环境" : "Environment"
    case .workbenches: chinese ? "工作台" : "Workbenches"
    case .marketplace: chinese ? "插件管理" : "Plugins"
    case .diagnostics: chinese ? "诊断中心" : "Diagnostics"
    }
  }

  var manageSection: String { chinese ? "管理" : "Manage" }
  var back: String { chinese ? "返回" : "Back" }
  var forward: String { chinese ? "前进" : "Forward" }
  var search: String { chinese ? "搜索项目、页面和命令" : "Search projects, pages and commands" }
  var reload: String { chinese ? "重新加载" : "Reload" }
  var settings: String { chinese ? "设置…" : "Settings…" }
  var commandPalette: String { chinese ? "命令面板" : "Command Palette" }
  var starting: String { chinese ? "正在启动 Craft Hub 运行时…" : "Starting the Craft Hub runtime…" }
  var findingNode: String { chinese ? "正在查找本机 Node…" : "Looking for Node on this Mac…" }
  func usingNode(_ path: String, _ version: String) -> String {
    chinese ? "使用 \(path)（\(version)）" : "Using \(path) (\(version))"
  }

  var missingNodeTitle: String { chinese ? "没有找到兼容的 Node" : "No compatible Node found" }
  func nodeSelectionFailure(_ failure: NodeSelectionFailure, fallback: ResolvedNode?) -> String {
    let reason: String
    switch failure.reason {
    case .invalidPath: reason = copy("路径不是有效的绝对路径", "the path is not a valid absolute path")
    case .missingExecutable: reason = copy("文件已不存在或不可执行", "the file is missing or not executable")
    case .unsupportedVersion(let version): reason = copy("版本 \(version) 不受支持", "version \(version) is unsupported")
    case .architectureMismatch(let found, let expected):
      reason = copy(
        "CPU 架构为 \(found)，此 App 需要 \(expected)", "its CPU architecture is \(found); this app needs \(expected)")
    case .probe(.timedOut): reason = copy("检查超时，已结束检查进程", "the check timed out and its process was stopped")
    case .probe(.outputLimit): reason = copy("检查输出过多，已结束检查进程", "the check exceeded its output limit and was stopped")
    case .probe: reason = copy("无法获取有效的 Node 版本和架构", "its Node version and architecture could not be read")
    }
    let message = copy("未使用设置的 Node：\(reason)。", "The selected Node was not used: \(reason).")
    guard let fallback else { return message }
    return message + " "
      + copy("已改用 \(fallback.path)（\(fallback.version)）。", "Using \(fallback.path) (\(fallback.version)) instead.")
  }
  var missingNodeMessage: String {
    chinese
      ? "Craft Hub 需要 Node 22（≥22.18）、24（≥24.11）或 26来运行项目能力。已检查 PATH、Homebrew、~/.local/bin、pnpm 和 fnm。"
      : "Craft Hub needs Node 22 (≥22.18), 24 (≥24.11), or 26 to run project capabilities. It checked PATH, Homebrew, ~/.local/bin, pnpm, and fnm."
  }

  var chooseNode: String { chinese ? "选择 Node…" : "Choose Node…" }
  var chooseNodeMessage: String { chinese ? "选择一个 node 可执行文件" : "Choose a node executable" }
  var retry: String { chinese ? "重试" : "Retry" }
  var failedTitle: String { chinese ? "运行时没有启动" : "The runtime didn't start" }
  var backendMissing: String {
    chinese ? "应用里缺少运行时后端，请重新构建原型。" : "The runtime backend is missing from the app. Rebuild the prototype."
  }
  var backendHandshakeFailed: String { chinese ? "运行时没有返回本地地址。" : "The runtime didn't report its local address." }
  func backendExited(_ status: Int32, _ detail: String) -> String {
    let summary = chinese ? "运行时已退出（状态 \(status)）。" : "The runtime exited (status \(status))."
    return detail.isEmpty ? summary : "\(summary)\n\(detail)"
  }
}
