import AppKit
import CraftHubMacCore
import SwiftUI
import UniformTypeIdentifiers

struct EnvironmentProfileView: View {
  @Bindable var model: EnvironmentProfileModel
  let openSoftware: () -> Void
  let openConfiguration: (String) -> Void
  @State private var importing: ImportRequest?
  private var text: L10n { L10n.text }
  private struct ImportRequest: Identifiable {
    let id = UUID()
    let json: String
    let revision: String
  }
  var body: some View {
    List {
      Section {
        Text(
          text.copy(
            "保存软件与配置来源的引用，在另一台 Mac 导入并检查差异。方案不包含配置文件内容、凭据、本机路径或执行信任。",
            "Save software and configuration references to import and review on another Mac. Profiles exclude configuration contents, credentials, machine paths and execution trust."
          )
        )
        .foregroundStyle(.secondary)
        HStack {
          Button(text.copy("重新读取", "Reload")) { Task { await model.load(force: true) } }
          Button(text.copy("检查已保存方案", "Check Saved Profile")) { Task { await model.check() } }
            .disabled(model.snapshot == nil || model.stale || model.uncertain)
          if model.busy { ProgressView().controlSize(.small) }
        }.disabled(model.busy)
        if let error = model.error { NativeErrorView(message: error) }
        if let error = model.fileError { NativeErrorView(message: error) }
        if model.stale || model.uncertain {
          Text(
            text.copy(
              "当前状态需要重新读取。上次检查结果不能用于确认就绪。",
              "Reload the current state. Previous observations cannot establish readiness.")
          )
          .foregroundStyle(.secondary)
        }
        if let notice = model.notice { Text(notice).foregroundStyle(.secondary) }
      }
      if model.snapshot != nil {
        Section(text.copy("我的环境方案", "My Environment Profile")) {
          TextField(text.copy("方案名称", "Profile Name"), text: $model.name).disabled(model.busy)
          TextField(text.copy("搜索软件", "Search Software"), text: $model.search)
          DisclosureGroup(text.copy("选择软件", "Choose Software") + " · \(model.selectedSoftware.count)/50") {
            ForEach(
              model.allSoftware.filter {
                model.search.isEmpty
                  || $0.title.localized(chinese: text.chinese).localizedStandardContains(model.search)
              }
            ) { item in
              Toggle(isOn: selection(item.id, values: $model.selectedSoftware)) {
                VStack(alignment: .leading) {
                  Text(item.title.localized(chinese: text.chinese))
                  Text(item.sourceId).font(.caption).foregroundStyle(.secondary)
                  if model.inventory?.software.contains(where: { $0.reference.id == item.id }) != true {
                    Text(text.copy("来源未连接；可取消选择后保存", "Source unavailable; deselect to save")).font(.caption)
                      .foregroundStyle(.secondary)
                  }
                }
              }.toggleStyle(.checkbox).disabled(
                model.busy || (!model.selectedSoftware.contains(item.id) && model.selectedSoftware.count >= 50))
            }
          }
          DisclosureGroup(
            text.copy("选择已纳管配置", "Choose Managed Configuration") + " · \(model.selectedConfigurations.count)/100"
          ) {
            Text(
              text.copy(
                "仅能保存已与源同步的配置。请先审阅并保存本机修改到来源。",
                "Only synchronized configuration can be saved. Review and save local changes to the source first.")
            )
            .font(.caption).foregroundStyle(.secondary)
            if model.allConfigurations.isEmpty {
              Text(
                text.copy(
                  "当前没有可选配置，请先连接配置源并确认纳管范围。",
                  "No managed configuration is available. Connect a source and confirm ownership first."))
            }
            ForEach(model.allConfigurations) { item in
              let state = model.inventory?.configurations.first { $0.reference.id == item.id }?.status
              Toggle(isOn: selection(item.id, values: $model.selectedConfigurations)) {
                VStack(alignment: .leading) {
                  Text(item.title)
                  Text("\(item.kind) · \(item.origin) · \(state ?? text.copy("来源未连接", "Source unavailable"))").font(
                    .caption
                  ).foregroundStyle(.secondary)
                }
              }.toggleStyle(.checkbox).disabled(
                model.busy
                  || (!model.selectedConfigurations.contains(item.id)
                    && (state != "synced" || model.selectedConfigurations.count >= 100))
              )
            }
            if let unavailable = model.inventory?.unavailableIntegrations, !unavailable.isEmpty {
              Text(text.copy("暂时无法读取的来源：", "Unavailable sources: ") + unavailable.joined(separator: ", "))
                .foregroundStyle(.secondary)
            }
          }
          if model.draftRevision != model.snapshot?.revision {
            Text(
              text.copy(
                "已保存的方案发生变化。本地选择已保留，请核对后选择保存基准。",
                "The saved profile changed. Local choices are retained; review them before choosing a save baseline."))
            Button(text.copy("保留选择，采用最新版本", "Keep Choices and Use Latest Version")) {
              model.acceptCurrentRevision()
            }
            .disabled(model.busy || model.stale || model.uncertain)
          }
          HStack {
            Button(text.copy("保存方案", "Save Profile")) { Task { await model.save() } }.disabled(!model.canSave)
            Button(text.copy("恢复已保存的选择", "Use Saved Choices")) { model.useSavedChoices() }.disabled(model.busy)
            Button(text.copy("导出方案…", "Export Profile…"), action: exportProfile).disabled(
              model.snapshot?.profile == nil || model.busy)
          }
        }
        Section(text.copy("导入方案", "Import Profile")) {
          Text(
            text.copy(
              "粘贴或选择导出的 JSON，审阅后替换当前方案。导入完成后再检查这台 Mac。",
              "Paste or choose exported JSON, then review it to replace the current profile. Check this Mac after importing."
            )
          )
          .foregroundStyle(.secondary)
          TextEditor(text: $model.imported).font(.system(.caption, design: .monospaced)).frame(
            minHeight: 100, maxHeight: 180
          ).disabled(model.busy)
            .accessibilityLabel(text.copy("待导入的环境方案 JSON", "Environment Profile JSON to Import"))
          HStack {
            Button(text.copy("选择文件…", "Choose File…"), action: readImport).disabled(model.busy)
            Button(text.copy("审阅导入…", "Review Import…")) {
              if let revision = model.snapshot?.revision {
                importing = ImportRequest(json: model.imported, revision: revision)
              }
            }.disabled(
              model.busy || model.stale || model.uncertain
                || model.imported.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        }
      }
      if let setup = model.setup, !model.stale {
        EnvironmentSetupSections(
          snapshot: setup,
          disabled: model.busy || model.error != nil || setup.profileRevision != model.snapshot?.revision)
      }
      if let review = model.review, !model.stale {
        Section(text.copy("这台 Mac 的检查结果", "Results for This Mac")) {
          Text(
            text.copy(
              "安装与配置分别审阅。完成后请再次检查，以实际检测状态确认结果。",
              "Review installation and configuration separately. Check again afterward to verify actual state.")
          )
          .foregroundStyle(.secondary)
          ForEach(review.software, id: \.reference.id) { item in
            HStack {
              Text(item.reference.title.localized(chinese: text.chinese))
              Spacer()
              Text(resolution(item.state)).foregroundStyle(.secondary)
            }
          }
          ForEach(review.configurations, id: \.reference.id) { item in
            HStack {
              Text(item.reference.title)
              Spacer()
              Text(resolution(item.state)).foregroundStyle(.secondary)
              if item.state != "ready", let path = item.href, path.hasPrefix("/"), !path.hasPrefix("//"),
                let reviewPath = configurationReviewPath(path, itemId: item.reference.itemId)
              {
                Button(text.copy("审阅配置…", "Review Configuration…")) { openConfiguration(reviewPath) }
              }
            }
          }
          if review.software.contains(where: \.canInstall) {
            Button(text.copy("在软件中心审阅安装…", "Review Installation in Software…"), action: openSoftware)
          }
        }
      }
    }
    .listStyle(.inset)
    .nativePageListContent(.form)
    .task { await model.load() }
    .sheet(item: $importing) { request in
      VStack(alignment: .leading, spacing: 16) {
        Text(text.copy("替换已保存的环境方案", "Replace the Saved Environment Profile")).font(.title2.bold())
        Text(
          text.copy(
            "确认后只保存方案引用。软件安装与配置恢复仍需分别审阅。",
            "Confirmation saves profile references. Installation and configuration recovery require separate review."))
        ScrollView {
          Text(request.json).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(
            maxWidth: .infinity, alignment: .leading)
        }
        if let error = model.error { NativeErrorView(message: error) }
        HStack {
          Spacer()
          Button(text.copy("取消", "Cancel")) { importing = nil }.keyboardShortcut(.cancelAction)
          Button(text.copy("保存导入方案", "Save Imported Profile")) {
            Task { if await model.importProfile(json: request.json, revision: request.revision) { importing = nil } }
          }.disabled(model.uncertain || model.stale || request.revision != model.snapshot?.revision)
        }.disabled(model.busy)
      }.padding(24).frame(width: 640, height: 460).interactiveDismissDisabled(model.busy)
    }
  }
  private func configurationReviewPath(_ path: String, itemId: String) -> String? {
    guard var components = URLComponents(string: path) else { return nil }
    components.queryItems = [
      URLQueryItem(name: "scope", value: "global"),
      URLQueryItem(name: "setupItem", value: itemId),
    ]
    return components.string
  }
  private func selection(_ id: String, values: Binding<Set<String>>) -> Binding<Bool> {
    Binding(
      get: { values.wrappedValue.contains(id) },
      set: { selected in
        if selected { values.wrappedValue.insert(id) } else { values.wrappedValue.remove(id) }
      })
  }
  private func resolution(_ value: String) -> String {
    switch value {
    case "ready": text.copy("已就绪", "Ready")
    case "missing": text.copy("未检测到", "Not Detected")
    case "review": text.copy("待审阅配置", "Review Configuration")
    case "changed": text.copy("来源已变化，需重新审阅", "Source Changed; Review Again")
    case "unavailable": text.copy("待连接来源或重新检测", "Connect Source or Check Again")
    default: text.copy("检测结果未知", "Unknown")
    }
  }
  private func readImport() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.json]
    panel.allowsMultipleSelection = false
    guard panel.runModal() == .OK, let url = panel.url else { return }
    do {
      let file = try FileHandle(forReadingFrom: url)
      defer { try? file.close() }
      let data = try file.read(upToCount: 256 * 1024 + 1) ?? Data()
      guard data.count <= 256 * 1024, let content = String(data: data, encoding: .utf8) else {
        throw RuntimeAPIError.rejected(400, "Choose a UTF-8 JSON file no larger than 256 KiB.")
      }
      model.imported = content
      model.fileError = nil
    } catch { model.fileError = error.localizedDescription }
  }
  private func exportProfile() {
    guard let profile = model.snapshot?.profile else { return }
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.json]
    panel.nameFieldStringValue = "craft-hub-environment.json"
    guard panel.runModal() == .OK, let url = panel.url else { return }
    do {
      try profile.exported().write(to: url, options: .atomic)
      model.fileError = nil
    } catch { model.fileError = error.localizedDescription }
  }
}

