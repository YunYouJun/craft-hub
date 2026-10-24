import SwiftUI

struct DefaultLinkSettings: View {
  @Bindable var model: DefaultLinkModel
  private var text: L10n { .text }

  var body: some View {
    Section(text.copy("公开链接", "Public Links")) {
      LabeledContent("craft-hub:") {
        Text(
          model.current?.url.deletingPathExtension().lastPathComponent
            ?? text.copy("未设置或尚未读取", "Not set or not checked"))
      }
      if let current = model.current {
        Text(current.path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
      }
      if let previous = model.previous {
        Text(text.copy("回退目标：", "Rollback target: ") + previous.path)
          .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
      }
      if !model.available {
        Text(
          text.copy(
            "此候选构建保留独立链接入口。公开链接交接尚未在此发布版本中启用。",
            "This candidate retains its separate link scheme. Public-link handover is not enabled in this release.")
        )
        .font(.caption).foregroundStyle(.secondary)
      }
      HStack {
        Button(text.copy("刷新", "Refresh")) { model.refresh() }
        if model.available {
          Button(text.copy("使用此原生版…", "Use This Native App…")) { Task { await model.change(.adopt) } }
          if model.previous != nil {
            Button(text.copy("恢复原应用…", "Restore Previous App…")) { Task { await model.change(.restore) } }
          }
        }
        if model.busy { ProgressView().controlSize(.small) }
      }.disabled(model.busy)
      if let message = model.message { Text(message).font(.caption) }
      if let error = model.error { NativeErrorView(message: error) }
    }.onAppear { model.refresh() }
  }
}
