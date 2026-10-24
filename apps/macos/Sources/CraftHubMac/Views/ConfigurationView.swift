import CraftHubMacCore
import SwiftUI

struct ConfigurationView: View {
  @Bindable var model: ConfigurationModel
  let openWeb: (String) -> Void
  @State private var restoring: RestoreReview?
  @State private var confirmRead = false
  private var text: L10n { L10n.text }
  private struct RestoreReview: Identifiable {
    let id = UUID()
    let record: ConfigurationPage.History
    let entry: String
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Picker(
          text.copy("配置提供方", "Configuration Provider"),
          selection: Binding(get: { model.entryID }, set: { value in Task { await model.select(value) } })
        ) {
          ForEach(model.entries) { entry in
            Text(entry.text(entry.view.title) + " · " + entry.contribution.id).tag(entry.id)
          }
        }.disabled(model.busy || model.loading || model.uncertain != nil)
        Spacer()
        if model.busy || model.loading { ProgressView().controlSize(.small) }
        Button(text.copy("重新检查", "Inspect Again")) {
          if model.entry?.read.effectiveConfirmation == "never" {
            Task { await model.refresh() }
          } else {
            confirmRead = true
          }
        }.disabled(model.entry == nil || model.busy || model.loading)
        if let path = model.entry?.path { Button(text.copy("完整管理…", "Full Management…")) { openWeb(path) } }
      }
      if let error = model.error { NativeErrorView(message: error) }
      if let notice = model.notice { Text(notice).foregroundStyle(.secondary).textSelection(.enabled) }
      if model.uncertain != nil {
        Text(
          text.copy(
            "操作结果尚未确认。请重新检查记录，之后才能继续操作。", "The result is unconfirmed. Inspect current records before continuing.")
        )
        .foregroundStyle(.secondary)
      } else if model.stale, model.page != nil {
        Text(
          text.copy(
            "配置状态可能已变化。重新检查会清除当前选择；已生成计划在应用时由提供方重新校验。",
            "Configuration may have changed. Inspecting clears current choices; the provider revalidates prepared plans on application."
          )
        )
        .font(.caption).foregroundStyle(.secondary)
      }
      if let page = model.page {
        if let support = page.operationSupport,
          support.state != "available" || support.operations["inspect"]?.supported != true
        {
          Text(
            support.message
              ?? text.copy(
                "配置提供方尚未支持读取，请刷新能力或更新本机工具。",
                "Configuration inspection is unavailable. Refresh capabilities or update the local tool.")
          )
          .foregroundStyle(.secondary)
        }
        Picker(text.copy("配置页面", "Configuration Page"), selection: $model.section) {
          Text(text.copy("配置审阅", "Configuration")).tag("configuration")
          Text(text.copy("应用与恢复记录", "History")).tag("history")
          Text(text.copy("仓库同步", "Repositories")).tag("repositories")
          Text(text.copy("来源与备份", "Sources & Backups")).tag("sources")
          Text(text.copy("Skills 审计", "Skills Audit")).tag("audit")
        }.pickerStyle(.segmented)
        if model.section == "sources" {
          ConfigurationRegistryView(model: model)
        } else if model.section == "history" {
          history(page)
        } else if model.section == "audit" {
          ConfigurationAuditView(page: page, translate: translate)
        } else if model.section == "repositories" {
          ConfigurationRepositoriesView(model: model)
        } else {
          configuration(page)
        }
      } else if !model.loading {
        ContentUnavailableView(
          text.copy("等待配置检查", "Configuration Not Inspected"), systemImage: "doc.text.magnifyingglass",
          description: Text(text.copy("选择配置提供方并读取其纳管范围。", "Select a provider and inspect its managed configuration.")))
        if model.entries.isEmpty {
          Button(text.copy("刷新提供方", "Refresh Providers")) {
            Task {
              await model.loadCatalog(force: true)
              await inspectIfAutomatic()
            }
          }
        }
      }
      if !model.catalogDiagnostics.isEmpty {
        DisclosureGroup(text.copy("提供方诊断", "Provider Diagnostics")) {
          ForEach(Array(model.catalogDiagnostics.enumerated()), id: \.offset) { _, diagnostic in
            Text(diagnostic.integrationId + ": " + diagnostic.message).font(.caption).textSelection(.enabled)
          }
        }
      }
    }.padding(.horizontal, 24).padding(.bottom, 16)
      .task {
        await model.loadCatalog()
        await inspectIfAutomatic()
      }
      .sheet(isPresented: Binding(get: { model.plan != nil }, set: { if !$0 { model.discardPlan() } })) {
        ConfigurationPlanView(model: model)
      }
      .sheet(item: Binding(get: { model.registryReview }, set: { if $0 == nil { model.discardRegistryReview() } })) {
        review in
        ConfigurationRegistryReviewView(model: model, review: review)
      }
      .sheet(item: $restoring) { request in
        VStack(alignment: .leading, spacing: 16) {
          Text(text.copy("从备份恢复配置", "Restore Configuration from Backup")).font(.title2.bold())
          Text(
            text.copy(
              "仅恢复应用后未再次修改的文件。提供方会保护后续修改，并检查此计划的当前状态。",
              "Only files unchanged since application can be restored. The provider protects later edits and checks the plan's current state."
            ))
          Text(request.record.planId).font(.caption.monospaced()).textSelection(.enabled)
          ScrollView {
            VStack(alignment: .leading) {
              ForEach(request.record.paths ?? [], id: \.self) { Text($0).textSelection(.enabled) }
            }
          }
          HStack {
            Spacer()
            Button(text.copy("取消", "Cancel")) { restoring = nil }.keyboardShortcut(.cancelAction)
            Button(text.copy("确认恢复", "Restore Reviewed Files")) {
              restoring = nil
              Task { await model.restore(request.record, entryID: request.entry) }
            }.disabled(!model.canRestore(request.record) || request.entry != model.entryID)
          }
        }.padding(24).frame(width: 620, height: 360)
      }
      .confirmationDialog(
        text.copy("此提供方要求确认后读取配置", "This Provider Requires Confirmation to Inspect Configuration"),
        isPresented: $confirmRead
      ) {
        Button(text.copy("确认读取", "Confirm Inspection")) { Task { await model.refresh(confirmed: true) } }
      }
  }
  private func inspectIfAutomatic() async {
    guard !Task.isCancelled, model.page == nil, model.entry?.read.effectiveConfirmation == "never" else { return }
    await model.refresh()
  }
  private func translate(_ value: String) -> String { model.entry?.text(value) ?? value }
  private func configuration(_ page: ConfigurationPage) -> some View {
    VStack(spacing: 10) {
      HStack {
        TextField(text.copy("搜索名称、路径或管理器", "Search Name, Path or Manager"), text: $model.search).textFieldStyle(
          .roundedBorder)
        Picker(text.copy("配置类型", "Kind"), selection: $model.kind) {
          Text(text.copy("全部类型", "All Kinds")).tag("all")
          ForEach(Array(Set(page.items.map(\.kind))).sorted(), id: \.self) { Text($0).tag($0) }
        }.frame(width: 150)
        Picker(text.copy("配置状态", "Status"), selection: $model.status) {
          Text(text.copy("全部状态", "All States")).tag("all")
          Text(text.copy("待审阅", "Needs Review")).tag("attention")
          ForEach(Array(Set(page.items.map(\.status))).sorted(), id: \.self) { Text(configurationLabel($0)).tag($0) }
        }.frame(width: 190)
      }
      HSplitView {
        List(selection: $model.selected) {
          ForEach(model.rows) { item in
            VStack(alignment: .leading, spacing: 5) {
              HStack {
                Text(translate(item.title)).fontWeight(.medium)
                if model.choices[item.id] != nil { Image(systemName: "checkmark") }
              }
              Text(configurationLabel(item.status)).font(.caption).foregroundStyle(.secondary)
              Text([item.client, item.scope, item.manager].compactMap { $0 }.joined(separator: " · ")).font(.caption)
                .foregroundStyle(.secondary)
            }.padding(.vertical, 4).tag(item.id)
          }
        }.listStyle(.inset).frame(minWidth: 190, idealWidth: 240, maxWidth: 320)
        if let item = model.selectedItem {
          detail(item, page: page).frame(minWidth: 380, maxWidth: .infinity)
        } else {
          ContentUnavailableView(text.copy("选择配置项", "Select Configuration"), systemImage: "doc.text").frame(
            minWidth: 380, maxWidth: .infinity)
        }
      }
      HStack {
        Text(
          text.copy("\(model.decisions.count) 项待处理 · 尚未修改文件", "\(model.decisions.count) selected · no files changed")
        ).foregroundStyle(.secondary)
        Spacer()
        Button(text.copy("清空选择", "Clear Choices")) { model.clearChoices() }.disabled(model.busy)
        Button(text.copy("预览所选修改…", "Preview Selected Changes…")) { Task { await model.preview() } }.disabled(
          !model.canPreview)
      }
    }
  }
  private func detail(_ item: ConfigurationPage.Item, page: ConfigurationPage) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        Text(translate(item.title)).font(.title2.bold())
        LabeledContent(
          text.copy("管理归属", "Ownership"), value: "\(item.owner) · \(item.origin) · \(item.manager ?? "unknown")")
        if let provenance = item.provenance {
          Text(translate(provenance.label)).foregroundStyle(.secondary)
          if let path = provenance.path { Text(path).font(.caption).textSelection(.enabled) }
        }
        if let management = item.management { Text(translate(management)).foregroundStyle(.secondary) }
        if let audience = item.audience {
          LabeledContent(text.copy("内容范围", "Content Scope"), value: configurationAudience(audience))
        }
        if item.status == "ownership-conflict", let sourceId = item.sourceId, let resource = item.resource,
          let registry = page.registry
        {
          Text(
            text.copy(
              "多个来源声明了同一配置。请选择相同内容范围内的归属，或在源清单中拆分声明。",
              "Several sources declare this configuration. Choose an owner within the same scope, or separate the declarations."
            ))
          Text((item.competingSources ?? []).joined(separator: ", ")).font(.caption)
          Button(text.copy("审阅归属于此来源…", "Review Ownership by This Source…")) {
            var change = ConfigurationRegistryMutation(action: "claim", revision: registry.revision)
            change.resource = resource
            change.sourceId = sourceId
            model.prepareRegistry(change)
          }.disabled(!model.canManageRegistry)
        }
        if page.writable(item.id) {
          Picker(
            text.copy("处理方式", "Resolution"),
            selection: Binding(
              get: { model.choices[item.id]?.choice ?? "skip" }, set: { model.choose(item, choice: $0) })
          ) {
            Text(text.copy("暂不处理", "Defer")).tag("skip")
            Text(text.copy("保留本机 → 更新源文件", "Keep Local → Update Source")).tag("local")
            Text(text.copy("使用源配置 → 更新本机", "Use Source → Update Local")).tag("source")
            Text(text.copy("按字段合并 → 更新双方", "Merge Fields → Update Both")).tag("merge")
          }.disabled(!model.canStage)
          if model.choices[item.id]?.choice == "merge" {
            ForEach(item.fields, id: \.self) { field in
              Picker(
                field,
                selection: Binding(
                  get: { model.choices[item.id]?.fields[field] ?? "" },
                  set: { model.chooseField(item, field: field, value: $0) })
              ) {
                Text(text.copy("请选择", "Choose Explicitly")).tag("")
                Text(text.copy("本机", "Local")).tag("local")
                Text(text.copy("源端", "Source")).tag("source")
              }.disabled(!model.canStage)
            }
          }
        } else {
          Text(text.copy("此项不可在这里写入，请通过所属管理工具处理。", "This item is not writable here. Use its owning tool."))
            .foregroundStyle(.secondary)
        }
        ConfigurationComparison(
          before: item.local, after: item.source, beforeTitle: item.localPath,
          afterTitle: item.sourcePath ?? text.copy("未连接来源", "No Connected Source"))
        Text(
          text.copy(
            "可识别的凭据由提供方隐藏；此处展示预览文本，可能与原文件格式不同。",
            "The provider hides recognizable credentials. Preview text may differ from the original file's format.")
        ).font(.caption).foregroundStyle(.secondary)
        ForEach(page.managementTools ?? []) { tool in
          if let url = DesktopBridge.externalURL(tool.url) { Link(translate(tool.title), destination: url) }
        }
      }.padding(16)
    }
  }
  private func history(_ page: ConfigurationPage) -> some View {
    List {
      if !page.supports("history") || page.history == nil {
        Text(text.copy("提供方未返回可用记录，无法确认当前操作状态。", "History is unavailable; operation state cannot be confirmed."))
          .foregroundStyle(.secondary)
      } else if page.history?.isEmpty == true {
        Text(text.copy("暂无应用记录", "No Application History"))
      }
      ForEach(page.history ?? []) { record in
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            Text(configurationLabel(record.state)).fontWeight(.medium)
            Spacer()
            Text(record.createdAt ?? "").foregroundStyle(.secondary)
          }
          Text(record.planId).font(.caption.monospaced()).textSelection(.enabled)
          ForEach(record.paths ?? [], id: \.self) { Text($0).font(.caption).textSelection(.enabled) }
          if let error = record.error { Text(translate(error)).foregroundStyle(.secondary) }
          if ["applied", "failed", "applying", "restoring"].contains(record.state) {
            Button(text.copy("审阅备份恢复…", "Review Backup Recovery…")) {
              restoring = RestoreReview(record: record, entry: model.entryID)
            }.disabled(!model.canRestore(record))
          }
        }.padding(.vertical, 8)
      }
    }.listStyle(.inset)
  }
}

