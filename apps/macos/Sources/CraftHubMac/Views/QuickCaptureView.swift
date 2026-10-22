import AppKit
import CraftHubMacCore
import SwiftUI

struct QuickCaptureView: View {
  @Bindable var model: QuickCaptureModel
  let dismiss: () -> Void
  let openIntegrations: () -> Void
  @FocusState private var focused: Bool
  private let text = L10n.text

  private func draft<Value: Equatable>(_ key: WritableKeyPath<CaptureDraft, Value>) -> Binding<Value> {
    Binding(get: { model.document.draft[keyPath: key] }, set: { if model.document.draft[keyPath: key] != $0 { model.editedDraft(); model.document.draft[keyPath: key] = $0 } })
  }
  private func focusInput() {
    focused = false
    DispatchQueue.main.async { focused = true }
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Label(text.copy("快速记录", "Quick Capture"), systemImage: "square.and.pencil").font(.title2.weight(.semibold))
        Spacer()
        Text("Microsoft To Do").foregroundStyle(.secondary)
      }
      TextField(text.copy("明天下午三点提交设计稿 #任务 !重要", "Tomorrow at 3pm send the design #Tasks !important"),
                text: Binding(get: { model.document.text }, set: { model.updateText($0) }), axis: .vertical)
        .lineLimit(2...4).textFieldStyle(.roundedBorder).font(.title3).focused($focused)
        .accessibilityIdentifier("capture.input")
        .disabled(model.busy)
      HStack {
        Label(model.writable ? text.copy("已连接 · 可新增", "Connected · Can create") : text.copy("未连接或只读", "Disconnected or read only"),
              systemImage: model.writable ? "checkmark.circle" : "person.crop.circle.badge.questionmark")
          .foregroundStyle(model.writable ? .green : .secondary)
        Spacer()
        if model.loading { ProgressView().controlSize(.small) }
        Button(text.copy("刷新连接", "Refresh connection")) { Task { await model.load() } }.disabled(model.busy || model.loading)
      }.font(.caption)
      if !model.writable {
        HStack {
          Text(text.copy("保存前需连接 To Do 并允许新增待办。", "Connect To Do and allow task creation to save.")).font(.caption).foregroundStyle(.secondary)
          Spacer()
          Button(text.copy("管理插件", "Manage plugins"), action: openIntegrations)
          Button(text.copy("连接并授权新增", "Connect and enable writes")) { Task { await model.load(authorize: true) } }
            .disabled(model.busy || model.loading)
        }
      }
      if let auth = model.connection?.deviceAuthorization {
        HStack {
          Text(text.copy("授权码：", "Code: ") + auth.userCode).textSelection(.enabled)
          Button(text.copy("打开授权页面", "Open authorization")) {
            if let url = URL(string: auth.verificationUrl), url.scheme == "https" { NSWorkspace.shared.open(url) }
          }
        }.font(.callout)
      }
      Form {
        TextField(text.copy("标题", "Title"), text: draft(\.title))
        Picker(text.copy("列表", "List"), selection: Binding(get: { model.document.draft.listId ?? "" }, set: { model.editedDraft(); model.document.draft.listId = $0 })) {
          Text(text.copy("选择列表", "Choose a list")).tag("")
          ForEach(model.lists) { list in Text(list.title).tag(list.id) }
        }
        Toggle(text.copy("设置截止日期", "Set a due date"), isOn: Binding(get: { model.document.draft.dueLocal != nil }, set: { enabled in
          model.editedDraft()
          model.document.draft.dueLocal = enabled ? CaptureDates.local(Date()) : nil
          if !enabled { model.document.draft.remind = false }
        }))
        if let due = model.document.draft.dueLocal {
          if let date = try? CaptureDates.date(due) {
            DatePicker(text.copy("截止日期", "Due date"), selection: Binding(get: { date }, set: { date in
              model.editedDraft(); model.document.draft.dueLocal = CaptureDates.local(date)
            }), displayedComponents: [.date, .hourAndMinute])
          } else {
            TextField(text.copy("请修正日期", "Correct the date"), text: Binding(get: { due }, set: { model.editedDraft(); model.document.draft.dueLocal = $0 }), prompt: Text("YYYY-MM-DDTHH:mm"))
              .foregroundStyle(.red)
          }
        }
        HStack {
          Toggle(text.copy("重要", "Important"), isOn: draft(\.important))
          Toggle(text.copy("在此时间提醒", "Remind at this time"), isOn: draft(\.remind)).disabled(model.document.draft.dueLocal == nil)
        }
        TextField(text.copy("备注", "Notes"), text: draft(\.notes), axis: .vertical).lineLimit(2...3)
      }.disabled(model.busy)
      VStack(alignment: .leading, spacing: 6) {
        ForEach(model.document.draft.warnings, id: \.self) { Text($0).foregroundStyle(.secondary) }
        if let error = model.persistenceError { Text(text.copy("本机草稿写入失败：", "Local draft could not be saved: ") + error).foregroundStyle(.red) }
        if model.recoveryRequired { Button(text.copy("保留原文件并重建草稿", "Keep original file and rebuild draft")) { model.recoverDraft() } }
        if let error = model.error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
        if let receipt = model.document.receipt { Text(receipt).foregroundStyle(.green).textSelection(.enabled) }
      }.font(.caption).fixedSize(horizontal: false, vertical: true)
      Spacer(minLength: 0)
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          Text(text.copy("草稿自动保存在本机 · Esc 收起", "Draft saved on this Mac · Esc dismisses"))
          Text(model.shortcutNotice ?? "⇧⌘Space")
        }.font(.caption).foregroundStyle(.secondary)
        Spacer()
        if model.aiAvailable {
          Button(text.copy("AI 理解", "Interpret with AI")) { Task { await model.analyze() } }.disabled(model.busy || model.document.text.isEmpty)
        }
        if model.busy || model.previewing { ProgressView().controlSize(.small) }
        Button(text.copy("保存到 To Do", "Save to To Do")) { Task { await model.save() } }
          .buttonStyle(.borderedProminent).disabled(!model.canSave).keyboardShortcut(.return, modifiers: .command)
          .accessibilityIdentifier("capture.save")
      }
    }.padding(24).frame(width: 680, height: 620)
      .onAppear { focusInput() }.onChange(of: model.focus) { focusInput() }
      .onExitCommand(perform: dismiss)
  }
}
