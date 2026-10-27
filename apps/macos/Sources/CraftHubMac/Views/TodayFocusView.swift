import CraftHubMacCore
import SwiftUI

struct TodayFocusView: View {
  let today: TodayFocusModel
  let capture: () -> Void
  let navigate: (String) -> Void
  let showWorkbench: () -> Void
  let workItemActions: WorkItemQuickActionsModel
  @State private var expanded = false
  @State private var showsFocus = true
  private var text: L10n { .text }
  private var rows: [TodayFocusSnapshot.Item] {
    guard let snapshot = today.snapshot else { return [] }
    if let analysis = today.analysis {
      return analysis.items.compactMap { recommendation in snapshot.items.first { $0.key == recommendation.key } }
    }
    return Array(snapshot.items.prefix(expanded ? 80 : 3))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      focusHeader
      if let error = today.error { NativeErrorView(message: error).padding(.horizontal, 20) }
      if showsFocus {
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            if let analysis = today.analysis { Text(analysis.summary).textSelection(.enabled).padding(.bottom, 8) }
            if rows.isEmpty && !today.loading && today.snapshot != nil {
              ContentUnavailableView(
                text.copy("暂无未完成事项", "No unfinished work"), systemImage: "checkmark.circle",
                description: Text(text.copy("记录一件事，或在下方连接工作来源。", "Capture a task, or connect a work source below.")))
            }
            ForEach(Array(rows.enumerated()), id: \.element.key) { index, item in
              focusRow(item, index: index)
              if index < rows.count - 1 { Divider().padding(.leading, 28) }
            }
          }.padding(.horizontal, 20)
        }
        .frame(minHeight: 72, idealHeight: expanded ? 260 : 144, maxHeight: expanded ? 300 : 160)
        HStack {
          Text(text.copy("截止时间与优先级", "Deadlines & Priority")).foregroundStyle(.secondary)
          Spacer()
          if today.analysis == nil, (today.snapshot?.items.count ?? 0) > 3 {
            Button(expanded ? text.copy("收起重点", "Show Less") : text.copy("显示更多重点", "Show More")) { expanded.toggle() }
              .buttonStyle(.borderless)
          }
        }.font(.caption).padding(.horizontal, 20).padding(.vertical, 8)
      }
      Divider()
      if let snapshot = today.snapshot {
        WorkItemsOverviewView(
          snapshot: snapshot, loading: today.loading, navigate: navigate,
          refresh: { Task { await today.refreshWorkItems() } }, showWorkbench: showWorkbench,
          workItemActions: workItemActions)
        if snapshot.sourceCount == 0 {
          Button(text.copy("添加工作来源", "Add Work Sources")) { navigate("/marketplace") }.padding(20)
        }
      } else {
        VStack(spacing: 12) {
          if today.loading {
            ProgressView(text.copy("正在读取待办…", "Loading work items…"))
          } else {
            ContentUnavailableView(
              text.copy("暂无法读取待办", "Work Items Unavailable"),
              systemImage: "exclamationmark.arrow.trianglehead.2.clockwise.rotate.90",
              description: Text(today.error ?? text.copy("请重新读取工作来源。", "Try loading your work sources again.")))
            Button(text.copy("重新读取", "Reload")) { Task { await today.refreshWorkItems() } }
          }
          Button(text.copy("完整工作台…", "Full Workbench…"), action: showWorkbench).buttonStyle(.borderless)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background(.background)
    .task(id: NativePreferences.shared.language) { await today.load(force: true) }
    .task {
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(60)) } catch { return }
        await today.load()
      }
    }
  }

  private var focusHeader: some View {
    HStack(spacing: 10) {
      Button {
        showsFocus.toggle()
      } label: {
        HStack(spacing: 8) {
          Image(systemName: showsFocus ? "chevron.down" : "chevron.right").font(.caption).foregroundStyle(.secondary)
          Text(text.copy("今日重点", "Today’s Focus")).font(.title3.weight(.semibold))
        }.contentShape(Rectangle())
      }.buttonStyle(.plain)
        .accessibilityLabel(text.copy("今日重点", "Today’s Focus"))
        .accessibilityValue(showsFocus ? text.copy("已展开", "Expanded") : text.copy("已收起", "Collapsed"))
      Text(Date(), format: .dateTime.month().day()).font(.caption).foregroundStyle(.secondary)
      Spacer(minLength: 8)
      if today.loading { ProgressView().controlSize(.small) }
      Button(text.copy("快速记录", "Quick Capture"), systemImage: "plus", action: capture)
        .controlSize(.small)
      Button(
        today.analyzing ? text.copy("分析中…", "Analyzing…") : text.copy("AI 分析", "AI Analysis"), systemImage: "sparkles"
      ) { Task { await today.analyze() } }
      .controlSize(.small)
      .disabled(today.analyzing || !today.assistantAvailable || today.snapshot?.candidates.isEmpty != false)
    }.padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 10)
  }

  private func focusRow(_ item: TodayFocusSnapshot.Item, index: Int) -> some View {
    HStack(alignment: .top, spacing: 10) {
      Text(index + 1, format: .number).font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
        .frame(width: 18).padding(.top, 3)
      DisclosureGroup {
        VStack(alignment: .leading, spacing: 8) {
          if let recommendation = today.analysis?.items.first(where: { $0.key == item.key }) {
            Text(recommendation.reason)
            Text(text.copy("下一步：", "Next: ") + recommendation.nextStep)
          } else {
            Text(item.reasons.joined(separator: " · "))
          }
          HStack {
            Button(text.copy("前往来源", "Open Source")) { navigate(item.path) }.buttonStyle(.borderless)
            if let target = item.actionTarget { WorkItemQuickActions(target: target, model: workItemActions) }
          }
        }.font(.callout).padding(.vertical, 8).textSelection(.enabled)
      } label: {
        VStack(alignment: .leading, spacing: 3) {
          Button {
            if let target = item.actionTarget {
              Task { await workItemActions.open(target, mode: .detail) }
            } else {
              navigate(item.path)
            }
          } label: {
            Text(item.title).font(.body).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
          }.buttonStyle(.plain).help(text.copy("查看详情", "View Details"))
          HStack(spacing: 8) {
            PluginIconView(
              icon: today.snapshot?.sources.first { $0.key == item.sourceKey }?.icon ?? "builtin:list",
              fallbackSymbol: "checklist", size: 14)
            Text(item.project ?? item.sourceTitle).help(item.sourceTitle)
            if let status = item.status {
              Text("·").accessibilityHidden(true)
              WorkItemStatusLabel(title: status, category: item.statusCategory)
            }
          }.font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }.frame(maxWidth: .infinity, alignment: .leading)
      }
    }.padding(.vertical, 8)
  }
}
