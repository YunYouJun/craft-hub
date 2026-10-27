import CraftHubMacCore
import SwiftUI

struct WorkItemStatusView: View {
  let model: WorkItemQuickActionsModel
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(model.item?.title ?? "").font(.headline)
      if model.canChangeStatus {
        if model.transitions.isEmpty {
          Text(text.copy("当前没有可用的状态操作。", "No status changes are currently available.")).foregroundStyle(.secondary)
        } else {
          Picker(
            text.copy("目标状态", "Target Status"),
            selection: Binding(get: { model.selectedID }, set: { model.select($0) })
          ) {
            Text(text.copy("选择状态", "Choose a Status")).tag("")
            ForEach(model.transitions) { transition in Text(transition.title).tag(transition.id) }
          }.pickerStyle(.radioGroup)
          if let selected = model.selected {
            ForEach(selected.requiredFields, id: \.self) { name in
              VStack(alignment: .leading, spacing: 5) {
                Text(name + " *")
                TextField(
                  name, text: Binding(get: { model.fields[name] ?? "" }, set: { model.edit(name, value: $0) })
                ).textFieldStyle(.roundedBorder)
              }
            }
          }
        }
      } else if !model.loading {
        Text(text.copy("此事项当前不可更改状态，请在来源中查看。", "Status changes are unavailable for this item. Check its source."))
          .foregroundStyle(.secondary)
      }
    }
  }
}
