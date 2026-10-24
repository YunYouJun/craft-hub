import CraftHubMacCore
import SwiftUI

struct PluginDetailView: View {
  @Bindable var model: PluginsModel
  let detail: PluginsModel.Detail
  @Environment(\.dismiss) private var dismiss
  @State private var selectedVersion = ""
  private var text: L10n { .text }
  private var version: String { selectedVersion.isEmpty ? detail.version : selectedVersion }
  private var versions: [CatalogPlugin] {
    model.snapshot?.catalog.filter { $0.package == detail.package && $0.sourceId == detail.source } ?? []
  }
  private var catalog: CatalogPlugin? { versions.first { $0.version == version } }
  private var installed: InstalledPlugin? {
    model.snapshot?.installed.first {
      $0.package == detail.package && $0.sourceId == detail.source && $0.version == version
    }
  }
  private var metadata: PluginMetadata? { catalog?.metadata ?? installed?.manifest ?? model.document?.manifest }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 4) {
          Text(metadata?.name(chinese: text.chinese) ?? detail.package).font(.title2.bold())
          Text(detail.package).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
        }
        Spacer()
        Button(text.copy("关闭", "Close")) { dismiss() }.keyboardShortcut(.cancelAction)
      }.padding(24)
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          HStack {
            LabeledContent(text.copy("来源", "Source"), value: catalog?.sourceName ?? detail.source)
            Spacer()
            if !versions.isEmpty {
              Picker(text.copy("版本", "Version"), selection: Binding(get: { version }, set: { selectedVersion = $0 })) {
                if !versions.contains(where: { $0.version == version }) { Text(version).tag(version) }
                ForEach(versions) { Text($0.version).tag($0.version) }
              }.frame(width: 210).disabled(model.busy)
            } else {
              Text(version).monospaced()
            }
          }
          if let error = model.error { NativeErrorView(message: error) }
          if let metadata {
            if let description = metadata.detail(chinese: text.chinese) { Text(description).textSelection(.enabled) }
            if let catalog {
              if let reason = catalog.statusReason {
                Label(reason, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
              }
              Button(PluginActionLabel.title(catalog.action, text: text)) { Task { await model.preview(catalog) } }
                .disabled(
                  model.busy || ["installed", "newer", "local"].contains(catalog.action) || catalog.status == "blocked")
            }
            GroupBox(text.copy("权限", "Permissions")) {
              VStack(alignment: .leading, spacing: 8) {
                if metadata.permissions.isEmpty { Text(text.copy("未声明额外权限", "No Additional Permissions")) }
                ForEach(metadata.permissions, id: \.self) { permission in
                  VStack(alignment: .leading, spacing: 3) {
                    Label(permission, systemImage: "key").font(.callout.weight(.medium))
                    if let reason = metadata.reason(permission, chinese: text.chinese) {
                      Text(reason).foregroundStyle(.secondary)
                    }
                  }
                }
              }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
            }
            relations(metadata.includesPlugins, title: text.copy("包含的插件", "Included Plugins"))
            relations(metadata.requiresPlugins, title: text.copy("依赖插件", "Dependencies"))
            if let contributions = metadata.contributes {
              let groups = contributions.keys.filter { !(contributions[$0]?.isEmpty ?? true) }.sorted()
              if !groups.isEmpty {
                DisclosureGroup(text.copy("提供的能力", "Contributions")) {
                  ForEach(groups, id: \.self) { key in LabeledContent(key, value: "\(contributions[key]?.count ?? 0)") }
                }
              }
            }
            if let maintainers = metadata.maintainers, !maintainers.isEmpty {
              LabeledContent(
                text.copy("维护者", "Maintainers"),
                value: maintainers.map { $0.name ?? $0.handle ?? $0.url ?? "" }.joined(separator: ", "))
            }
            if let links = metadata.links {
              HStack {
                ForEach(links.keys.sorted(), id: \.self) { key in
                  if let value = links[key], let url = URL(string: value), url.scheme == "https", url.user == nil,
                    url.password == nil
                  {
                    Link(linkTitle(key), destination: url)
                  }
                }
              }
            }
          }
          Divider()
          HStack {
            Text("README").font(.headline)
            Spacer()
            if model.documentLoading { ProgressView().controlSize(.small) }
            Button(text.copy("重新读取", "Reload")) { Task { await loadDocument() } }.disabled(model.documentLoading)
          }
          if let error = model.documentError { NativeErrorView(message: error) }
          if let document = model.document?.document {
            if let content = document.content {
              Text(
                (try? AttributedString(
                  markdown: content, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
                  ?? AttributedString(content)
              )
              .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            } else {
              Text(document.message ?? text.copy("此插件未提供 README。", "No README is available.")).foregroundStyle(
                .secondary)
            }
          }
        }.padding([.horizontal, .bottom], 24)
      }
    }.frame(width: 700, height: 620)
      .environment(
        \.openURL,
        OpenURLAction { url in
          guard url.scheme == "https", url.user == nil, url.password == nil else { return .discarded }
          return .systemAction
        }
      )
      .task(id: version) { await loadDocument() }
      .sheet(isPresented: Binding(get: { model.installReview != nil }, set: { if !$0 { model.cancelPreview() } })) {
        PluginInstallReviewView(model: model)
      }
  }
  private func loadDocument() async {
    await model.loadDocument(.init(source: detail.source, package: detail.package, version: version))
  }
  @ViewBuilder private func relations(_ items: [PluginMetadata.Dependency], title: String) -> some View {
    if !items.isEmpty {
      DisclosureGroup(title) {
        ForEach(items) { item in
          HStack {
            Text(item.package).textSelection(.enabled)
            Spacer()
            Text(item.version).foregroundStyle(.secondary)
          }
        }
      }
    }
  }
  private func linkTitle(_ key: String) -> String {
    switch key {
    case "documentation": text.copy("文档", "Documentation")
    case "repository": text.copy("代码仓库", "Repository")
    case "feedback": text.copy("反馈", "Feedback")
    case "homepage": text.copy("主页", "Homepage")
    default: key
    }
  }
}

