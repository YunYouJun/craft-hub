import Foundation

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

  var title: String { L10n.text.destination(self) }

  /// The destination a web route belongs to, so the sidebar follows in-page navigation.
  static func matching(path: String) -> Destination? {
    if path == "/" { return .projects }
    return allCases
      .filter { $0 != .projects && (path == $0.path || path.hasPrefix($0.path + "/")) }
      .max { $0.path.count < $1.path.count }
  }
}

/// User-facing strings in the two locales the web workbench supports.
struct L10n {
  static let text = L10n(chinese: Locale.preferredLanguages.first?.hasPrefix("zh") ?? false)

  let chinese: Bool

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
  var missingNodeMessage: String {
    chinese
      ? "Craft Hub 需要 Node 22.18、24.11 或 26 以上版本来运行项目能力。已检查 PATH、Homebrew、~/.local/bin 和 fnm。"
      : "Craft Hub needs Node 22.18, 24.11, or 26 and later to run project capabilities. It checked PATH, Homebrew, ~/.local/bin, and fnm."
  }

  var chooseNode: String { chinese ? "选择 Node…" : "Choose Node…" }
  var chooseNodeMessage: String { chinese ? "选择一个 node 可执行文件" : "Choose a node executable" }
  var retry: String { chinese ? "重试" : "Retry" }
  var failedTitle: String { chinese ? "运行时没有启动" : "The runtime didn't start" }
  var backendMissing: String { chinese ? "应用里缺少运行时后端，请重新构建原型。" : "The runtime backend is missing from the app. Rebuild the prototype." }
  var backendHandshakeFailed: String { chinese ? "运行时没有返回本地地址。" : "The runtime didn't report its local address." }
  func backendExited(_ status: Int32, _ detail: String) -> String {
    let summary = chinese ? "运行时已退出（状态 \(status)）。" : "The runtime exited (status \(status))."
    return detail.isEmpty ? summary : "\(summary)\n\(detail)"
  }
}