struct ConfigurationComparison: View {
  let before: String
  let after: String
  let beforeTitle: String
  let afterTitle: String
  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      content(before, title: beforeTitle)
      Divider()
      content(after, title: afterTitle)
    }
  }
  private func content(_ value: String, title: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.caption.bold()).textSelection(.enabled)
      Text(value.isEmpty ? L10n.text.copy("（空）", "(Empty)") : value).font(.system(.caption, design: .monospaced))
        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .topLeading)
    }.frame(maxWidth: .infinity, alignment: .topLeading)
  }
}

private struct ConfigurationPlanView: View {
  let model: ConfigurationModel
  private var text: L10n { L10n.text }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(text.copy("审阅修改范围", "Review Modification Scope")).font(.title2.bold())
      Text(
        text.copy("仅修改计划列出的文件。提交和发布为独立操作。", "Only listed files will change. Commit and publish are separate actions."))
      if let plan = model.plan {
        ScrollView {
          VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(plan.changes.enumerated()), id: \.offset) { _, change in
              Text(change.path).fontWeight(.medium).textSelection(.enabled)
              Text(
                model.planPurpose == "backup-restore"
                  ? text.copy("加密备份 → 仓库配置源；尚未应用到本机", "Encrypted Backup → Repository Source; Not Applied to This Mac")
                  : configurationLabel(change.direction)
              ).foregroundStyle(.secondary)
              if change.deletion {
                Label(
                  text.copy(
                    "此文件将删除；提供方保留备份以便恢复。", "This file will be deleted; the provider retains a recovery backup."),
                  systemImage: "trash"
                ).foregroundStyle(.red)
              }
              ConfigurationComparison(
                before: change.before, after: change.after, beforeTitle: text.copy("修改前", "Before"),
                afterTitle: text.copy("修改后", "After"))
              Divider()
            }
            if plan.changes.isEmpty {
              Text(text.copy("无需修改文件，仅记录已审阅基线。", "No file changes; record the reviewed baseline."))
            }
          }
        }
      }
      HStack {
        Spacer()
        Button(text.copy("放弃预览", "Discard Preview")) { model.discardPlan() }.keyboardShortcut(.cancelAction)
        Button(text.copy("应用已审阅方案", "Apply Reviewed Plan")) { Task { await model.apply() } }.disabled(!model.canApply)
      }.disabled(model.busy)
    }.padding(24).frame(width: 760, height: 540).interactiveDismissDisabled(model.busy)
  }
}

