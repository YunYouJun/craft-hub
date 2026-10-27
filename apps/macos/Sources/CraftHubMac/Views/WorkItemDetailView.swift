import CraftHubMacCore
import SwiftUI

/// Provider descriptions are displayed exclusively as inert, selectable text.
struct WorkItemDetailView: View {
  let item: IntegrationPresentation.Entity
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(item.title).font(.title3.weight(.semibold))
      HStack {
        if let status = item.statusLabel ?? item.status {
          WorkItemStatusLabel(title: status, category: item.statusCategory)
        }
        if item.archived == true { Text(text.copy("已归档", "Archived")).foregroundStyle(.secondary) }
        Spacer()
        if let url = DesktopBridge.externalURL(item.url) {
          Link(text.copy("打开原文", "Open Original"), destination: url)
        }
      }.font(.callout).foregroundStyle(.secondary)
      if let description = item.description, !WorkItemText.plainDescription(description).isEmpty {
        Text(WorkItemText.plainDescription(description)).font(.body).frame(maxWidth: .infinity, alignment: .leading)
      }
      ForEach(Array((item.details ?? []).enumerated()), id: \.offset) { _, field in
        LabeledContent(field.label) { Text(WorkItemText.plainDescription(field.value)) }
      }
      if item.description == nil && (item.details ?? []).isEmpty {
        Text(text.copy("来源没有提供更多详情。", "The source did not provide further details.")).foregroundStyle(.secondary)
      }
    }.textSelection(.enabled)
  }
}
