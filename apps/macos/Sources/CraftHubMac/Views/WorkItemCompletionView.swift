import CraftHubMacCore
import SwiftUI

struct WorkItemCompletionButton: View {
  let target: WorkItemActionTarget
  let actions: WorkItemQuickActionsModel
  private var text: L10n { .text }
  private var processing: Bool {
    actions.completion.processing && actions.completion.activeTarget?.item.sourceRef == target.item.sourceRef
  }
  var body: some View {
    Button {
      Task { await actions.completion.complete(target) }
    } label: {
      ZStack {
        Image(systemName: "circle").font(.system(size: 18)).opacity(processing ? 0 : 1)
        if processing { ProgressView().controlSize(.small).scaleEffect(0.7) }
      }.frame(width: 24, height: 24).contentShape(Rectangle())
    }
    .buttonStyle(.plain).foregroundStyle(.secondary)
    .disabled(actions.pending || !target.canCompleteInline)
    .accessibilityLabel(text.copy("完成：", "Complete: ") + target.item.title)
    .help(
      target.canCompleteInline
        ? text.copy("标记为已完成", "Mark as Completed")
        : target.readOnly
          ? text.copy("这是缓存快照，刷新来源后可完成待办。", "Refresh this cached snapshot to complete tasks.")
          : text.copy("完成待办需要写入权限，也可在 To Do 中操作。", "Completion requires write access. You can also use To Do."))
  }
}

struct NativeMicrosoftTodoOpenButton: View {
  let model: WorkItemCompletionModel
  var iconOnly = false
  private var text: L10n { .text }
  var body: some View {
    Button {
      Task { await model.openMicrosoftTodo() }
    } label: {
      Label(text.copy("在 To Do 中打开", "Open in To Do"), systemImage: "arrow.up.right")
        .labelStyle(TodoOpenLabelStyle(iconOnly: iconOnly))
    }
    .buttonStyle(.borderless).disabled(model.openingApplication)
    .accessibilityLabel(text.copy("在 To Do 中打开", "Open in To Do"))
    .help(text.copy("打开本机 Microsoft To Do；未安装时打开网页版。", "Open Microsoft To Do locally, or its website if unavailable."))
  }
}

private struct TodoOpenLabelStyle: LabelStyle {
  let iconOnly: Bool
  func makeBody(configuration: Configuration) -> some View {
    if iconOnly {
      configuration.icon
    } else {
      HStack(spacing: 5) {
        configuration.icon
        configuration.title
      }
    }
  }
}

struct WorkItemCompletionBanner: View {
  let model: WorkItemCompletionModel
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let notice = model.notice {
        HStack(spacing: 12) {
          Label(text.copy("已完成：", "Completed: ") + notice.target.item.title, systemImage: "checkmark.circle")
            .lineLimit(2).textSelection(.enabled)
          Spacer(minLength: 8)
          Button(text.copy("撤销", "Undo")) { Task { await model.undo() } }
            .buttonStyle(.borderless).disabled(model.pending)
        }
      }
      if let error = model.error {
        Text(error).foregroundStyle(.red).textSelection(.enabled)
        if model.uncertain {
          HStack(spacing: 12) {
            NativeMicrosoftTodoOpenButton(model: model)
            Button(text.copy("已在 To Do 中核对", "I Checked To Do")) { model.acknowledgeUncertain() }
              .buttonStyle(.borderless).disabled(model.processing)
          }
        }
      }
      if let error = model.applicationError { Text(error).foregroundStyle(.red) }
    }
    .font(.callout)
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, NativePageLayout.horizontalInset)
    .padding(.vertical, model.notice != nil || model.error != nil || model.applicationError != nil ? 10 : 0)
    .accessibilityElement(children: .contain)
  }
}
