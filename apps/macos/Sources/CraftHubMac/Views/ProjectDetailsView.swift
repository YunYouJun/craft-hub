import CraftHubMacCore
import SwiftUI

/// Project inspection and command review are native; other project workflows retain an explicit complete-page entry.
struct ProjectDetailsView: View {
  @Bindable var model: ProjectDetailsModel
  var externalTerminal: ProjectTerminalModel?
  let findRequest: Int
  let back: () -> Void
  let openWeb: (String, String?) -> Void
  var openCommand: ((String, String) -> Void)?
  @FocusState private var searchFocused: Bool
  private var text: L10n { L10n.text }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          Button(action: back) { Label(text.copy("项目列表", "Projects"), systemImage: "chevron.left") }
          Spacer()
          DelayedLoadingFeedback(
            active: model.loading && model.snapshot != nil,
            label: text.copy("正在刷新项目与能力", "Refreshing project and capabilities")
          ) {
            ProgressView().controlSize(.small)
          }.frame(width: 16, height: 16)
          Button(text.copy("完整项目…", "Full Project…")) {
            if let id = model.projectID { openWeb(id, nil) }
          }.disabled(model.projectID == nil)
          Button(text.reload) { Task { await model.load(force: true) } }.disabled(model.loading)
        }
        if let externalTerminal {
          ProjectTerminalControl(model: externalTerminal, projectID: model.projectID)
        }
      }.padding(.horizontal, NativePageLayout.horizontalInset).padding(.vertical)
      if let error = model.error {
        NativeErrorView(message: error).padding(.horizontal, NativePageLayout.horizontalInset)
      }
      if let snapshot = model.snapshot {
        ScrollView {
          VStack(alignment: .leading, spacing: 18) {
            projectHeader(snapshot)
            if model.stale {
              Text(
                text.copy(
                  "正在显示上次读取的信息，重新读取后再审阅能力。", "Showing previous observations. Reload before reviewing capabilities.")
              )
              .foregroundStyle(.secondary)
            }
            if !snapshot.discovery.diagnostics.isEmpty {
              GroupBox(text.copy("发现提示", "Discovery Notices")) {
                VStack(alignment: .leading, spacing: 8) {
                  ForEach(Array(snapshot.discovery.diagnostics.enumerated()), id: \.offset) { _, notice in
                    VStack(alignment: .leading, spacing: 3) {
                      Text(notice.message)
                      Text("\(notice.source) · \(notice.path)").font(.caption).foregroundStyle(.secondary)
                    }
                  }
                }.frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
              }
            }
            capabilities(snapshot)
          }.nativePageContent().padding(.bottom, 20)
        }
      } else if model.error == nil {
        DelayedLoadingFeedback(
          active: true, label: text.copy("正在读取项目与能力", "Reading project and capabilities")
        ) {
          ProjectDetailsSkeleton()
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      } else {
        ContentUnavailableView(
          text.copy("项目暂不可用", "Project Unavailable"), systemImage: "folder.badge.questionmark",
          description: Text(text.copy("返回项目列表或重新读取。", "Return to Projects or reload."))
        )
        .nativePageContent(.emptyState)
      }
    }
    .searchable(text: $model.search, prompt: text.copy("搜索命令、技能或来源", "Search commands, skills or sources"))
    .searchFocused($searchFocused)
    .onChange(of: findRequest) { searchFocused = true }
    .onChange(of: model.kind) { _, kind in if kind == "skill" { model.packagePath = "" } }
    .task(id: model.loadIdentity) { await model.load() }
  }

  private func projectHeader(_ snapshot: ProjectDetails) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Label(snapshot.project.name, systemImage: "folder").font(.title2)
        Spacer()
        Text(
          snapshot.project.trust == "trusted"
            ? text.copy("已信任", "Trusted")
            : snapshot.project.trust == "untrusted"
              ? text.copy("未信任", "Untrusted") : text.copy("信任状态未知", "Unknown Trust")
        )
        .foregroundStyle(.secondary)
      }
      Text(snapshot.project.path).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
      if let description = snapshot.discovery.packages.first(where: \.root)?.description, !description.isEmpty {
        Text(description).textSelection(.enabled)
      }
      Text(
        text.copy(
          "查看不会授予信任或执行命令。选择命令后，可在原生页面审阅参数并确认运行。",
          "Viewing does not grant trust or execute commands. Select a command to review its inputs and confirm a run."
        )
      )
      .font(.caption).foregroundStyle(.secondary)
    }
  }

  private func capabilities(_ snapshot: ProjectDetails) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(text.copy("项目能力", "Project Capabilities")).font(.headline)
        Text("\(model.filtered.count) / \(snapshot.discovery.capabilities.count)").foregroundStyle(.secondary)
        Spacer()
        Picker(text.copy("类型", "Kind"), selection: $model.kind) {
          Text(text.copy("全部", "All")).tag("all")
          Text(text.copy("命令", "Commands")).tag("command")
          Text(text.copy("技能", "Skills")).tag("skill")
        }.fixedSize()
        if !snapshot.discovery.packages.isEmpty {
          Picker(text.copy("包", "Package"), selection: $model.packagePath) {
            Text(text.copy("全部包与技能", "All Packages and Skills")).tag("")
            ForEach(snapshot.discovery.packages) { package in
              Text(package.name ?? package.relativePath).tag(package.relativePath)
            }
          }.frame(maxWidth: 220)
        }
      }
      if model.filtered.isEmpty {
        Text(
          text.copy(
            "当前范围没有匹配能力。发现提示可能影响结果，可在完整项目中进一步查看。",
            "No capabilities match this scope. Discovery notices may affect the result; inspect the full project for more details."
          )
        )
        .foregroundStyle(.secondary)
      }
      LazyVStack(alignment: .leading, spacing: 0) {
        ForEach(model.filtered) { capability in
          capabilityRow(capability)
          Divider()
        }
      }
    }
  }

  private func capabilityRow(_ capability: ProjectDetails.Capability) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Image(
        systemName: capability.kind == "command"
          ? "terminal" : capability.kind == "skill" ? "sparkles" : "puzzlepiece.extension"
      )
      .frame(width: 20).foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 4) {
        Text(capability.name).font(.body.weight(.medium))
        if let description = capability.description { Text(description).foregroundStyle(.secondary) }
        Text([capability.source, capability.packagePath].compactMap { $0 }.joined(separator: " · "))
          .font(.caption).foregroundStyle(.secondary)
        if capability.availability?.available == false {
          Text(
            capability.availability?.diagnostic
              ?? text.copy("当前不可用，请在完整页面查看原因。", "Currently unavailable. Inspect the full page for details.")
          )
          .font(.caption).foregroundStyle(.secondary)
        }
        if !capability.supportsReview {
          Text(text.copy("此能力类型请在完整项目中查看。", "Inspect this capability kind in the full project."))
            .font(.caption).foregroundStyle(.secondary)
        }
      }.textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
      if capability.supportsReview {
        Button(text.copy("查看与审阅…", "Inspect and Review…")) {
          if let id = model.projectID {
            if capability.kind == "command", let openCommand {
              openCommand(id, capability.id)
            } else {
              openWeb(id, capability.id)
            }
          }
        }.disabled(!model.canReview)
      }
    }.padding(.vertical, 12)
  }
}
