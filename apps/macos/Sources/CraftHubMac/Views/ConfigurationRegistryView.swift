import AppKit
import CraftHubMacCore
import SwiftUI

struct ConfigurationRegistryView: View {
  @Bindable var model: ConfigurationModel
  private var text: L10n { L10n.text }
  @State private var replace: Set<String> = []
  var body: some View {
    List {
      if let registry = model.page?.registry, registry.version == 1 {
        Section {
          Text(
            text.copy(
              "配置源和备份目标登记只保存在这台设备。移除登记保留仓库文件，不自动提交或发布。",
              "Registrations stay on this device. Removing one retains repository files and never commits or publishes."
            )
          )
          .foregroundStyle(.secondary)
          if !model.canManageRegistry {
            Text(
              text.copy(
                "请重新检查状态；只有提供方支持时才能修改登记。", "Inspect the current state; registration changes require provider support.")
            ).foregroundStyle(.secondary)
          }
          HStack {
            Button(text.copy("添加配置源…", "Add Source…")) { model.editRegistry(category: "source") }
            Button(text.copy("添加备份目标…", "Add Backup Target…")) { model.editRegistry(category: "target") }
          }.disabled(!model.canManageRegistry || model.registryDraft != nil)
        }
        if let draft = model.registryDraft {
          Section(text.copy("登记草稿", "Registration Draft")) {
            ConfigurationRegistryEditor(model: model, draft: draft)
          }
        }
        Section(text.copy("配置源", "Configuration Sources")) {
          if registry.sources.isEmpty { Text(text.copy("尚未登记配置源", "No sources registered")) }
          ForEach(registry.sources) { source in
            VStack(alignment: .leading, spacing: 8) {
              Text(source.name).fontWeight(.medium)
              Text(
                "\(source.id) · \(source.kind) · \(configurationAudience(source.audience)) · \(source.enabled ? text.copy("已启用", "Enabled") : text.copy("已停用", "Disabled"))"
              ).font(.caption).foregroundStyle(.secondary)
              Text(source.root).textSelection(.enabled)
              if let manifest = source.manifest { Text(manifest).font(.caption).textSelection(.enabled) }
              HStack {
                Button(text.copy("编辑…", "Edit…")) { model.editRegistry(category: "source", id: source.id) }.disabled(
                  model.registryDraft != nil)
                Button(source.enabled ? text.copy("审阅停用…", "Review Disable…") : text.copy("审阅启用…", "Review Enable…")) {
                  var value = source
                  value.enabled.toggle()
                  var change = ConfigurationRegistryMutation(action: "save-source", revision: registry.revision)
                  change.source = value
                  model.prepareRegistry(change)
                }
                Button(text.copy("审阅移除登记…", "Review Removal…")) {
                  remove(source.id, category: "source", revision: registry.revision)
                }
              }.disabled(!model.canManageRegistry)
            }.padding(.vertical, 6)
          }
        }
        Section(text.copy("备份目标", "Backup Targets")) {
          Text(
            text.copy(
              "个人与工作备份分别保存。备份读取配置源；恢复也写入配置源，之后另行审阅应用到本机。",
              "Keep personal and work backups separate. Backups read sources; restoration writes sources. Applying to this Mac requires a separate review."
            )
          ).foregroundStyle(.secondary)
          if registry.targets.isEmpty { Text(text.copy("尚未登记备份目标", "No backup targets registered")) }
          ForEach(registry.targets) { target in
            VStack(alignment: .leading, spacing: 8) {
              Text(target.name).fontWeight(.medium)
              Text("\(target.id) · \(configurationAudience(target.audience))").font(.caption).foregroundStyle(
                .secondary)
              if let root = target.root {
                Text(root + "/" + target.directory).textSelection(.enabled)
              } else {
                Text(text.copy("已预留；未创建仓库", "Reserved; no repository created")).foregroundStyle(.secondary)
              }
              if target.driver == "external" {
                Text(text.copy("由原应用管理备份与恢复", "Backup and recovery are managed by the original application"))
              } else {
                Text(target.sourceIds.joined(separator: ", ")).font(.caption).textSelection(.enabled)
                LabeledContent(
                  text.copy("口令变量名", "Passphrase Variable"), value: target.keyEnvironment ?? text.copy("未设置", "Not Set")
                )
                if target.root != nil {
                  Toggle(
                    text.copy("审阅替换其他设备修改过的备份", "Review Replacing a Backup Changed by Another Device"),
                    isOn: Binding(
                      get: { replace.contains(target.id) },
                      set: { if $0 { replace.insert(target.id) } else { replace.remove(target.id) } })
                  ).toggleStyle(.checkbox)
                  HStack {
                    Button(text.copy("预览加密备份…", "Preview Encrypted Backup…")) {
                      Task { await model.previewBackup(target, action: "save", replace: replace.contains(target.id)) }
                    }
                    Button(text.copy("预览恢复到配置源…", "Preview Restoration to Sources…")) {
                      Task { await model.previewBackup(target, action: "restore") }
                    }
                  }.disabled(!model.canPreviewBackup(target))
                }
              }
              HStack {
                Button(text.copy("编辑…", "Edit…")) { model.editRegistry(category: "target", id: target.id) }.disabled(
                  model.registryDraft != nil)
                Button(text.copy("审阅移除登记…", "Review Removal…")) {
                  remove(target.id, category: "target", revision: registry.revision)
                }
              }.disabled(!model.canManageRegistry)
            }.padding(.vertical, 6)
          }
        }
      } else {
        ContentUnavailableView(
          text.copy("配置登记不可用", "Configuration Registry Unavailable"), systemImage: "externaldrive",
          description: Text(
            text.copy(
              "此提供方未返回兼容的注册表。请更新本机工具后重新检查。",
              "This provider returned no compatible registry. Update the local tool and inspect again.")))
      }
    }.listStyle(.inset)
  }
  private func remove(_ id: String, category: String, revision: String) {
    var change = ConfigurationRegistryMutation(action: "remove-\(category)", revision: revision)
    change.id = id
    model.prepareRegistry(change)
  }
}

