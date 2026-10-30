import AppKit
import CraftHubMacCore
import SwiftUI

struct ApplicationUninstallGuidanceView: View {
  @Bindable var model: ApplicationMaintenanceModel
  private var text: L10n { .text }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        HStack {
          Text(text.copy("卸载指引", "Uninstall Guidance")).font(.headline)
          Spacer()
          Button(text.copy("刷新应用", "Refresh Applications"), systemImage: "arrow.clockwise") {
            Task { await model.load(force: true) }
          }.disabled(model.loading)
        }
        Text(
          text.copy(
            "查找卸载入口与说明，选择应用不会执行卸载。",
            "Find uninstall entry points and documentation. Selecting an app does not uninstall it.")
        )
        .font(.callout).foregroundStyle(.secondary)
        if let error = model.error { NativeErrorView(message: error) }
        if let notice = model.notice { Text(notice).font(.callout).foregroundStyle(.secondary) }
        if model.loading { ProgressView(text.copy("正在读取本机应用…", "Reading Local Applications…")) }
        if let snapshot = model.snapshot {
          if !snapshot.supported {
            Text(text.copy("本机应用探测需要 macOS。", "Local application inspection requires macOS."))
          } else {
            if snapshot.incomplete {
              Text(
                text.copy(
                  "部分目录或应用无法读取，列表可能不完整。", "Some folders or apps could not be read. This list may be incomplete.")
              )
              .font(.caption).foregroundStyle(.secondary)
            }
            if model.bundleId != nil {
              Button(text.copy("显示所有应用", "Show All Applications")) {
                model.bundleId = nil
                model.selection = model.applications.first?.id
              }
            }
            TextField(text.copy("搜索已安装应用", "Search Installed Applications"), text: $model.query)
              .textFieldStyle(.roundedBorder)
            Picker(text.copy("应用", "Application"), selection: $model.selection) {
              Text(text.copy("选择应用", "Select Application")).tag(String?.none)
              ForEach(model.applications) { app in
                Text("\(app.name) · \(app.path)").tag(Optional(app.id))
              }
            }
            if model.applications.isEmpty {
              Text(
                text.copy(
                  "未找到匹配的应用。仅检查应用程序文件夹，未扫描其他磁盘或用户数据。",
                  "No matching applications. Only Applications folders are inspected; other disks and user data are not scanned."
                )
              )
              .font(.callout).foregroundStyle(.secondary)
            }
            if model.inspecting { ProgressView(text.copy("正在查找卸载入口…", "Looking for Uninstall Entry Points…")) }
            if let guidance = model.guidance { detail(guidance) }
          }
        }
      }.nativePageContent(.reading).padding(.vertical, 20)
    }
    .task { await model.load() }
    .task(id: model.selection) { await model.inspect() }
    .onChange(of: model.query) {
      if !model.applications.contains(where: { $0.id == model.selection }) {
        model.selection = model.applications.first?.id
      }
    }
  }

  private func detail(_ guidance: ApplicationUninstallGuidance) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(guidance.application.name).font(.title3.bold())
      Text("\(guidance.application.bundleId)\n\(guidance.application.path)")
        .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
      Button(text.copy("在 Finder 中显示应用", "Show Application in Finder"), systemImage: "folder") {
        Task { await model.reveal() }
      }.disabled(model.revealing)
      if guidance.incomplete {
        Text(
          text.copy(
            "部分位置或说明来源无法读取，结果可能不完整。",
            "Some locations or documentation sources could not be read. Results may be incomplete.")
        )
        .font(.caption).foregroundStyle(.secondary)
      }
      if guidance.candidates.isEmpty {
        Text(
          text.copy(
            "未找到本机卸载程序候选。应用内菜单可能仍有卸载功能。",
            "No local uninstaller candidate found. The application may still have an uninstall menu item."))
      }
      ForEach(guidance.candidates) { candidate in
        GroupBox {
          VStack(alignment: .leading, spacing: 8) {
            Text(candidate.name).font(.headline)
            Text(
              text.copy("未验证的候选", "Unverified Candidate") + " · "
                + (candidate.evidence == "inside-application"
                  ? text.copy("位于应用包内", "Inside the application bundle")
                  : text.copy("位于相邻安装文件夹", "In the enclosing installation folder"))
            )
            .font(.caption).foregroundStyle(.secondary)
            Text(candidate.path).font(.caption).textSelection(.enabled)
            Button(text.copy("在 Finder 中显示候选", "Show Candidate in Finder")) {
              Task { await model.reveal(candidate: candidate.id) }
            }.disabled(model.revealing)
          }.frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      ForEach(guidance.documentation, id: \.url) { doc in
        if let url = DesktopBridge.externalURL(doc.url) {
          Link(text.copy("卸载说明", "Uninstall Documentation") + " · " + doc.source, destination: url)
        }
      }
      if guidance.documentation.isEmpty {
        Text(
          text.copy(
            "软件目录尚未提供此应用的卸载说明。", "The software catalog has not supplied uninstall documentation for this application.")
        )
        .font(.callout).foregroundStyle(.secondary)
      }
      Link(
        text.copy("Apple 通用卸载指南", "Apple’s General Uninstall Guide"),
        destination: URL(string: "https://support.apple.com/102610")!)
      if let url = DesktopBridge.externalURL(guidance.searchUrl) {
        Link(text.copy("搜索官方卸载说明", "Search for Official Uninstall Instructions"), destination: url)
      }
      Text(
        text.copy(
          "候选仅根据名称和位置发现，尚未验证发布者。搜索结果也未经验证，请核对开发商官网。",
          "Candidates are based on names and locations; their publisher has not been verified. Search results are also unverified; check the developer’s website."
        )
      )
      .font(.caption).foregroundStyle(.secondary)
    }.frame(maxWidth: .infinity, alignment: .leading)
  }
}
