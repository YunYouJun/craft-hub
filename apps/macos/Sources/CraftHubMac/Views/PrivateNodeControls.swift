import CraftHubMacCore
import SwiftUI

struct PrivateNodeControls: View {
  let sidecar: RuntimeSidecar
  @State private var confirmDownload = false
  @State private var confirmRollback = false
  private var model: PrivateNodeModel { sidecar.privateNode }
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let installed = model.installed {
        LabeledContent(text.copy("私有 Node", "Private Node"), value: installed.current.version)
      }
      if model.busy {
        ProgressView(value: model.fraction).frame(maxWidth: 320)
        HStack {
          Text(model.status ?? "").font(.caption)
          Button(text.copy("取消下载", "Cancel")) { model.cancel() }
        }
      } else {
        HStack {
          Button(text.copy("下载私有 Node…", "Download Private Node…")) { confirmDownload = true }.disabled(
            sidecar.readingLoginPath)
          if model.installed?.previous != nil {
            Button(text.copy("恢复上一私有版本…", "Restore Previous Version…")) { confirmRollback = true }
          }
        }
        if let status = model.status { Text(status).font(.caption).foregroundStyle(.secondary) }
      }
      if let error = model.error { NativeErrorView(message: error) }
    }
    .confirmationDialog(
      text.copy("下载 Craft Hub 专用 Node？", "Download Private Node for Craft Hub?"), isPresented: $confirmDownload,
      titleVisibility: .visible
    ) {
      Button(text.copy("下载并校验", "Download and Verify")) { sidecar.downloadPrivateNode() }
    } message: {
      Text(
        text.copy(
          "从 nodejs.org 下载 Node \(model.release.version)（\(model.release.architecture)），校验后安装至 Craft Hub 私有目录。本机已有的兼容 Node 仍优先；当前运行时不会被中断。",
          "Download Node \(model.release.version) (\(model.release.architecture)) from nodejs.org, verify it, and install it privately for Craft Hub. Compatible Node installations on this Mac still take priority. The running runtime stays open."
        ))
    }
    .confirmationDialog(
      text.copy("恢复上一私有版本？", "Restore Previous Private Version?"), isPresented: $confirmRollback,
      titleVisibility: .visible
    ) {
      Button(text.copy("恢复", "Restore")) { Task { await model.rollback() } }
    } message: {
      Text(
        text.copy(
          "下一次启动时生效。当前运行时继续运行；本机已有 Node 和手动设置优先。",
          "Applies on the next launch. The running runtime stays open; machine installations and explicit preferences take priority."
        ))
    }
  }
}
