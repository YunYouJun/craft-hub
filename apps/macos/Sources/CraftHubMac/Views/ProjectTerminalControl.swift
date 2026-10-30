import CraftHubMacCore
import SwiftUI

/// A shared picker/open action for the project root and a command's runtime-derived working directory.
struct ProjectTerminalControl: View {
  @Bindable var model: ProjectTerminalModel
  let projectID: String?
  var capabilityID: String?
  private var text: L10n { .text }
  private var target: ProjectTerminalModel.Context? {
    projectID.map { .init(projectID: $0, capabilityID: capabilityID) }
  }
  private struct ReadIdentity: Hashable {
    let context: ProjectTerminalModel.Context?
    let connection: UUID
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 8) {
          picker
          openButton
          reloadButton
          if model.loading || model.opening { ProgressView().controlSize(.small) }
          Spacer(minLength: 0)
        }
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 8) {
            picker
            reloadButton
          }
          HStack(spacing: 8) {
            openButton
            if model.loading || model.opening { ProgressView().controlSize(.small) }
          }
        }
      }
      Text(
        capabilityID == nil
          ? text.copy(
            "打开项目目录并创建独立会话；不会运行项目命令或接管现有终端。",
            "Opens the project directory in a new session; no command runs or embedded session transfer.")
          : text.copy(
            "打开命令工作目录并创建独立会话；不会自动执行此命令或接管现有终端。",
            "Opens the command's working directory in a new session; no command runs or embedded session transfer.")
      ).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      if model.stale && !model.loading {
        Text(text.copy("终端应用信息尚未更新，请重新检测后打开。", "Terminal availability needs a refresh before opening."))
          .font(.caption).foregroundStyle(.secondary)
      }
      if model.unavailableSelection {
        Text(
          text.copy(
            "未检测到已选终端 \(ProjectTerminalModel.displayName(model.preferredApplication))，请选择其他应用或重新检测。",
            "The selected terminal \(ProjectTerminalModel.displayName(model.preferredApplication)) was not detected. Choose another app or reload."
          )
        ).font(.caption).foregroundStyle(.orange)
      } else if !model.stale && model.applications.isEmpty {
        Text(text.copy("未检测到可用终端，请安装后重新检测。", "No terminal application detected. Install one and reload."))
          .font(.caption).foregroundStyle(.secondary)
      }
      if let error = model.error { NativeErrorView(message: error) }
      if let notice = model.notice { Text(notice).font(.caption).foregroundStyle(.secondary) }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("project.external-terminal")
    .task(id: ReadIdentity(context: target, connection: model.loadIdentity)) {
      model.select(projectID: projectID, capabilityID: capabilityID)
      await model.load()
    }
  }

  private var picker: some View {
    Picker(
      text.copy("独立终端", "External Terminal"),
      selection: Binding(
        get: { model.preferredApplication }, set: { model.chooseApplication($0) })
    ) {
      if model.preferredApplication.isEmpty { Text(text.copy("选择终端", "Choose Terminal")).tag("") }
      if !model.preferredApplication.isEmpty, !model.selectionAvailable {
        Text(
          ProjectTerminalModel.displayName(model.preferredApplication)
            + (model.stale ? text.copy("（待检测）", " (Not Checked)") : text.copy("（未检测到）", " (Unavailable)"))
        )
        .tag(model.preferredApplication)
      }
      ForEach(model.applications, id: \.self) { application in
        Text(ProjectTerminalModel.displayName(application)).tag(application)
      }
    }.frame(maxWidth: 280).disabled(model.loading || model.opening)
      .accessibilityIdentifier("project.terminal-application")
  }

  private var openButton: some View {
    Button {
      if let target { Task { await model.open(target) } }
    } label: {
      Label(text.copy("在独立终端打开…", "Open in External Terminal…"), systemImage: "terminal")
    }.disabled(!model.canOpen || model.context != target)
      .accessibilityIdentifier("project.open-terminal")
  }

  private var reloadButton: some View {
    Button {
      Task { await model.load(force: true) }
    } label: {
      Image(systemName: "arrow.clockwise")
    }
    .help(text.copy("重新检测终端应用", "Reload Terminal Applications"))
    .accessibilityLabel(text.copy("重新检测终端应用", "Reload Terminal Applications"))
    .accessibilityIdentifier("project.reload-terminals")
    .disabled(model.loading || model.opening)
  }
}
