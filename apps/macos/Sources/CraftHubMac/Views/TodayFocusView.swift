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
  @State private var focusContentHeight: CGFloat = 144
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private var text: L10n { .text }
  private var rows: [TodayFocusSnapshot.Item] {
    guard let snapshot = today.snapshot else { return [] }
    if let analysis = today.analysis {
      return analysis.items.compactMap { recommendation in snapshot.items.first { $0.key == recommendation.key } }
    }
    return Array(snapshot.items.prefix(expanded ? 80 : 3))
  }
  private var hasFocusContent: Bool { !rows.isEmpty || today.analysis != nil }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 0) {
        focusHeader
        if let error = today.error { NativeErrorView(message: error).padding(.bottom, 12) }
        if let snapshot = today.snapshot, snapshot.sourceCount > 0 {
          if !hasFocusContent {
            focusEmptyState(snapshot).padding(.vertical, 20)
          } else if showsFocus {
            focusItems
          }
        }
      }
      .nativePageContent()
      if let snapshot = today.snapshot {
        if snapshot.sourceCount == 0 {
          GeometryReader { geometry in
            ScrollView {
              focusEmptyState(snapshot)
                .padding(.top, min(100, max(32, geometry.size.height * 0.16)))
                .padding(.bottom, 32)
            }
          }
        } else {
          Divider()
          WorkItemsOverviewView(
            snapshot: snapshot, loading: today.loading, navigate: navigate,
            refresh: { Task { await today.refreshWorkItems() } }, showWorkbench: showWorkbench,
            workItemActions: workItemActions)
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
        }.nativePageContent(.emptyState).frame(maxHeight: .infinity)
      }
    }
    .background(.background)
    .task(id: NativePreferences.shared.language) { await today.load() }
    .task {
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(60)) } catch { return }
        await today.load()
      }
    }
  }

  private var focusItems: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          if let analysis = today.analysis {
            Text(analysis.summary).textSelection(.enabled)
              .frame(maxWidth: NativePageLayout.ContentWidth.reading.maximum, alignment: .leading)
              .padding(.bottom, 8)
          }
          ForEach(Array(rows.enumerated()), id: \.element.key) { index, item in
            focusRow(item, index: index)
            if index < rows.count - 1 { Divider().padding(.leading, 28) }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) {
          $0.size.height
        } action: {
          focusContentHeight = $0
        }
      }
      .frame(height: min(max(72, focusContentHeight), expanded ? 300 : 160))
      if !rows.isEmpty {
        HStack {
          Text(text.copy("截止时间与优先级", "Deadlines & Priority")).foregroundStyle(.secondary)
          Spacer()
          if today.analysis == nil, (today.snapshot?.items.count ?? 0) > 3 {
            Button(expanded ? text.copy("收起重点", "Show Less") : text.copy("显示更多重点", "Show More")) {
              withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) { expanded.toggle() }
            }
            .buttonStyle(.borderless)
          }
        }.font(.caption).padding(.vertical, 8)
      }
    }
  }

  private func focusEmptyState(_ snapshot: TodayFocusSnapshot) -> some View {
    let needsSources = snapshot.sourceCount == 0
    let finished =
      snapshot.total == 0 && snapshot.completeSourceCount == snapshot.sourceCount && !today.loading
      && !snapshot.sources.contains(where: \.cached) && today.error == nil
    let title =
      needsSources
      ? text.copy("连接你的工作来源", "Connect Your Work Sources")
      : finished
        ? text.copy("今天的事项都处理完了", "You're All Caught Up")
        : text.copy("暂无可展示的重点", "No Focus Items Yet")
    let description =
      needsSources
      ? text.copy(
        "连接工作来源，集中查看待办；也可以先记录一件事。",
        "Bring your tasks together by connecting a work source, or capture a task to get started.")
      : finished
        ? text.copy(
          "暂时没有未完成事项，随时记录下一个想法。", "There are no unfinished tasks. Capture your next idea whenever you're ready.")
        : text.copy("可在下方查看待办与来源状态，或先记录一件事。", "Check your tasks and source status below, or capture a task.")
    return Group {
      if needsSources {
        VStack(spacing: 20) {
          Image(systemName: "tray")
            .font(.system(size: 40, weight: .light)).foregroundStyle(.secondary).accessibilityHidden(true)
          VStack(spacing: 8) {
            Text(title).font(.title2.weight(.semibold)).foregroundStyle(.primary)
            Text(description).font(.body).foregroundStyle(.secondary)
          }.multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
          HStack(spacing: 12) {
            Button(text.copy("添加工作来源", "Add Work Sources")) { navigate("/marketplace") }
              .buttonStyle(.borderedProminent)
            Button(text.copy("快速记录", "Quick Capture"), systemImage: "plus", action: capture)
              .buttonStyle(.bordered)
          }.controlSize(.large)
        }
        .nativePageContent(.emptyState)
      } else {
        HStack(spacing: 16) {
          Image(systemName: finished ? "checkmark.circle" : "tray")
            .font(.system(size: 24, weight: .light)).foregroundStyle(.secondary).accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline).foregroundStyle(.primary)
            Text(description).font(.callout).foregroundStyle(.secondary)
          }.fixedSize(horizontal: false, vertical: true)
          Spacer(minLength: 12)
          Button(text.copy("快速记录", "Quick Capture"), systemImage: "plus", action: capture)
            .buttonStyle(.borderedProminent).fixedSize()
        }
      }
    }
  }

  private var focusHeader: some View {
    HStack(spacing: 10) {
      if !hasFocusContent {
        Text(text.copy("今日重点", "Today’s Focus")).font(.title3.weight(.semibold))
      } else {
        Button {
          withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) { showsFocus.toggle() }
        } label: {
          HStack(spacing: 8) {
            Image(systemName: "chevron.right").rotationEffect(.degrees(showsFocus ? 90 : 0))
              .font(.caption).foregroundStyle(.secondary)
            Text(text.copy("今日重点", "Today’s Focus")).font(.title3.weight(.semibold))
          }.contentShape(Rectangle())
        }.buttonStyle(.plain)
          .accessibilityLabel(text.copy("今日重点", "Today’s Focus"))
          .accessibilityValue(showsFocus ? text.copy("已展开", "Expanded") : text.copy("已收起", "Collapsed"))
      }
      Text(Date(), format: .dateTime.month().day()).font(.caption).foregroundStyle(.secondary)
      Spacer(minLength: 8)
      if today.loading { ProgressView().controlSize(.small) }
      if hasFocusContent {
        Button(text.copy("快速记录", "Quick Capture"), systemImage: "plus", action: capture)
          .controlSize(.small)
        Button(
          today.analyzing ? text.copy("分析中…", "Analyzing…") : text.copy("AI 分析", "AI Analysis"), systemImage: "sparkles"
        ) { Task { await today.analyze() } }
        .controlSize(.small)
        .disabled(today.analyzing || !today.assistantAvailable || today.snapshot?.candidates.isEmpty != false)
      }
    }.padding(.top, 16).padding(.bottom, 10)
  }

  private func focusRow(_ item: TodayFocusSnapshot.Item, index: Int) -> some View {
    HStack(alignment: WorkItemRowLayout.titleAlignment, spacing: 10) {
      Text(index + 1, format: .number).font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
        .frame(width: 18)
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
            Text(item.title).font(.body).lineLimit(2).fixedSize(horizontal: false, vertical: true)
              .frame(maxWidth: NativePageLayout.ContentWidth.reading.maximum, alignment: .leading)
              .frame(maxWidth: .infinity, alignment: .leading)
              .alignmentGuide(WorkItemRowLayout.titleAlignment) { WorkItemRowLayout.firstLineCenter(in: $0) }
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
      .disclosureGroupStyle(WorkItemDisclosureStyle(title: item.title))
    }.padding(.vertical, 8)
  }
}
