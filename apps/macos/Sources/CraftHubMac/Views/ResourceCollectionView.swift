import AppKit
import CraftHubMacCore
import SwiftUI

struct ResourceCollectionView: View {
  let model: IntegrationWorkbenchModel
  let block: NativeIntegrationCatalog.Block
  let state: IntegrationBlockState
  let page: IntegrationResourcePage
  let collection: IntegrationResourcePage.Collection
  @State private var selection = Set<String>()
  @State private var pending: Task<Void, Never>?
  @State private var draftInput: [String: IntegrationValue] = [:]
  @State private var hasPendingInput = false
  @State private var importPresented = false
  @State private var credentialRevision = UUID()
  @State private var feedback = ""
  private var text: L10n { .text }
  private var disabled: Bool { state.loading || state.stale || model.busy }
  private var vault: ResourceCredentialVault? {
    guard let source = page.browserImport, let integration = model.entry?.contribution.id,
      let url = URL(string: source.url), let origin = IntegrationResourcePage.BrowserImport.origin(url)
    else { return nil }
    return ResourceCredentialVault(
      profile: NativeStorage.directory, scope: integration + ":" + source.id + ":" + origin)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let source = page.browserImport {
        Button(source.title, systemImage: "arrow.triangle.2.circlepath") { importPresented = true }.disabled(disabled)
      }
      if let form = page.forms?.first(where: { $0.id == collection.filterFormId }) {
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 10) { filters(form) }
          VStack(alignment: .leading, spacing: 8) { filters(form) }
        }
      }
      HStack {
        Text(
          text.copy(
            "当前 \(collection.rows.count) 条，已选 \(selection.count) 条",
            "\(collection.rows.count) shown, \(selection.count) selected"))
        let hidden = selection.subtracting(collection.rows.map(\.id)).count
        if hidden > 0 {
          Text(text.copy("其他筛选中 \(hidden) 条", "\(hidden) outside this filter")).foregroundStyle(.secondary)
        }
        Spacer()
        Button(text.copy("全选当前结果", "Select Shown")) {
          changeSelection(selection.union(collection.rows.map(\.id)))
        }.disabled(disabled || collection.rows.isEmpty)
        Button(text.copy("清空选择", "Clear Selection")) { changeSelection([]) }.disabled(disabled || selection.isEmpty)
      }.font(.caption)
      Table(collection.rows, selection: Binding(get: { selection }, set: { changeSelection($0) })) {
        TableColumnForEach(collection.columns) { column in
          TableColumn(column.label) { (row: IntegrationResourcePage.Collection.Row) in
            Text(row.cells[column.id] ?? "").textSelection(.enabled).lineLimit(2)
          }
        }
        TableColumn(text.copy("操作", "Actions")) { row in
          HStack(spacing: 6) {
            Button {
              copy(row.copyValue)
            } label: {
              Image(systemName: "doc.on.doc")
            }
            .help(text.copy("复制值", "Copy Value"))
            .accessibilityLabel(text.copy("复制值", "Copy Value")).disabled(row.copyValue.isEmpty)
            if let input = row.input, let link = page.links?.first(where: { $0.input == input }) {
              Button {
                Task { await model.readResource(block, link: link) }
              } label: {
                Image(systemName: "pencil")
              }
              .accessibilityLabel(text.copy("编辑记录", "Edit Record"))
            }
          }
        }.width(70)
        TableColumn(text.copy("本机密码", "Local Password")) { row in
          if let key = row.credentialKey, let vault {
            ResourceSecretCell(vault: vault, credentialKey: key, disabled: disabled)
              .id(key + credentialRevision.uuidString)
          } else {
            Text("—").foregroundStyle(.secondary)
          }
        }.width(min: 170, ideal: 210)
      }
      .frame(height: min(480, max(160, CGFloat(collection.rows.count * 36 + 40))))
      .disabled(disabled)
      if collection.rows.isEmpty {
        Text(text.copy("没有匹配的账号，可调整筛选或导入已有清单。", "No matching records. Adjust filters or import your list."))
          .foregroundStyle(.secondary)
      }
      if !feedback.isEmpty { Text(feedback).font(.caption).accessibilityAddTraits(.updatesFrequently) }
    }
    .onAppear {
      selection = Set(collection.selectedIds)
      draftInput = page.input
    }
    .onChange(of: page.input) { if !hasPendingInput { draftInput = page.input } }
    .onChange(of: collection.selectedIds) { selection = Set(collection.selectedIds) }
    .onDisappear { pending?.cancel() }
    .sheet(
      isPresented: $importPresented, onDismiss: { credentialRevision = UUID() },
      content: {
        if let source = page.browserImport, let vault {
          ResourceBrowserImportView(declaration: source, vault: vault) { metadata in
            await model.importBrowserResource(block, formId: source.formId, metadata: metadata)
          }
        }
      }
    )
  }

  @ViewBuilder private func filters(_ form: IntegrationResourcePage.Form) -> some View {
    ForEach(form.fields ?? []) { field in
      if field.type == "text" {
        ResourceCollectionSearch(value: field.initialValue, label: field.label) { update(field.id, .string($0)) }
          .frame(minWidth: 140)
      } else if field.type == "select" {
        Picker(field.label, selection: Binding(get: { field.initialValue }, set: { update(field.id, .string($0)) })) {
          ForEach(field.options ?? [], id: \.value) { Text($0.label).tag($0.value) }
        }.fixedSize().disabled(disabled)
      } else if field.type == "checkbox" {
        Toggle(field.label, isOn: Binding(get: { field.initialValue == "true" }, set: { update(field.id, .bool($0)) }))
          .fixedSize().disabled(disabled)
      }
    }
  }
  private func update(_ key: String, _ value: IntegrationValue) {
    var input = draftInput
    input[key] = value
    submit(input)
  }
  private func changeSelection(_ ids: Set<String>) {
    selection = ids
    var input = draftInput
    input["selection"] = .string("custom")
    input[collection.selectionInput] = .string(ids.sorted().joined(separator: ","))
    submit(input)
  }
  private func submit(_ input: [String: IntegrationValue]) {
    pending?.cancel()
    draftInput = input
    hasPendingInput = true
    pending = Task {
      try? await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled else { return }
      hasPendingInput = false
      await model.readResource(block, collectionInput: input)
    }
  }
  private func copy(_ value: String) {
    NSPasteboard.general.clearContents()
    feedback =
      NSPasteboard.general.setString(value, forType: .string)
      ? text.copy("已复制", "Copied") : text.copy("复制失败，请重试", "Copy failed. Try again.")
  }
}