private struct ConfigurationRegistryEditor: View {
  let model: ConfigurationModel
  @Bindable var draft: ConfigurationRegistryDraft
  private var text: L10n { L10n.text }
  private var conflict: Bool { draft.revision != model.page?.registry?.revision || draft.entryID != model.entryID }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if conflict {
        Text(
          text.copy(
            "登记已变化。草稿已保留，请复制所需内容或从最新记录重新编辑。",
            "The registry changed. Your draft is retained; copy needed values or start again from the latest record.")
        ).foregroundStyle(.orange)
        Button(text.copy("从最新记录重新编辑", "Start Again from Latest Record")) {
          model.editRegistry(category: draft.category, id: draft.originalSource?.id ?? draft.originalTarget?.id)
        }.disabled(!model.canManageRegistry)
      }
      if draft.category == "source" { sourceForm } else { targetForm }
      HStack {
        Spacer()
        Button(text.copy("关闭草稿", "Close Draft")) { model.closeRegistryDraft() }
        Button(text.copy("审阅登记修改…", "Review Registration Changes…")) { model.reviewRegistryDraft() }.disabled(
          conflict || !model.canManageRegistry)
      }
    }.disabled(model.busy || model.loading)
  }
  private var sourceForm: some View {
    VStack(alignment: .leading, spacing: 10) {
      TextField(text.copy("来源标识", "Source ID"), text: $draft.source.id).disabled(draft.originalSource != nil)
      TextField(text.copy("名称", "Name"), text: $draft.source.name)
      directory(
        text.copy("已有本地 Git 仓库", "Existing Local Git Checkout"), value: $draft.source.root,
        locked: draft.originalSource != nil)
      Picker(text.copy("配置格式", "Configuration Format"), selection: $draft.source.kind) {
        Text("Dotfiles").tag("dotfiles")
        Text(text.copy("配置清单", "Overlay Manifest")).tag("overlay")
      }.disabled(draft.originalSource != nil)
      audience(value: $draft.source.audience, publicAllowed: true).disabled(
        draft.originalSource != nil && draft.originalSource?.audience != "unclassified")
      if draft.source.kind == "overlay" {
        TextField(text.copy("仓库内清单路径", "Manifest Path in Repository"), text: optional($draft.source.manifest)).disabled(
          draft.originalSource != nil)
      }
      Toggle(text.copy("启用配置源", "Enable Source"), isOn: $draft.source.enabled)
    }
  }
  private var targetForm: some View {
    VStack(alignment: .leading, spacing: 10) {
      TextField(text.copy("目标标识", "Target ID"), text: $draft.target.id).disabled(draft.originalTarget != nil)
      TextField(text.copy("名称", "Name"), text: $draft.target.name)
      directory(
        text.copy("本地 Git 仓库，留空预留", "Local Git Checkout; Leave Empty to Reserve"), value: optional($draft.target.root),
        locked: draft.originalTarget?.root != nil)
      TextField(text.copy("仓库内目录", "Directory in Repository"), text: $draft.target.directory).disabled(
        draft.originalTarget != nil)
      audience(value: $draft.target.audience, publicAllowed: false).disabled(draft.originalTarget != nil)
      Picker(text.copy("同步方式", "Sync Method"), selection: $draft.target.driver) {
        Text(text.copy("提供方加密备份", "Provider Encrypted Backup")).tag("workstation")
        Text(text.copy("由原应用管理", "Managed by Original Application")).tag("external")
      }.disabled(draft.originalTarget != nil)
      if draft.target.driver == "workstation" {
        TextField(
          text.copy("口令环境变量名称", "Passphrase Environment Variable Name"), text: optional($draft.target.keyEnvironment))
        Text(
          text.copy(
            "此处只保存变量名。由密钥管理器在启动应用时提供 CRAFT_HUB_BACKUP_KEY_ 开头的变量；原生宿主只透传这个专用前缀。",
            "Only the variable name is saved. Have your secret manager supply a CRAFT_HUB_BACKUP_KEY_ variable when launching the app; the native host forwards only that dedicated prefix."
          )
        ).font(.caption).foregroundStyle(.secondary)
        ForEach(
          (model.page?.registry?.sources ?? []).filter {
            model.eligibleBackupSources(draft.target.audience).contains($0.id)
          }
        ) { source in
          Toggle(
            source.name + " · " + configurationAudience(source.audience),
            isOn: Binding(
              get: { draft.target.sourceIds.contains(source.id) },
              set: { selected in
                draft.target.sourceIds.removeAll { $0 == source.id }
                if selected { draft.target.sourceIds.append(source.id) }
              })
          ).toggleStyle(.checkbox)
        }
        Text(text.copy("更改内容范围会在审阅时移除不兼容的来源。", "Changing the scope removes incompatible sources from the review."))
          .font(.caption).foregroundStyle(.secondary)
      }
    }
  }
  private func optional(_ value: Binding<String?>) -> Binding<String> {
    Binding(get: { value.wrappedValue ?? "" }, set: { value.wrappedValue = $0 })
  }
  private func audience(value: Binding<String>, publicAllowed: Bool) -> some View {
    Picker(text.copy("内容范围", "Content Scope"), selection: value) {
      if publicAllowed { Text(configurationAudience("public")).tag("public") }
      Text(configurationAudience("personal")).tag("personal")
      Text(configurationAudience("work")).tag("work")
      if value.wrappedValue == "unclassified" { Text(configurationAudience("unclassified")).tag("unclassified") }
    }
  }
  private func directory(_ title: String, value: Binding<String>, locked: Bool) -> some View {
    HStack {
      TextField(title, text: value)
      Button(text.copy("选择…", "Choose…")) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url { value.wrappedValue = url.path }
      }
    }.disabled(locked)
  }
}

