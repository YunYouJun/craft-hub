import CraftHubMacCore
import SwiftUI

struct ToolEditorView: View {
  @Bindable var model: SoftwareFavoritesModel
  @State private var replacingDraft = false
  private var text: L10n { L10n.text }
  private var selectedIndex: Int? { model.draft.firstIndex { $0.id == model.selectedDraftID } }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 6) {
        Text(text.copy("自定义工具", "Customize Tools")).font(.title2.bold())
        Text(
          text.copy(
            "管理网站和本机应用入口。所有工具都保留网站作为备用入口。",
            "Manage website and local app shortcuts. Every tool keeps a website as a fallback.")
        )
        .foregroundStyle(.secondary)
      }.padding(20)
      Divider()
      HSplitView {
        VStack(spacing: 0) {
          List(selection: $model.selectedDraftID) {
            ForEach(model.draft) { tool in
              VStack(alignment: .leading, spacing: 3) {
                Text(tool.title.isEmpty ? text.copy("新工具", "New Tool") : tool.title)
                Text(tool.group).font(.caption).foregroundStyle(.secondary)
              }.tag(tool.id)
            }
          }.listStyle(.sidebar)
          HStack {
            Button {
              model.appendTool()
            } label: {
              Image(systemName: "plus")
            }
            .help(text.copy("添加工具", "Add Tool")).accessibilityLabel(text.copy("添加工具", "Add Tool"))
            .disabled(model.draft.count >= 100)
            Button {
              removeSelected()
            } label: {
              Image(systemName: "minus")
            }
            .help(text.copy("移除工具", "Remove Tool")).accessibilityLabel(text.copy("移除工具", "Remove Tool"))
            .disabled(selectedIndex == nil)
            Spacer()
            Button {
              move(-1)
            } label: {
              Image(systemName: "arrow.up")
            }
            .help(text.copy("上移", "Move Up")).accessibilityLabel(text.copy("上移", "Move Up"))
            .disabled(selectedIndex == nil || selectedIndex == 0)
            Button {
              move(1)
            } label: {
              Image(systemName: "arrow.down")
            }
            .help(text.copy("下移", "Move Down")).accessibilityLabel(text.copy("下移", "Move Down"))
            .disabled(selectedIndex == nil || selectedIndex == model.draft.count - 1)
          }.padding(12)
        }.frame(minWidth: 180, idealWidth: 210, maxWidth: 260)
        if let index = selectedIndex {
          ToolFields(tool: $model.draft[index])
        } else {
          ContentUnavailableView(text.copy("添加或选择一个工具", "Add or Select a Tool"), systemImage: "star")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }.disabled(model.busy)
      Divider()
      VStack(alignment: .leading, spacing: 10) {
        if let error = model.editorError { NativeErrorView(message: error) }
        if !model.canSave, !model.busy {
          Text(
            text.copy(
              "设置已变化或需要重新读取。草稿已保留；载入已保存版本会替换此草稿。",
              "Settings changed or need reloading. Your draft is retained; loading the saved version replaces this draft."
            )
          )
          .font(.caption).foregroundStyle(.secondary)
          HStack {
            Button(text.copy("重新读取", "Reload")) { Task { await model.load(force: true) } }
              .disabled(model.loading)
            Button(text.copy("载入已保存版本…", "Use Saved Version…")) { replacingDraft = true }
              .disabled(!model.canChange)
          }
        }
        HStack {
          Text("\(model.draft.count) / 100").font(.caption).foregroundStyle(.secondary)
          Spacer()
          if model.busy || model.loading { ProgressView().controlSize(.small) }
          Button(text.copy("取消", "Cancel")) { model.editing = false }
            .keyboardShortcut(.cancelAction).disabled(model.busy)
          Button(text.copy("保存", "Save")) { Task { await model.saveDraft() } }
            .keyboardShortcut(.defaultAction).disabled(!model.canSave)
        }
      }.padding(20)
    }.frame(width: 820, height: 650)
      .interactiveDismissDisabled(model.busy)
      .confirmationDialog(text.copy("用已保存版本替换草稿？", "Replace Draft With Saved Version?"), isPresented: $replacingDraft) {
        Button(text.copy("替换草稿", "Replace Draft"), role: .destructive) { model.beginEditing() }
      }
  }

  private func removeSelected() {
    guard let index = selectedIndex else { return }
    model.draft.remove(at: index)
    model.selectedDraftID = model.draft.isEmpty ? nil : model.draft[min(index, model.draft.count - 1)].id
  }
  private func move(_ offset: Int) {
    guard let index = selectedIndex, model.draft.indices.contains(index + offset) else { return }
    model.draft.swapAt(index, index + offset)
  }
}

private struct ToolFields: View {
  @Binding var tool: SoftwareFavoritesSnapshot.Tool
  private var text: L10n { L10n.text }

  var body: some View {
    Form {
      Section(text.copy("工具信息", "Tool Details")) {
        TextField(text.copy("名称", "Name"), text: $tool.title)
        TextField(text.copy("分组", "Group"), text: $tool.group)
        TextField(text.copy("描述（可选）", "Description (optional)"), text: optional(\.description))
      }
      Section(text.copy("打开方式", "Launch")) {
        Picker(
          text.copy("打开方式", "Open With"),
          selection: Binding(
            get: { tool.launch?.application ?? "website" },
            set: { tool.launch = $0 == "website" ? nil : .init(application: $0) }
          )
        ) {
          Text(text.copy("网站", "Website")).tag("website")
          Text("Raycast").tag("raycast")
          Text("Orca").tag("orca")
          Text("Ghostty").tag("ghostty")
        }
        TextField(text.copy("网站入口", "Website"), text: $tool.url, prompt: Text("https://example.com"))
        if tool.launch?.application == "raycast" {
          TextField(
            text.copy("Raycast 命令（可选）", "Raycast Command (optional)"),
            text: Binding(
              get: { tool.launch?.commandUrl ?? "" },
              set: { tool.launch?.commandUrl = $0.isEmpty ? nil : $0 }
            ), prompt: Text("raycast://extensions/owner/extension/command"))
          Text(
            text.copy(
              "命令链接不带参数；工作上下文需要在目标工具中粘贴。", "Command links take no parameters; paste work context in the target tool.")
          )
          .font(.caption).foregroundStyle(.secondary)
        }
      }
      Section(text.copy("链接与图标（可选）", "Links and Artwork (optional)")) {
        TextField(text.copy("下载链接", "Download URL"), text: optional(\.downloadUrl))
        TextField(text.copy("源码链接", "Source URL"), text: optional(\.repositoryUrl))
        TextField(text.copy("图标链接", "Icon URL"), text: optional(\.iconUrl))
        TextField(text.copy("macOS 图标链接", "macOS Icon URL"), text: optional(\.macosIconUrl))
      }
    }.formStyle(.grouped).textFieldStyle(.roundedBorder)
      .frame(minWidth: 480, maxWidth: .infinity)
  }
  private func optional(_ key: WritableKeyPath<SoftwareFavoritesSnapshot.Tool, String?>) -> Binding<String> {
    Binding(get: { tool[keyPath: key] ?? "" }, set: { tool[keyPath: key] = $0.isEmpty ? nil : $0 })
  }
}