private struct EnvironmentSetupSections: View {
  let snapshot: EnvironmentSetupSnapshot
  let disabled: Bool
  private var text: L10n { L10n.text }
  var body: some View {
    Section(text.copy("前置工具与配置来源", "Prerequisites and Sources")) {
      ForEach(snapshot.steps) { step in
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            Text(step.title.localized(chinese: text.chinese)).fontWeight(.medium)
            Spacer()
            Text(state(step.state)).foregroundStyle(.secondary)
          }
          Text(step.description.localized(chinese: text.chinese)).foregroundStyle(.secondary)
          if !step.dependsOn.isEmpty {
            Text(
              text.copy("依赖：", "Depends on: ")
                + step.dependsOn.map { id in
                  snapshot.steps.first { $0.id == id }?.title.localized(chinese: text.chinese) ?? id
                }.joined(separator: ", ")
            ).font(.caption).foregroundStyle(.secondary)
          }
          ForEach(Array(step.actions.enumerated()), id: \.offset) { _, action in
            if action.kind == "link", let path = action.url, let url = DesktopBridge.externalURL(path),
              url.scheme == "https"
            {
              Link(action.title.localized(chinese: text.chinese), destination: url)
            } else if action.kind == "copy", let command = action.text {
              DisclosureGroup(action.title.localized(chinese: text.chinese)) {
                Text(command).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                Button(text.copy("复制命令", "Copy Command")) {
                  NSPasteboard.general.clearContents()
                  NSPasteboard.general.setString(command, forType: .string)
                }.disabled(disabled || step.state == "blocked")
                Text(
                  text.copy(
                    "复制后请在终端自行审阅运行，返回这里重新检查。", "Review and run it in Terminal, then return here to check again.")
                ).font(.caption).foregroundStyle(.secondary)
              }
            }
          }
        }.padding(.vertical, 6)
      }
      Text(
        snapshot.prerequisitesReady && !disabled
          ? text.copy("前置条件已就绪；软件与配置仍需分别检查。", "Prerequisites are ready; software and configuration still need review.")
          : text.copy("按引导完成操作后重新检查。", "Check again after completing the guidance.")
      )
      .foregroundStyle(.secondary)
      LabeledContent(text.copy("检查时间", "Checked At"), value: snapshot.checkedAt)
    }
  }
  private func state(_ value: String) -> String {
    switch value {
    case "ready": text.copy("已就绪", "Ready")
    case "not-required": text.copy("无需操作", "Not Required")
    case "action-required": text.copy("需要操作", "Action Required")
    case "blocked": text.copy("等待前置步骤", "Waiting on Prerequisites")
    default: text.copy("未知", "Unknown")
    }
  }
}
