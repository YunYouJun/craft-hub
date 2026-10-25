import CraftHubMacCore
import SwiftUI

struct SoftwareInstallationCard: View {
  @Bindable var model: SoftwareInstallationModel
  let run: SoftwareInstallationRun
  let sourceTitle: String
  let stop: () -> Void
  let showLog: (String) -> Void
  @State private var expanded: Bool
  private var text: L10n { .text }
  private var titles: [String] { run.items.map { $0.title.localized(chinese: text.chinese) } }
  private var title: String {
    let names = titles.prefix(2).joined(separator: text.chinese ? "、" : ", ")
    if titles.count > 2 { return text.copy("\(names) 等 \(titles.count) 款软件", "\(names) + \(titles.count - 2) more") }
    return names.isEmpty ? text.copy("软件安装任务", "Software Installation") : names
  }

  init(
    model: SoftwareInstallationModel, run: SoftwareInstallationRun, sourceTitle: String,
    stop: @escaping () -> Void, showLog: @escaping (String) -> Void
  ) {
    self.model = model
    self.run = run
    self.sourceTitle = sourceTitle
    self.stop = stop
    self.showLog = showLog
    _expanded = State(initialValue: run.active || ["failed", "interrupted"].contains(run.state))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 12) {
        Image(systemName: SoftwareInstallationStatus.symbol(run.state)).font(.title3)
          .foregroundStyle(SoftwareInstallationStatus.color(run.state)).frame(width: 38, height: 38)
          .background(SoftwareInstallationStatus.color(run.state).opacity(0.08), in: RoundedRectangle(cornerRadius: 9))
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 4) {
          Text(title).font(.system(size: 14, weight: .semibold)).lineLimit(1).help(titles.joined(separator: ", "))
          Text(sourceTitle + " · " + SoftwareManagementPresentation.date(run.createdAt, chinese: text.chinese))
            .font(.caption).foregroundStyle(.secondary).lineLimit(1).help(run.createdAt)
        }.frame(maxWidth: .infinity, alignment: .leading)
        SoftwareInstallationStatus(value: run.state)
        action
      }.controlSize(.small)
      if run.active {
        HStack(spacing: 12) {
          ProgressView(
            value: Double(SoftwareManagementPresentation.processed(run)), total: Double(max(1, run.items.count))
          )
          .frame(maxWidth: 240).accessibilityLabel(text.copy("任务处理进度", "Task Processing Progress"))
          Text(
            text.copy(
              "已处理 \(SoftwareManagementPresentation.processed(run)) / \(run.items.count) 项",
              "\(SoftwareManagementPresentation.processed(run)) of \(run.items.count) items processed")
          )
          .font(.caption).foregroundStyle(.secondary)
        }
      }
      DisclosureGroup(isExpanded: $expanded) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(run.items) { item in
            Divider().padding(.vertical, 10)
            itemRow(item)
          }
          HStack(spacing: 12) {
            Text(text.copy("任务：", "Task: ") + run.id).lineLimit(1).truncationMode(.middle).help(run.id)
            if let retry = run.retryOf { Text(text.copy("重试自：", "Retry of: ") + retry).lineLimit(1).help(retry) }
          }.font(.caption2.monospaced()).foregroundStyle(.tertiary).textSelection(.enabled).padding(.top, 14)
        }
      } label: {
        Text(text.copy("\(run.items.count) 项软件 · 详情与日志", "\(run.items.count) apps · Details and logs"))
          .font(.caption).foregroundStyle(.secondary)
      }
    }.softwareManagementCard().accessibilityElement(children: .contain)
  }

  @ViewBuilder private var action: some View {
    if run.active {
      Button(text.copy("停止…", "Stop…"), action: stop)
        .disabled(
          run.state == "cancelling" || model.cancelling.contains(run.key) || !model.supports(run.sourceId, "cancel")
        )
        .accessibilityLabel(text.copy("停止安装：", "Stop Installation: ") + title)
    } else if !run.retryableIDs.isEmpty {
      Button(text.copy("审阅重试…", "Review Retry…")) {
        Task { await model.preview(source: run.sourceId, ids: run.retryableIDs) }
      }.disabled(
        model.planning || model.installing || model.sourceBusy(run.sourceId)
          || !model.supports(run.sourceId, "preview") || !model.supports(run.sourceId, "install")
      )
      .help(text.copy("只重新审阅失败、中断或取消的项目", "Review only failed, interrupted or cancelled items"))
      .accessibilityLabel(text.copy("重新审阅未完成项：", "Review Unfinished Items: ") + title)
    }
  }

  private func itemRow(_ item: SoftwareInstallationRun.Item) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 10) {
        Text(item.title.localized(chinese: text.chinese)).font(.callout.weight(.medium)).lineLimit(1)
        Spacer()
        SoftwareInstallationStatus(value: item.state)
        if !item.log.isEmpty {
          Button {
            showLog(item.id)
          } label: {
            Label(text.copy("日志", "Log"), systemImage: "doc.text")
          }
          .controlSize(.small).accessibilityLabel(
            text.copy("查看日志：", "View Log: ") + item.title.localized(chinese: text.chinese))
        }
      }
      if let progress = item.progress {
        HStack(spacing: 10) {
          if let percent = progress.percent, percent.isFinite {
            ProgressView(value: min(100, max(0, percent)), total: 100).frame(maxWidth: 180)
              .accessibilityLabel(
                item.title.localized(chinese: text.chinese) + " "
                  + SoftwareManagementPresentation.state(progress.phase, chinese: text.chinese))
            Text("\(Int(min(100, max(0, percent))))%").monospacedDigit()
          }
          Text(
            SoftwareManagementPresentation.state(progress.phase, chinese: text.chinese)
              + (progress.resource.map { " · " + $0 } ?? "")
          ).lineLimit(1).help(progress.resource ?? "")
        }.font(.caption).foregroundStyle(.secondary)
      }
      if let message = item.message, !message.isEmpty {
        Text(message).font(.caption).foregroundStyle(.secondary).textSelection(.enabled).fixedSize(
          horizontal: false, vertical: true)
      }
    }
  }
}

struct SoftwareInstallationStatus: View {
  let value: String
  var body: some View {
    SoftwareStatusBadge(
      title: SoftwareManagementPresentation.state(value, chinese: L10n.text.chinese),
      symbol: Self.symbol(value), color: Self.color(value))
  }
  static func color(_ state: String) -> Color {
    switch state {
    case "completed", "installed": .green
    case "failed": .red
    case "interrupted", "cancelling": .orange
    case "queued", "running", "waiting", "preparing", "downloading", "installing": .accentColor
    default: .secondary
    }
  }
  static func symbol(_ state: String) -> String {
    switch state {
    case "completed", "installed": "checkmark.circle"
    case "failed", "interrupted": "exclamationmark.circle"
    case "cancelled", "cancelling": "stop.circle"
    case "running", "downloading", "installing", "preparing": "arrow.down.circle"
    case "queued", "waiting": "clock"
    case "skipped": "arrow.right.circle"
    default: "info.circle"
    }
  }
}
