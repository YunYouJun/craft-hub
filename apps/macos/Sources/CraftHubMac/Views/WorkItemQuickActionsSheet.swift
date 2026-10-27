import CraftHubMacCore
import SwiftUI

/// A content-only sheet. The window owns presentation, connection invalidation and completion refresh.
struct WorkItemQuickActionsSheet: View {
  let model: WorkItemQuickActionsModel
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Text(model.review == nil ? text.copy("事项详情", "Work Item") : text.copy("确认更改状态", "Review Status Change"))
          .font(.title2)
        Spacer()
        if model.loading || model.executing { ProgressView().controlSize(.small) }
      }
      if let error = model.error { NativeErrorView(message: error) }
      if let review = model.review {
        reviewContent(review)
      } else {
        Picker(text.copy("显示", "Show"), selection: Binding(get: { model.mode }, set: { model.show($0) })) {
          Text(text.copy("详情", "Details")).tag(WorkItemQuickActionsModel.Mode.detail)
          Text(text.copy("状态", "Status")).tag(WorkItemQuickActionsModel.Mode.status)
        }.pickerStyle(.segmented).disabled(model.pending)
        if model.target?.readOnly == true {
          Text(
            text.copy(
              "这是缓存快照。刷新来源后可读取详情和更改状态。",
              "This is a cached snapshot. Refresh the source to load details and change status.")
          )
          .font(.callout).foregroundStyle(.secondary)
        } else if model.stale && !model.uncertain {
          Text(text.copy("请重新读取后再操作。", "Reload before making changes.")).foregroundStyle(.secondary)
        }
        ScrollView {
          if model.mode == .detail, let item = model.item {
            WorkItemDetailView(item: item).frame(maxWidth: .infinity, alignment: .leading)
          } else {
            WorkItemStatusView(model: model).frame(maxWidth: .infinity, alignment: .leading)
          }
        }.frame(minHeight: 170, maxHeight: 460)
        if model.uncertain {
          Button(text.copy("已在来源核对，结束本次操作", "I Checked the Source; Close This Operation")) {
            model.acknowledgeUncertain()
          }.disabled(model.executing)
        }
        HStack {
          if model.target?.readOnly == false {
            Button(text.copy("重新读取", "Reload")) { Task { await model.reload() } }
              .disabled(model.loading || model.pending)
          }
          Spacer()
          Button(text.copy("关闭", "Close")) { model.close() }.disabled(model.pending).keyboardShortcut(.cancelAction)
          if model.mode == .status && !model.uncertain {
            Button(text.copy("审阅变更…", "Review Change…")) { model.prepareReview() }.disabled(!model.canReview)
          }
        }
      }
    }.padding(24).frame(width: 570).interactiveDismissDisabled(model.pending)
  }
  private func reviewContent(_ review: WorkItemQuickActionsModel.Review) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(review.title).font(.headline)
      LabeledContent(text.copy("当前状态", "Current Status"), value: review.from)
      LabeledContent(text.copy("目标状态", "Target Status"), value: review.to)
      ForEach(review.fields.keys.sorted(), id: \.self) { key in
        LabeledContent(key, value: review.fields[key] ?? "")
      }
      Text(text.copy("确认后将修改来源中的此事项。", "Confirming changes this item in its source."))
        .foregroundStyle(.secondary)
      HStack {
        Spacer()
        Button(text.copy("返回", "Back")) { model.cancelReview() }.disabled(model.executing).keyboardShortcut(
          .cancelAction)
        Button(text.copy("确认更改状态", "Confirm Status Change")) { Task { await model.confirm(review) } }
          .disabled(model.executing).keyboardShortcut(.defaultAction)
      }
    }.textSelection(.enabled)
  }
}
