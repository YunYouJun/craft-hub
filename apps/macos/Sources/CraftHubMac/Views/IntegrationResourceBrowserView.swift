import AppKit
import CraftHubMacCore
import SwiftUI
import UniformTypeIdentifiers

struct IntegrationResourceBrowserView: View {
  let model: IntegrationWorkbenchModel
  let block: NativeIntegrationCatalog.Block
  let state: IntegrationBlockState
  let projects: [PaletteProject]
  let openWeb: (String?) -> Void
  @State private var exportDocument: ResourceTextDocument?
  @State private var exportName = "document.txt"
  @State private var exporting = false
  @State private var exportError: String?
  private var text: L10n { .text }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Button(text.copy("返回", "Back")) { Task { await model.readResource(block, back: true) } }
          .disabled(state.loading || state.stale || state.resourceHistory.isEmpty || model.busy)
        Button(text.copy("资源首页", "Resource Home")) { Task { await model.readResource(block, home: true) } }
          .disabled(state.loading || model.busy)
        Spacer()
        if let project = state.resourceLocation?.project {
          Label(projects.first { $0.id == project }?.name ?? project, systemImage: "folder")
        } else {
          Text(text.copy("全局资源", "Global Resources")).foregroundStyle(.secondary)
        }
      }
      if let page = state.resourcePage {
        Text(page.title).font(.title3)
        if let description = page.description { Text(description).foregroundStyle(.secondary) }
        if state.stale {
          Text(text.copy("显示上次读取的资源。请刷新后继续浏览。", "Showing previous resources. Refresh before navigating."))
            .foregroundStyle(.secondary)
        }
        if page.refreshAfterMs != nil {
          Text(text.copy("此资源可能持续变化，可点击刷新读取最新内容。", "This resource may change. Refresh to read its latest contents."))
            .font(.caption).foregroundStyle(.secondary)
        }
        ForEach(Array((page.links ?? []).enumerated()), id: \.offset) { _, link in
          Button {
            Task { await model.readResource(block, link: link) }
          } label: {
            HStack {
              Label(link.title, systemImage: "arrow.right")
              if let project = link.projectId {
                Text(projects.first { $0.id == project }?.name ?? project).foregroundStyle(.secondary)
              }
            }
          }.disabled(state.loading || state.stale || model.busy)
        }
        ForEach(page.entities ?? [], id: \.key) { item in
          VStack(alignment: .leading, spacing: 4) {
            HStack {
              Text(item.title).fontWeight(.medium)
              Spacer()
              if let status = item.statusLabel ?? item.status { Text(status).foregroundStyle(.secondary) }
              if let url = DesktopBridge.externalURL(item.url) {
                Link(text.copy("打开原文", "Open Original"), destination: url)
              }
            }
            if let description = item.description { Text(description).foregroundStyle(.secondary) }
            ForEach(Array((item.details ?? []).enumerated()), id: \.offset) { _, detail in
              LabeledContent(detail.label, value: detail.value)
            }
          }.textSelection(.enabled)
        }
        ForEach(Array((page.documents ?? []).enumerated()), id: \.offset) { _, document in
          VStack(alignment: .leading, spacing: 8) {
            HStack {
              Text(document.title).font(.headline)
              Spacer()
              Button(text.copy("复制内容", "Copy Contents"), systemImage: "doc.on.doc") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(document.content, forType: .string)
              }
              .accessibilityLabel(text.copy("复制 \(document.title)", "Copy \(document.title)"))
            }
            DisclosureGroup(text.copy("预览内容", "Preview Contents")) {
              VStack(alignment: .leading, spacing: 8) {
                Button(text.copy("另存为…", "Save As…")) {
                  exportName = URL(fileURLWithPath: document.filename ?? "document.txt").lastPathComponent
                  if exportName.isEmpty { exportName = "document.txt" }
                  exportDocument = ResourceTextDocument(content: document.content)
                  exporting = true
                }
                documentText(document.content)
                if let comparison = document.compareWith {
                  Text(text.copy("对照内容", "Comparison")).font(.caption).foregroundStyle(.secondary)
                  documentText(comparison)
                }
                if document.agentPrompt != nil {
                  Text(text.copy("可在完整页面审阅 Agent 交接。", "Review the agent handoff in the full page."))
                    .font(.caption).foregroundStyle(.secondary)
                }
              }.padding(.top, 8)
            }
          }
        }
        if let forms = page.forms, !forms.isEmpty {
          Divider()
          Text(text.copy("此页操作", "Page Actions")).font(.headline)
          ForEach(Array(forms.enumerated()), id: \.offset) { _, form in
            VStack(alignment: .leading, spacing: 4) {
              Text(form.title)
              if let description = form.description { Text(description).foregroundStyle(.secondary) }
              Button(text.copy("打开表单…", "Open Form…")) { Task { await model.openForm(block, resource: form) } }
                .disabled(state.stale || state.loading || !model.canChangeContext)
            }
          }
        }
        if let suggestions = page.projectSuggestions, !suggestions.isEmpty {
          Text(text.copy("可添加的项目", "Suggested Projects")).font(.headline)
          ForEach(Array(suggestions.enumerated()), id: \.offset) { _, suggestion in
            LabeledContent(suggestion.title, value: suggestion.path).textSelection(.enabled)
          }
          Text(text.copy("在完整页面选择要添加的项目。", "Choose projects to add in the full page."))
            .font(.caption).foregroundStyle(.secondary)
        }
        Button(text.copy("打开此作用域的完整工作台…", "Open Full Workbench in This Scope…")) {
          openWeb(state.resourceLocation?.project)
        }
      }
      if let exportError { NativeErrorView(message: exportError) }
    }
    .fileExporter(
      isPresented: $exporting, document: exportDocument, contentType: .plainText, defaultFilename: exportName
    ) { result in
      if case .failure(let error) = result { exportError = error.localizedDescription } else { exportError = nil }
      exportDocument = nil
    }
  }
  private func documentText(_ value: String) -> some View {
    ScrollView([.horizontal, .vertical]) {
      Text(value).font(.system(.body, design: .monospaced)).textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading).padding(8)
    }.frame(maxHeight: 300).background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 6))
  }
}

private struct ResourceTextDocument: FileDocument {
  static var readableContentTypes: [UTType] { [.plainText] }
  var content: String
  init(content: String) { self.content = content }
  init(configuration: ReadConfiguration) throws {
    content = String(decoding: configuration.file.regularFileContents ?? Data(), as: UTF8.self)
  }
  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: Data(content.utf8))
  }
}
