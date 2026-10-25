import AppKit
import CraftHubMacCore
import SwiftUI

struct SoftwareInstallationLogSelection: Identifiable {
  let runKey: String
  let itemID: String
  var id: String { "\(runKey.count):\(runKey)\(itemID)" }
}

/// Resolve the selection against the latest run so an open log follows runtime updates.
struct SoftwareInstallationLogView: View {
  @Bindable var model: SoftwareInstallationModel
  let selection: SoftwareInstallationLogSelection
  @Environment(\.dismiss) private var dismiss
  @State private var copied = false
  private var text: L10n { .text }
  private var run: SoftwareInstallationRun? { model.runs.first { $0.key == selection.runKey } }
  private var item: SoftwareInstallationRun.Item? { run?.items.first { $0.id == selection.itemID } }
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        VStack(alignment: .leading, spacing: 4) {
          Text(text.copy("安装日志", "Installation Log")).font(.title2.bold())
          if let item { Text(item.title.localized(chinese: text.chinese)).foregroundStyle(.secondary) }
        }
        Spacer()
        if let item { SoftwareInstallationStatus(value: item.state) }
      }
      if let run, let item {
        Text(text.copy("更新于 ", "Updated ") + SoftwareManagementPresentation.date(run.updatedAt, chinese: text.chinese))
          .font(.caption).foregroundStyle(.secondary)
        ScrollView([.horizontal, .vertical]) {
          Text(item.log.isEmpty ? text.copy("暂无日志", "No log output yet") : item.log)
            .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .topLeading).padding(12)
        }.background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
      } else {
        ContentUnavailableView(text.copy("记录已不可用", "Record No Longer Available"), systemImage: "doc.text")
      }
      HStack {
        Button(text.copy("关闭", "Close")) { dismiss() }.keyboardShortcut(.cancelAction)
        Spacer()
        Button {
          guard let item else { return }
          NSPasteboard.general.clearContents()
          copied = NSPasteboard.general.setString(item.log, forType: .string)
        } label: {
          Label(copied ? text.copy("已复制", "Copied") : text.copy("复制日志", "Copy Log"), systemImage: "doc.on.doc")
        }
        .disabled(item?.log.isEmpty != false)
      }
    }.padding(24).frame(width: 720, height: 520)
      .onChange(of: item?.log) { copied = false }
  }
}