struct ConfigurationRegistryReviewView: View {
  let model: ConfigurationModel
  let review: ConfigurationModel.RegistryReview
  private var text: L10n { L10n.text }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(text.copy("确认登记修改", "Confirm Registration Changes")).font(.title2.bold())
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          if let source = review.mutation.source {
            LabeledContent(text.copy("配置源", "Source"), value: source.name + " · " + source.id)
            LabeledContent(text.copy("仓库", "Checkout"), value: source.root)
            LabeledContent(text.copy("格式", "Format"), value: source.kind)
            LabeledContent(text.copy("内容范围", "Scope"), value: configurationAudience(source.audience))
            if let manifest = source.manifest { Text(manifest).textSelection(.enabled) }
            Text(
              source.enabled ? text.copy("启用此配置源", "Enable This Source") : text.copy("停用此配置源", "Disable This Source"))
          } else if let target = review.mutation.target {
            LabeledContent(text.copy("备份目标", "Backup Target"), value: target.name + " · " + target.id)
            LabeledContent(
              text.copy("仓库", "Checkout"),
              value: target.root ?? text.copy("仅预留，不创建仓库", "Reserve Only; Create No Repository"))
            LabeledContent(text.copy("目录", "Directory"), value: target.directory)
            LabeledContent(text.copy("内容范围", "Scope"), value: configurationAudience(target.audience))
            LabeledContent(
              text.copy("同步方式", "Sync Method"),
              value: target.driver == "external"
                ? text.copy("由原应用管理", "Original Application") : text.copy("提供方加密备份", "Provider Encrypted Backup"))
            if let name = target.keyEnvironment {
              LabeledContent(text.copy("口令变量名", "Passphrase Variable"), value: name)
            }
            ForEach(target.sourceIds, id: \.self) { Text($0) }
          } else if review.mutation.action == "claim" {
            Text(text.copy("选择配置来源归属", "Choose Configuration Owner"))
            Text(review.mutation.resource ?? "").textSelection(.enabled)
            LabeledContent(text.copy("来源", "Source"), value: review.mutation.sourceId ?? "")
          } else {
            Text(
              review.mutation.action == "remove-source"
                ? text.copy("移除配置源登记", "Remove Source Registration")
                : text.copy("移除备份目标登记", "Remove Backup Target Registration"))
            Text(review.mutation.id ?? "")
          }
          Text(
            text.copy(
              "这只修改设备上的登记。配置应用、备份、恢复和 Git 发布仍需分别审阅；移除登记保留文件。",
              "This changes only device registrations. Application, backup, recovery and Git publishing require separate review; removing registrations retains files."
            )
          ).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
      }
      HStack {
        Spacer()
        Button(text.copy("取消", "Cancel")) { model.discardRegistryReview() }.keyboardShortcut(.cancelAction)
        Button(text.copy("确认修改登记", "Confirm Registration Changes")) { Task { await model.confirmRegistry(review) } }
          .disabled(!model.canConfirmRegistry(review))
      }
    }.padding(24).frame(width: 640, height: 460)
  }
}

@MainActor func configurationAudience(_ value: String) -> String {
  switch value {
  case "public": L10n.text.copy("公开", "Public")
  case "personal": L10n.text.copy("个人私有", "Personal Private")
  case "work": L10n.text.copy("工作私有", "Work Private")
  default: L10n.text.copy("待分类", "Unclassified")
  }
}
