import AppKit
import CraftHubMacCore
import SwiftUI

struct IntegrationWorkbenchView: View {
  @Bindable var model: IntegrationWorkbenchModel
  let projects: [PaletteProject]
  let findRequest: Int
  let openWeb: (String) -> Void
  let openConfiguration: (String) -> Void
  @FocusState private var searchFocused: Bool
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(text.copy("插件工作台", "Plugin Workbenches")).font(.largeTitle.bold())
        Spacer()
        if model.loadingCatalog || model.refreshing || model.busy { ProgressView().controlSize(.small) }
        Button(text.copy("重新读取", "Reload")) {
          Task {
            await model.loadCatalog(force: true)
            await model.refresh()
          }
        }
        .disabled(model.busy || model.loadingCatalog || model.refreshing)
        Button(text.copy("完整工作台…", "All Workbenches…")) { openWeb("/workbenches") }
      }
      HStack {
        TextField(text.copy("搜索插件工作台", "Search Plugin Workbenches"), text: $model.search)
          .textFieldStyle(.roundedBorder).focused($searchFocused)
        Picker(
          text.copy("工作台", "Workbench"),
          selection: Binding(get: { model.entryID }, set: { id in Task { await model.select(id) } })
        ) {
          Text(text.copy("选择工作台", "Choose Workbench")).tag("")
          ForEach(model.entries) { entry in Text(entry.text(entry.view.title)).tag(entry.id) }
        }.disabled(!model.canChangeContext).frame(maxWidth: 350)
      }
      if let error = model.error { NativeErrorView(message: error) }
      if let notice = model.notice { Text(notice).foregroundStyle(.secondary) }
      if model.uncertain != nil {
        Text(
          text.copy(
            "操作结果尚未确认。请重新读取当前配置并核对后再操作。",
            "The operation outcome is uncertain. Reload and review the current configuration before continuing.")
        )
        .foregroundStyle(.secondary)
      }
      if let entry = model.entry, model.search.isEmpty {
        HStack {
          Text(entry.text(entry.view.title)).font(.title2)
          Spacer()
          if entry.view.scope != "global" {
            Picker(
              text.copy("作用域", "Scope"),
              selection: Binding(
                get: { model.projectID }, set: { project in Task { await model.select(entry.id, project: project) } })
            ) {
              Text(text.copy("全局", "Global")).tag("")
              ForEach(projects) { Text($0.name).tag($0.id) }
            }.disabled(!model.canChangeContext).frame(maxWidth: 320)
          }
          Button(text.copy("完整页面…", "Full Page…")) { openWeb(webPath(entry)) }
        }
        if model.requiresProject {
          ContentUnavailableView(text.copy("请选择一个项目", "Choose a Project"), systemImage: "folder")
        } else {
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
              ForEach(entry.view.blocks, id: \.id) { block in
                blockView(entry, block: block, state: model.state(block))
              }
            }.padding(.bottom)
          }
        }
      } else {
        List(model.visibleEntries) { entry in
          Button {
            Task { await model.select(entry.id) }
          } label: {
            HStack {
              Label(entry.text(entry.view.title), systemImage: "puzzlepiece.extension")
              Spacer()
              Text(entry.contribution.id).foregroundStyle(.secondary)
            }
          }.buttonStyle(.plain)
        }
      }
      ForEach(Array(model.diagnostics.enumerated()), id: \.offset) { _, diagnostic in
        Text(diagnostic.integrationId + ": " + diagnostic.message).font(.caption).foregroundStyle(.secondary)
      }
    }.padding(24).task { await model.loadCatalog() }
      .onChange(of: findRequest) { searchFocused = true }
      .sheet(
        isPresented: Binding(get: { model.forms.isPresented }, set: { if !$0 { model.forms.close() } }),
        onDismiss: {
          Task { await model.refresh() }
        }
      ) {
        IntegrationFormView(model: model.forms, projects: projects) {
          if let entry = model.entry {
            let path = webPath(entry, project: model.forms.project)
            model.forms.close()
            openWeb(path)
          }
        }
      }
      .sheet(
        isPresented: Binding(get: { model.connections.isPresented }, set: { if !$0 { model.connections.close() } }),
        onDismiss: {
          Task { await model.refresh() }
        }
      ) {
        IntegrationConnectionView(model: model.connections, projects: projects)
      }
      .sheet(item: Binding(get: { model.review }, set: { if $0 == nil { model.cancelReview() } })) { review in
        VStack(alignment: .leading, spacing: 16) {
          Text(text.copy("确认修改插件配置", "Review Plugin Configuration")).font(.title2)
          Text(review.item.title).fontWeight(.semibold)
          Text(
            review.project.flatMap { id in projects.first { $0.id == id }?.name }
              ?? text.copy("全局配置", "Global Configuration"))
          Text(
            review.enabled.map { $0 ? text.copy("启用", "Enable") : text.copy("停用", "Disable") }
              ?? text.copy("恢复继承父级配置", "Inherit Parent Configuration"))
          Text(
            text.copy(
              "此变更只修改所选作用域的配置，现有任务可能需要重新打开。",
              "This changes configuration in the selected scope. Existing tasks may need to be reopened.")
          )
          .foregroundStyle(.secondary)
          HStack {
            Spacer()
            Button(text.copy("取消", "Cancel")) { model.cancelReview() }.keyboardShortcut(.cancelAction)
            Button(text.copy("确认保存", "Confirm Save")) { Task { await model.confirm(review) } }.keyboardShortcut(
              .defaultAction)
          }
        }.padding(24).frame(width: 470)
      }
  }
  private func webPath(_ entry: IntegrationWorkbenchModel.Entry) -> String {
    webPath(entry, project: model.project)
  }
  private func webPath(_ entry: IntegrationWorkbenchModel.Entry, project: String?) -> String {
    var components = URLComponents()
    components.path = entry.path
    components.queryItems =
      project.map { [.init(name: "project", value: $0)] } ?? [.init(name: "scope", value: "global")]
    return components.string ?? entry.path
  }
  @ViewBuilder private func blockView(
    _ entry: IntegrationWorkbenchModel.Entry, block: NativeIntegrationCatalog.Block, state: IntegrationBlockState
  ) -> some View {
    GroupBox {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          Text(entry.text(block.title ?? entry.action(block)?.title ?? block.id)).font(.headline)
          Spacer()
          if state.loading { ProgressView().controlSize(.small) }
          if model.readable(block) {
            Button(text.copy("刷新", "Refresh")) {
              Task { if block.type == "connection-status" { await model.refresh() } else { await model.read(block) } }
            }
            .disabled(state.loading || model.busy)
          }
        }
        if let description = block.description { Text(entry.text(description)).foregroundStyle(.secondary) }
        if let error = state.error { NativeErrorView(message: entry.text(error)) }
        if block.type == "action-form" {
          Button(text.copy("打开表单…", "Open Form…")) { Task { await model.openForm(block) } }.disabled(
            !model.canChangeContext)
        }
        if block.type == "resource-browser", model.readable(block) {
          IntegrationResourceBrowserView(model: model, block: block, state: state, projects: projects) { project in
            openWeb(webPath(entry, project: project))
          }
        }
        if let connection = state.connection {
          Label(
            connection.connected ? text.copy("已连接", "Connected") : text.copy("未连接", "Disconnected"),
            systemImage: connection.connected ? "checkmark.circle" : "link")
          if let account = connection.accountLabel { Text(account) }
          if let message = connection.message { Text(entry.text(message)).foregroundStyle(.secondary) }
          if let expires = connection.session?.expiresAt {
            Text(text.copy("授权到期：", "Authorization expires: ") + expires).font(.caption)
          }
          if state.stale { Text(text.copy("连接状态已过期，请刷新。", "Connection status is stale. Refresh to verify.")) }
          if model.canManageConnection(block) {
            Button(text.copy("管理连接…", "Manage Connection…")) { Task { await model.manageConnection(block) } }
              .disabled(!model.canChangeContext)
          } else {
            Button(text.copy("管理连接…", "Manage Connection…")) { openWeb(webPath(entry)) }
          }
        }
        if block.type == "entity-search" {
          HStack {
            TextField(
              text.copy("搜索来源内容", "Search Source"), text: Binding(get: { state.query }, set: { state.query = $0 })
            ).textFieldStyle(.roundedBorder)
            Button(text.copy("搜索", "Search")) {
              Task { await model.read(block, keyword: state.query.trimmingCharacters(in: .whitespacesAndNewlines)) }
            }.disabled(state.loading || model.busy)
          }
        }
        if let page = state.page {
          if block.type != "entity-search" {
            TextField(
              text.copy("筛选已加载内容", "Filter Loaded Items"),
              text: Binding(get: { state.query }, set: { state.query = $0 })
            ).textFieldStyle(.roundedBorder)
          }
          HStack {
            if block.statusFilter != nil {
              Toggle(
                text.copy("仅未完成", "Unfinished Only"),
                isOn: Binding(get: { state.activeOnly }, set: { state.activeOnly = $0 }))
            }
            if block.assigneeFilter != nil {
              Toggle(
                text.copy("仅与我相关", "Personal Only"),
                isOn: Binding(get: { state.personalOnly }, set: { state.personalOnly = $0 }))
            }
          }
          if state.personalOnly && page.currentUser == nil {
            Text(
              text.copy(
                "来源未提供当前账号身份；可取消“仅与我相关”查看已加载内容。",
                "The source did not identify the current account. Turn off Personal Only to view loaded items.")
            ).font(.caption).foregroundStyle(.secondary)
          }
          Text(
            page.nextCursor != nil || page.coverage == "partial"
              ? text.copy("已加载部分内容", "Partially Loaded")
              : page.coverage == "complete"
                ? text.copy("当前范围已完整读取", "Current Scope Fully Loaded")
                : text.copy("已加载内容，总范围未知", "Loaded Items; Total Coverage Unknown")
          ).font(.caption).foregroundStyle(.secondary)
          if state.stale || page.cache != nil {
            Text(
              text.copy(
                "显示缓存或上次读取结果，配置修改暂不可用。", "Showing cached or previous results; configuration changes are unavailable.")
            ).foregroundStyle(.secondary)
          }
          if let date = page.fetchedAt { Text(date).font(.caption).foregroundStyle(.secondary) }
          if state.visibleItems.isEmpty { Text(text.copy("没有匹配的内容", "No Matching Items")).foregroundStyle(.secondary) }
          ForEach(state.visibleItems, id: \.key) { item in
            VStack(alignment: .leading, spacing: 6) {
              HStack {
                Text(item.title).fontWeight(.medium)
                Spacer()
                if let status = item.statusLabel ?? item.status { Text(entry.text(status)).foregroundStyle(.secondary) }
                if let url = DesktopBridge.externalURL(item.url) {
                  Link(text.copy("打开原文", "Open Original"), destination: url)
                }
              }
              if let description = item.description { Text(description).font(.callout).foregroundStyle(.secondary) }
              if let details = item.details, !details.isEmpty {
                DisclosureGroup(text.copy("详情", "Details")) {
                  ForEach(Array(details.enumerated()), id: \.offset) { _, detail in
                    LabeledContent(entry.text(detail.label), value: entry.text(detail.value))
                  }
                }.font(.callout)
              }
              if let toggle = item.configurationToggle {
                HStack {
                  Button(toggle.enabled ? text.copy("停用…", "Disable…") : text.copy("启用…", "Enable…")) {
                    model.prepareToggle(block, item: item, enabled: !toggle.enabled)
                  }
                  if toggle.scope == "project" && !toggle.inherited {
                    Button(text.copy("恢复继承…", "Inherit…")) { model.prepareToggle(block, item: item, enabled: nil) }
                  }
                  if toggle.inherited {
                    Text(text.copy("继承父级配置", "Inherited Configuration")).foregroundStyle(.secondary)
                  }
                }.disabled(!model.canToggle(block, item))
              }
              Divider()
            }.textSelection(.enabled)
          }
          if page.nextCursor != nil {
            Button(text.copy("加载更多", "Load More")) { Task { await model.read(block, append: true) } }.disabled(
              state.loading || state.stale || model.busy)
          }
        }
        if (!model.readable(block) && block.type != "action-form") || state.unsupported {
          if block.type == "configuration-manager" && model.project == nil {
            Button(text.copy("打开原生配置管理…", "Open Native Configuration…")) { openConfiguration(entry.path) }
          } else {
            Text(text.copy("此业务块使用完整页面。", "This block uses the full page.")).foregroundStyle(.secondary)
            Button(text.copy("打开完整页面…", "Open Full Page…")) { openWeb(webPath(entry)) }
          }
        }
      }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
    }
  }
}