private struct ResourceCollectionSearch: View {
  let value: String
  let label: String
  let changed: (String) -> Void
  @State private var query = ""
  var body: some View {
    TextField(label, text: $query).textFieldStyle(.roundedBorder)
      .onAppear { query = value }
      .onChange(of: value) { if query != value { query = value } }
      .onChange(of: query) { if query != value { changed(query) } }
  }
}

private struct ResourceSecretCell: View {
  let vault: ResourceCredentialVault
  let credentialKey: String
  let disabled: Bool
  @Environment(\.scenePhase) private var phase
  @State private var available = false
  @State private var password = ""
  @State private var feedback = ""
  @State private var busy = false
  @State private var generation = 0
  @State private var concealTask: Task<Void, Never>?
  private var text: L10n { .text }
  var body: some View {
    HStack(spacing: 6) {
      Text(available ? (password.isEmpty ? "••••••••" : password) : text.copy("未保存", "Not saved"))
        .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
      if available {
        Button {
          if !password.isEmpty {
            conceal()
            return
          }
          let stamp = generation
          busy = true
          Task {
            defer { busy = false }
            do {
              let value = try await vault.read(credentialKey)
              guard stamp == generation, phase == .active else { return }
              password = value
              concealTask = Task {
                try? await Task.sleep(for: .seconds(30))
                if !Task.isCancelled { conceal() }
              }
            } catch { feedback = text.copy("读取失败", "Read failed") }
          }
        } label: {
          Image(systemName: password.isEmpty ? "eye" : "eye.slash")
        }
        .accessibilityLabel(password.isEmpty ? text.copy("显示密码", "Show Password") : text.copy("隐藏密码", "Hide Password"))
        Button {
          let stamp = generation
          busy = true
          Task {
            defer { busy = false }
            do {
              let value = try await vault.read(credentialKey)
              guard stamp == generation, phase == .active else { return }
              NSPasteboard.general.clearContents()
              guard NSPasteboard.general.setString(value, forType: .string) else {
                throw ResourceCredentialError.unavailable
              }
              NSPasteboard.general.setData(
                Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
              feedback = text.copy("已复制", "Copied")
            } catch { feedback = text.copy("复制失败", "Copy failed") }
          }
        } label: {
          Image(systemName: "doc.on.doc")
        }.accessibilityLabel(text.copy("复制密码", "Copy Password"))
        Menu {
          Button(text.copy("清除本机密码", "Remove Local Password"), role: .destructive) {
            Task {
              do {
                try await vault.remove(credentialKey)
                available = false
                conceal()
              } catch { feedback = text.copy("清除失败", "Removal failed") }
            }
          }
        } label: {
          Image(systemName: "ellipsis")
        }.menuStyle(.borderlessButton).fixedSize()
      }
      if !feedback.isEmpty { Text(feedback).font(.caption2) }
    }
    .disabled(disabled || busy)
    .task(id: credentialKey) {
      conceal()
      available = await vault.contains(credentialKey)
    }
    .onDisappear { conceal() }
    .onChange(of: phase) { if phase != .active { conceal() } }
  }
  private func conceal() {
    generation += 1
    password = ""
    concealTask?.cancel()
    concealTask = nil
  }
}
