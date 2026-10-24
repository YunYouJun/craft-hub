import AppKit
import CraftHubMacCore
import SwiftUI

/// A read-only issue sheet. Remediation routes through the same reviewed destinations as the list.
struct DiagnosticDetailView: View {
  let item: DiagnosticSnapshot.Item
  let provider: DiagnosticSnapshot.Provider?
  let checkedAt: String
  let stale: Bool
  let openTarget: (DiagnosticSnapshot.Target) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var copied = false
  private var text: L10n { .text }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Label(text.copy("诊断详情", "Diagnostic Details"), systemImage: "stethoscope").font(.title2.bold())
        Spacer()
        Button(text.copy("关闭", "Close")) { dismiss() }.keyboardShortcut(.cancelAction)
      }
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if stale {
            Label(
              text.copy(
                "这是上次检查结果，请重新检查以确认当前状态。", "These are previous results. Check again to confirm the current state."),
              systemImage: "clock.arrow.circlepath"
            )
            .foregroundStyle(.secondary)
          }
          Label(
            item.severity == "error" ? text.copy("错误", "Error") : text.copy("警告", "Warning"),
            systemImage: item.severity == "error" ? "xmark.circle" : "exclamationmark.triangle"
          ).foregroundStyle(item.severity == "error" ? Color.red : Color.orange)
          if let subject = item.subject { Text(subject).font(.headline) }
          Text(item.message).frame(maxWidth: .infinity, alignment: .leading)
          if let location = DiagnosticPresentation.location(item) {
            GroupBox(text.copy("文件位置", "File Location")) {
              Text(location).font(.callout.monospaced()).frame(maxWidth: .infinity, alignment: .leading).padding(6)
            }
          }
          if let code = item.code { LabeledContent(text.copy("诊断代码", "Diagnostic Code"), value: code) }
          if let provider {
            GroupBox(text.copy("诊断来源", "Diagnostic Provider")) {
              VStack(alignment: .leading, spacing: 8) {
                Text(provider.title).font(.headline)
                LabeledContent(text.copy("插件", "Plugin"), value: provider.pluginId)
                if let message = provider.message { Text(message).foregroundStyle(.secondary) }
              }.frame(maxWidth: .infinity, alignment: .leading).padding(6)
            }
          } else if let providerID = item.providerId {
            LabeledContent(text.copy("诊断来源", "Diagnostic Provider"), value: providerID)
          }
          LabeledContent(text.copy("检查时间", "Checked At"), value: checkedAt)
        }.textSelection(.enabled)
      }
      HStack {
        Button(copied ? text.copy("已复制", "Copied") : text.copy("复制诊断", "Copy Diagnostic"), systemImage: "doc.on.doc") {
          NSPasteboard.general.clearContents()
          copied = NSPasteboard.general.setString(
            DiagnosticPresentation.copyText(item, provider: provider, checkedAt: checkedAt, stale: stale),
            forType: .string)
        }
        Spacer()
        if let target = item.target {
          Button(DiagnosticPresentation.targetTitle(target), systemImage: "arrow.right") {
            dismiss()
            openTarget(target)
          }.buttonStyle(.borderedProminent)
        }
      }
    }.padding(24).frame(width: 600, height: 500)
      .onChange(of: item.message) { copied = false }
      .onChange(of: checkedAt) { copied = false }
      .onChange(of: stale) { copied = false }
  }
}

enum DiagnosticPresentation {
  static func location(_ item: DiagnosticSnapshot.Item) -> String? {
    item.path.map { $0 + (item.line.map { ":\($0)" } ?? "") + (item.column.map { ":\($0)" } ?? "") }
  }
  @MainActor static func targetTitle(_ target: DiagnosticSnapshot.Target) -> String {
    let text = L10n.text
    switch target.type {
    case "marketplace": return text.copy("管理插件", "Manage Plugins")
    case "project": return text.copy("查看项目", "View Project")
    case "settings": return text.copy("打开设置", "Open Settings")
    default: return text.copy("查看集成", "View Integration")
    }
  }
  static func copyText(
    _ item: DiagnosticSnapshot.Item, provider: DiagnosticSnapshot.Provider?, checkedAt: String, stale: Bool
  ) -> String {
    ([
      "[\(item.severity)] \(item.subject ?? item.kind)", item.message,
      location(item), item.code.map { "Code: \($0)" },
      (provider?.title ?? item.providerId).map { "Provider: \($0)" }, provider?.message,
      "Checked: \(checkedAt)", stale ? "Previous results — check again to confirm the current state." : nil,
    ] as [String?]).compactMap { $0 }.joined(separator: "\n")
  }
}
