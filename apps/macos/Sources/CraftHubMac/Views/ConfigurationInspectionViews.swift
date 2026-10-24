import CraftHubMacCore
import SwiftUI

struct ConfigurationAuditView: View {
  let page: ConfigurationPage
  let translate: (String) -> String
  private var text: L10n { L10n.text }
  var body: some View {
    List {
      Text(
        text.copy(
          "只读检查 Skill 文件、元数据、重名项和纳管依赖。",
          "Read-only checks of Skill files, metadata, duplicate names and managed dependencies.")
      ).foregroundStyle(.secondary)
      if let audit = page.skillsAudit {
        if let checkedAt = audit.checkedAt { LabeledContent(text.copy("检查时间", "Checked At"), value: checkedAt) }
        if audit.state != "available" {
          Text(
            audit.state == "error"
              ? text.copy("审计失败，当前没有成功的审计结果。", "Audit failed; no successful result is available.")
              : text.copy("此提供方尚未支持 Skills 审计。", "Skills audit is unavailable from this provider."))
        } else {
          if let summary = audit.summary {
            LabeledContent(text.copy("Skill 文件", "Skill Files"), value: String(summary.skillFileCount))
            LabeledContent(
              text.copy("允许隐式调用", "Implicit Invocation Allowed"), value: String(summary.implicitSkillCount))
            LabeledContent(
              text.copy("仅显式调用", "Explicit Invocation Only"), value: String(summary.explicitOnlySkillCount))
            LabeledContent(
              text.copy("警告 / 错误", "Warnings / Errors"), value: "\(summary.warningCount) / \(summary.errorCount)")
          }
          if audit.findings.isEmpty { Text(text.copy("本次检查未返回问题。", "No findings were returned by this check.")) }
          ForEach(Array(audit.findings.enumerated()), id: \.offset) { _, finding in
            VStack(alignment: .leading, spacing: 6) {
              Label(
                translate(finding.message),
                systemImage: finding.severity == "error" ? "xmark.circle" : "exclamationmark.triangle")
              ForEach(finding.paths, id: \.self) { Text($0).font(.caption).textSelection(.enabled) }
              Text(finding.code).font(.caption).foregroundStyle(.secondary)
            }
          }
        }
        if let message = audit.message { Text(translate(message)).foregroundStyle(.secondary) }
      } else {
        Text(text.copy("提供方尚未返回审计，请更新本机工具后重新检查。", "No audit was returned. Update the local tool and inspect again."))
      }
    }.listStyle(.inset)
  }
}