@MainActor func configurationLabel(_ value: String) -> String {
  let text = L10n.text
  switch value {
  case "synced": return text.copy("已同步", "Synchronized")
  case "local-modified": return text.copy("本机修改", "Local Changes")
  case "source-modified": return text.copy("源端修改", "Source Changes")
  case "conflict": return text.copy("双方冲突", "Conflict")
  case "ownership-conflict": return text.copy("来源归属冲突", "Ownership Conflict")
  case "first-adoption": return text.copy("首次接管 · 无历史基线", "First Adoption · No Baseline")
  case "read-only": return text.copy("不可写", "Read Only")
  case "unmanaged": return text.copy("未纳管", "Unmanaged")
  case "error": return text.copy("扫描失败", "Scan Failed")
  case "applied": return text.copy("已应用", "Applied")
  case "restored": return text.copy("已恢复", "Restored")
  case "applying": return text.copy("应用未完成，请检查恢复", "Application Incomplete; Review Recovery")
  case "restoring": return text.copy("恢复未完成，可重新审阅", "Recovery Incomplete; Review Again")
  case "failed": return text.copy("失败，请检查恢复", "Failed; Review Recovery")
  case "to-local": return text.copy("源配置 → 本机文件", "Source → Local File")
  case "to-source": return text.copy("本机 → 仓库源文件", "Local → Repository Source")
  case "to-backup": return text.copy("配置源 → 加密备份", "Source → Encrypted Backup")
  default: return value
  }
}
