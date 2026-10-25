import CraftHubMacCore
import Foundation

/// Display-only summaries of public runtime observations; never schedules work or infers installation success.
enum SoftwareManagementPresentation {
  static func date(_ value: String, chinese: Bool, timeZone: TimeZone = .current) -> String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var date = parser.date(from: value)
    if date == nil {
      parser.formatOptions = [.withInternetDateTime]
      date = parser.date(from: value)
    }
    guard let date else { return chinese ? "时间未知" : "Unknown time" }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: chinese ? "zh_CN" : "en_US")
    formatter.timeZone = timeZone
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    formatter.doesRelativeDateFormatting = true
    return formatter.string(from: date)
  }

  static func refresh(_ policy: SoftwareRefreshPolicy?, local: Bool, chinese: Bool) -> String {
    if local { return chinese ? "手动读取本地目录" : "Read local checkout manually" }
    // The runtime defaults older sources with no explicit policy to a 24-hour interval.
    let policy = policy ?? .init(mode: "interval", intervalMinutes: 1440)
    switch policy.mode {
    case "manual": return chinese ? "手动刷新" : "Manual refresh"
    case "interval":
      guard let minutes = policy.intervalMinutes, minutes > 0 else { return chinese ? "刷新策略未知" : "Unknown schedule" }
      if minutes % 60 == 0 {
        return chinese ? "每 \(minutes / 60) 小时刷新" : "Refresh every \(minutes / 60) hours"
      }
      return chinese ? "每 \(minutes) 分钟刷新" : "Refresh every \(minutes) minutes"
    case "daily":
      guard let time = policy.time, let zone = policy.timeZone else { return chinese ? "刷新策略未知" : "Unknown schedule" }
      return chinese ? "每天 \(time) · \(zone)" : "Daily at \(time) · \(zone)"
    default: return chinese ? "刷新策略未知" : "Unknown schedule"
    }
  }

  static func state(_ value: String, chinese: Bool) -> String {
    guard chinese else { return value.capitalized }
    return [
      "queued": "排队中", "running": "进行中", "cancelling": "正在停止", "completed": "已完成", "failed": "失败",
      "cancelled": "已取消", "interrupted": "已中断", "waiting": "等待处理", "installed": "已安装", "skipped": "已跳过",
      "manual": "手动处理", "preparing": "准备中", "downloading": "下载中", "installing": "安装中",
    ][value] ?? value
  }

  static func processed(_ run: SoftwareInstallationRun) -> Int {
    run.items.filter { ["installed", "skipped", "manual", "failed", "cancelled", "interrupted"].contains($0.state) }
      .count
  }

  static func matches(_ run: SoftwareInstallationRun, filter: String, query: String, sourceTitle: String) -> Bool {
    let stateMatches: Bool
    switch filter {
    case "active": stateMatches = run.active
    case "completed": stateMatches = run.state == "completed"
    case "attention": stateMatches = ["failed", "interrupted"].contains(run.state)
    case "cancelled": stateMatches = run.state == "cancelled"
    default: stateMatches = true
    }
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let terms =
      [sourceTitle, run.sourceId, run.id] + run.items.flatMap { [$0.title.en, $0.title.zh ?? "", $0.softwareId] }
    return stateMatches && (query.isEmpty || terms.contains { $0.localizedStandardContains(query) })
  }
}