struct ConfigurationRepositoriesView: View {
  let model: ConfigurationModel
  @State private var paths: [String: Set<String>] = [:]
  @State private var message = "chore(config): synchronize reviewed files"
  @State private var review: GitReview?
  private var text: L10n { L10n.text }
  private struct GitReview: Identifiable {
    let id = UUID()
    let entry: String
    let command: ConfigurationCommand
    let root: String
    let diff: String
    let outgoing: [String]
  }
  var body: some View {
    List {
      Text(
        text.copy(
          "拉取、提交和发布分别审阅。此处操作仓库；本机配置应用是独立步骤。",
          "Review fetch, commit and publish separately. These operations affect repositories; applying local configuration is a separate step."
        )
      ).foregroundStyle(.secondary)
      if model.page?.supports("git-status") != true || model.page?.repositories == nil {
        Text(text.copy("当前无法读取仓库状态。", "Repository status is unavailable."))
      }
      ForEach(model.page?.repositories ?? []) { repository in
        Section(repository.id) {
          Text(repository.root).textSelection(.enabled)
          if let error = repository.error {
            Text(model.entry?.text(error) ?? error).foregroundStyle(.secondary)
          } else {
            LabeledContent(text.copy("分支", "Branch"), value: repository.branch ?? text.copy("未知", "Unknown"))
            LabeledContent(
              text.copy("领先 / 落后", "Ahead / Behind"),
              value: "\(repository.ahead.map(String.init) ?? "?") / \(repository.behind.map(String.init) ?? "?")")
            if repository.diverged == true {
              Text(text.copy("分支已分叉，请核对后同步。", "The branch has diverged. Review before synchronizing."))
            }
            DisclosureGroup(text.copy("审阅待提交文件", "Review Commit Paths")) {
              ForEach(repository.paths ?? [], id: \.path) { file in
                Toggle(
                  "\(file.status)  \(file.path)",
                  isOn: Binding(
                    get: { paths[repository.id, default: []].contains(file.path) },
                    set: { chosen in
                      if chosen {
                        paths[repository.id, default: []].insert(file.path)
                      } else {
                        paths[repository.id]?.remove(file.path)
                      }
                    })
                ).toggleStyle(.checkbox)
              }
              if let diff = repository.workingDiff {
                Text(diff).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
              }
              TextField(text.copy("提交说明", "Commit Message"), text: $message)
            }.disabled(model.busy || model.loading)
            HStack {
              ForEach(["fetch", "commit", "publish"], id: \.self) { action in
                Button(actionLabel(action)) { prepare(repository, action: action) }.disabled(
                  !canReview(repository, action: action))
              }
            }
          }
        }
      }
    }.listStyle(.inset)
      .sheet(item: $review) { request in
        VStack(alignment: .leading, spacing: 16) {
          Text(actionLabel(request.command.action ?? "")).font(.title2.bold())
          Text(request.root).textSelection(.enabled)
          Text(
            text.copy(
              "此操作影响仓库状态。本机配置需单独应用。", "This operation affects repository state. Apply local configuration separately."))
          ScrollView {
            VStack(alignment: .leading, spacing: 12) {
              ForEach(request.command.paths ?? [], id: \.self) { Text($0).textSelection(.enabled) }
              if request.command.action == "commit" { Text(request.command.message ?? "").fontWeight(.medium) }
              if request.command.action == "publish" {
                Text(text.copy("发布全部已审阅的待推送提交：", "Publish all reviewed outgoing commits: "))
                ForEach(request.outgoing, id: \.self) { Text($0).textSelection(.enabled) }
              }
              Text(request.diff).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
            }.frame(maxWidth: .infinity, alignment: .leading)
          }
          if let error = model.error { NativeErrorView(message: error) }
          HStack {
            Spacer()
            Button(text.copy("取消", "Cancel")) { review = nil }.keyboardShortcut(.cancelAction)
            Button(text.copy("确认仓库操作", "Confirm Repository Operation")) {
              Task { if await model.git(request.command, entryID: request.entry) { review = nil } }
            }.disabled(
              model.uncertain != nil || request.entry != model.entryID
                || model.page?.supports("git-\(request.command.action ?? "")") != true)
          }.disabled(model.busy || model.loading)
        }.padding(24).frame(width: 700, height: 500).interactiveDismissDisabled(model.busy)
      }
  }
  private func selectedPaths(_ repository: ConfigurationPage.Repository) -> [String] {
    (repository.paths ?? []).map(\.path).filter { paths[repository.id, default: []].contains($0) }
  }
  private func canReview(_ repository: ConfigurationPage.Repository, action: String) -> Bool {
    !model.busy && !model.loading && !model.stale && model.uncertain == nil && model.entry?.execute != nil
      && repository.revision != nil
      && model.page?.supports("git-\(action)") == true
      && (action != "commit"
        || (!selectedPaths(repository).isEmpty && !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
      && (action != "publish" || (repository.outgoing != nil && repository.outgoingDiff != nil))
  }
  private func prepare(_ repository: ConfigurationPage.Repository, action: String) {
    guard canReview(repository, action: action) else { return }
    var command = ConfigurationCommand(operation: "git-action")
    command.action = action
    command.repository = repository.id
    command.revision = repository.revision
    command.paths = action == "commit" ? selectedPaths(repository) : []
    command.message = action == "commit" ? message : ""
    review = GitReview(
      entry: model.entryID, command: command, root: repository.root,
      diff: action == "publish"
        ? repository.outgoingDiff ?? "" : action == "commit" ? repository.workingDiff ?? "" : "",
      outgoing: repository.outgoing ?? [])
  }
  private func actionLabel(_ value: String) -> String {
    switch value {
    case "fetch": text.copy("审阅拉取…", "Review Fetch…")
    case "commit": text.copy("审阅提交…", "Review Commit…")
    default: text.copy("审阅发布…", "Review Publish…")
    }
  }
}
