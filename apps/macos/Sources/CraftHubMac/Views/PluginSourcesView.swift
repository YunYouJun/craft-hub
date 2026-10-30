import CraftHubMacCore
import SwiftUI

struct PluginSourcesView: View {
  @Bindable var model: PluginsModel
  private var text: L10n { .text }
  var body: some View {
    List {
      Section(text.copy("插件来源", "Plugin Sources")) {
        ForEach(model.sources) { source in
          VStack(alignment: .leading, spacing: 6) {
            HStack {
              Text(source.name).font(.headline)
              Text(
                source.kind == "user"
                  ? text.copy("自定义", "Custom")
                  : source.kind == "builtin" ? text.copy("内置", "Built In") : text.copy("托管", "Managed")
              ).font(.caption).foregroundStyle(.secondary)
              Spacer()
              Button(text.copy("刷新目录", "Refresh Catalog")) { Task { await model.refreshSource(source) } }.disabled(
                model.busy
              )
              .accessibilityLabel(text.copy("刷新来源：", "Refresh source: ") + source.name)
              if source.kind == "user" {
                Button(text.copy("移除…", "Remove…"), role: .destructive) { model.reviewSourceRemoval(source.id) }
                  .disabled(model.busy || model.stale)
                  .accessibilityLabel(text.copy("移除来源：", "Remove source: ") + source.name)
              }
            }
            if let url = source.catalogUrl { Text(url).font(.caption.monospaced()).textSelection(.enabled) }
            if let verification = source.verification {
              Label(
                text.copy("已验证发布者：", "Verified publisher: ") + verification.organization,
                systemImage: "checkmark.shield"
              ).font(.caption)
            }
            if !source.enabled {
              Text(text.copy("此来源已停用", "This source is disabled")).font(.caption).foregroundStyle(.secondary)
            }
            if let date = source.lastRefreshedAt { Text(date).font(.caption).foregroundStyle(.secondary) }
            if let error = source.error {
              Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).textSelection(.enabled)
            }
          }.padding(.vertical, 6)
        }
        if model.sources.isEmpty && !model.loading {
          Text(text.copy("没有匹配的来源。可清除搜索或在下方添加来源。", "No matching sources. Clear the search or add a source below."))
            .foregroundStyle(.secondary)
        }
      }
      Section(text.copy("添加来源", "Add a Source")) {
        VStack(alignment: .leading, spacing: 12) {
          TextField(text.copy("名称（可选）", "Name (optional)"), text: $model.sourceName)
          TextField(text.copy("HTTPS 目录地址", "HTTPS Catalog URL"), text: $model.sourceCatalogURL)
          TextField(text.copy("包仓库地址（可选）", "Package Registry (optional)"), text: $model.sourceRegistry)
          Button(text.copy("预览来源", "Preview Source")) { Task { await model.previewSource(model.sourceInput) } }
            .disabled(
              model.sourceInput.catalogUrl.isEmpty || model.busy)
          if let review = model.sourceReview {
            VStack(alignment: .leading, spacing: 8) {
              Text(review.preview.name).font(.headline)
              Text(review.preview.finalCatalogUrl).font(.caption.monospaced()).textSelection(.enabled)
              LabeledContent(
                text.copy("包仓库", "Package Registry"),
                value: review.preview.registry ?? text.copy("默认仓库", "Default Registry"))
              if let verification = review.preview.verification {
                Label(
                  text.copy("已验证发布者：", "Verified publisher: ") + verification.organization,
                  systemImage: "checkmark.shield")
              }
              DisclosureGroup(text.copy("查看目录条目", "Review Catalog Entries")) {
                ForEach(review.preview.catalog.plugins) { plugin in
                  VStack(alignment: .leading, spacing: 4) {
                    Text(plugin.displayName).font(.callout.weight(.medium))
                    Text("\(plugin.package) · \(plugin.version)").font(.caption.monospaced()).textSelection(.enabled)
                  }.padding(.vertical, 3)
                }
              }
              Text(
                text.copy(
                  "包含 \(review.preview.catalog.plugins.count) 个目录条目",
                  "\(review.preview.catalog.plugins.count) catalog entries"))
              Text(
                text.copy(
                  "添加后可浏览插件；插件安装仍需单独确认。",
                  "Adding a source makes plugins discoverable. Each installation requires review."
                )
              ).foregroundStyle(.secondary)
              HStack {
                Button(text.copy("取消", "Cancel")) { model.cancelPreview() }
                Button(text.copy("添加来源", "Add Source")) { Task { await model.confirmSource() } }.buttonStyle(
                  .borderedProminent)
              }.disabled(model.busy)
            }.padding(.vertical, 8)
          }
        }.frame(maxWidth: NativePageLayout.ContentWidth.form.maximum, alignment: .leading)
          .frame(maxWidth: .infinity)
      }.disabled(model.busy)
    }.listStyle(.inset)
      .nativePageListContent()
      .onChange(of: model.sourceInput) { model.cancelPreview() }
  }
}
