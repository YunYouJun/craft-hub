import CraftHubMacCore
import SwiftUI

/// Rows share one window-owned model so a pending write cannot be submitted twice from different surfaces.
struct WorkItemQuickActions: View {
  let target: WorkItemActionTarget
  let model: WorkItemQuickActionsModel
  var showsStatus = true
  private var text: L10n { .text }
  var body: some View {
    HStack(spacing: 8) {
      Button {
        Task { await model.open(target) }
      } label: {
        Label(text.copy("详情", "Details"), systemImage: "doc.text.magnifyingglass")
      }
      .help(text.copy("查看事项详情", "View Item Details"))
      if showsStatus, let status = target.item.statusLabel ?? target.item.status {
        Button {
          Task { await model.open(target, mode: .status) }
        } label: {
          HStack(spacing: 4) {
            WorkItemStatusLabel(title: status, category: target.item.statusCategory)
            if !target.readOnly && target.item.statusUpdateAvailable != false {
              Image(systemName: "chevron.down").font(.caption2)
            }
          }
        }
        .help(text.copy("查看或更改状态", "View or Change Status"))
      }
    }.buttonStyle(.borderless).controlSize(.small).disabled(model.pending)
  }
}