struct PluginInstallReviewView: View {
  @Bindable var model: PluginsModel
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(text.copy("确认安装插件", "Review Plugin Installation")).font(.title2.bold())
      if let review = model.installReview {
        Text(review.plan.rootPackage).font(.headline).textSelection(.enabled)
        Text(text.copy("来源：", "Source: ") + review.plan.sourceId).foregroundStyle(.secondary)
        List(review.plan.items) { item in
          VStack(alignment: .leading, spacing: 5) {
            HStack {
              Text(item.displayName).font(.headline)
              Spacer()
              Text(item.version).monospaced()
            }
            Text(item.package).font(.caption).foregroundStyle(.secondary)
            Text(actionTitle(item.action)).font(.caption)
            if !item.permissions.isEmpty {
              Text(item.permissions.joined(separator: ", ")).font(.caption).textSelection(.enabled)
            }
          }.padding(.vertical, 4)
        }
        Text(
          text.copy("全部权限：", "All permissions: ")
            + (review.plan.permissions.isEmpty
              ? text.copy("无", "None") : review.plan.permissions.joined(separator: ", "))
        ).textSelection(.enabled)
      }
      if let message = model.message { Text(message).foregroundStyle(.orange) }
      if let error = model.error { NativeErrorView(message: error) }
      HStack {
        Button(text.copy("取消", "Cancel")) { model.cancelPreview() }.keyboardShortcut(.cancelAction).disabled(model.busy)
        Spacer()
        if model.busy { ProgressView().controlSize(.small) }
        Button(text.copy("确认安装", "Install")) { Task { await model.confirmInstall() } }.buttonStyle(.borderedProminent)
          .disabled(model.busy).keyboardShortcut(.defaultAction)
      }
    }.padding(24).frame(width: 600, height: 500).interactiveDismissDisabled(model.busy)
  }
  private func actionTitle(_ action: String) -> String {
    switch action {
    case "install": text.copy("安装此版本", "Install This Version")
    case "enable": text.copy("启用已有版本", "Enable Installed Version")
    default: text.copy("保持已安装版本", "Keep Installed Version")
    }
  }
}
