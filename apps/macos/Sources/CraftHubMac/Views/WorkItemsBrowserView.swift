import AppKit
import CraftHubMacCore
import SwiftUI

struct WorkItemsBrowserView: View {
  let browser: TodayWorkBrowser
  let openSource: () -> Void
  let sourceIcon: String?
  let workItemActions: WorkItemQuickActionsModel
  @State private var selection = WorkItemsBrowserSelection()
  private var text: L10n { .text }
  private var matching: [TodayWorkBrowser.Item] { selection.matchingItems(browser) }
  private var groups: [WorkItemsBrowserSelection.Group] { selection.visibleGroups(browser) }
  private var total: Int { selection.groups(browser).reduce(0) { $0 + $1.items.count } }
  private var shown: Int { groups.reduce(0) { $0 + $1.items.count } }
  private var lists: [TodayWorkBrowser.Collection] {
    let query = selection.query.trimmingCharacters(in: .whitespacesAndNewlines)
    let keys = Set(matching.compactMap(\.collectionKey))
    return browser.collections.filter {
      (selection.showEmptyLists || keys.contains($0.key) || selection.collection == $0.key)
        && (query.isEmpty || $0.title.localizedStandardContains(query) || keys.contains($0.key))
    }
  }
  private var collectionSelection: Binding<String?> {
    Binding(
      get: { selection.collection.map { "collection:" + $0 } ?? "all" },
      set: { value in
        selection.collection = value.flatMap { $0.hasPrefix("collection:") ? String($0.dropFirst(11)) : nil }
      })
  }

  var body: some View {
    GeometryReader { geometry in
      let wide = geometry.size.width >= 720
      if wide {
        HStack(spacing: 0) {
          sidebar.frame(width: 224)
          Divider()
          results(narrow: geometry.size.width - 225 < 560)
        }
      } else {
        VStack(spacing: 0) {
          compactControls
          Divider()
          results(narrow: geometry.size.width < 560)
        }
      }
    }
    .frame(minHeight: 220)
    .onChange(of: selection.query) { selection.resetPreview() }
    .onChange(of: selection.category) { selection.resetPreview() }
    .onChange(of: selection.collection) { selection.resetPreview() }
    .onChange(of: selection.groupByList) { selection.resetPreview() }
  }

  private var sidebar: some View {
    VStack(spacing: 0) {
      VStack(spacing: 10) {
        search
        HStack {
          categoryPicker
          Spacer(minLength: 4)
          displayOptions
        }
      }.padding(12)
      List(selection: collectionSelection) {
        Section {
          collectionLabel(
            title: browser.projectMode ? text.copy("所有项目", "All Projects") : text.copy("所有列表", "All Lists"),
            count: matching.count, icon: "square.3.layers.3d"
          ).tag("all")
          ForEach(selection.allLists || !selection.query.isEmpty ? lists : Array(lists.prefix(5))) { list in
            collectionLabel(
              title: list.title, count: matching.filter { $0.collectionKey == list.key }.count,
              icon: browser.projectMode ? "folder" : "checklist"
            ).tag("collection:" + list.key)
          }
        } header: {
          Text(browser.projectMode ? text.copy("我的项目", "My Projects") : text.copy("我的列表", "My Lists"))
        }
        if lists.count > 5 && selection.query.isEmpty {
          Button {
            selection.allLists.toggle()
          } label: {
            Label(
              selection.allLists
                ? text.copy("收起列表", "Show Fewer Lists")
                : text.copy("显示所有列表 (\(lists.count))", "Show All Lists (\(lists.count))"),
              systemImage: selection.allLists ? "chevron.up" : "ellipsis")
          }.buttonStyle(.borderless)
        }
      }
      .listStyle(.sidebar)
      .scrollContentBackground(.hidden)
    }
  }

  private var compactControls: some View {
    VStack(spacing: 10) {
      search
      HStack(spacing: 12) {
        categoryPicker
        Picker(text.copy("列表", "List"), selection: collectionSelection) {
          Text(browser.projectMode ? text.copy("所有项目", "All Projects") : text.copy("所有列表", "All Lists"))
            .tag("all" as String?)
          ForEach(lists) { list in Text(list.title).tag(("collection:" + list.key) as String?) }
        }.pickerStyle(.menu).labelsHidden().frame(maxWidth: .infinity, alignment: .leading)
        displayOptions
      }
    }.padding(12)
  }

  private var search: some View {
    TextField(text.copy("搜索列表和待办", "Search Lists and Tasks"), text: $selection.query)
      .textFieldStyle(.roundedBorder)
      .accessibilityLabel(text.copy("搜索列表和待办", "Search Lists and Tasks"))
  }

  private var categoryPicker: some View {
    Picker(text.copy("分类", "Category"), selection: $selection.category) {
      categoryOption("all", title: text.copy("全部", "All"), icon: "checklist")
      categoryOption("important", title: text.copy("重要", "Important"), icon: "star")
      categoryOption("overdue", title: text.copy("已逾期", "Overdue"), icon: "calendar.badge.exclamationmark")
      categoryOption("planned", title: text.copy("已计划", "Planned"), icon: "calendar")
      categoryOption("today", title: text.copy("今日到期", "Due Today"), icon: "sun.max")
    }.pickerStyle(.menu).labelsHidden().accessibilityLabel(text.copy("分类", "Category"))
  }

  private func categoryOption(_ key: String, title: String, icon: String) -> some View {
    let count = key == "all" ? browser.items.count : browser.items.filter { $0.categories.contains(key) }.count
    return Label("\(title) (\(count))", systemImage: icon).tag(key)
  }

  private var displayOptions: some View {
    Menu {
      Toggle(text.copy("按列表分组", "Group by List"), isOn: $selection.groupByList)
      Toggle(text.copy("紧凑布局", "Compact Rows"), isOn: $selection.compact)
      Toggle(text.copy("显示空列表", "Show Empty Lists"), isOn: $selection.showEmptyLists)
    } label: {
      Image(systemName: "slider.horizontal.3")
    }
    .menuStyle(.borderlessButton).fixedSize()
    .help(text.copy("显示选项", "Display Options"))
    .accessibilityLabel(text.copy("显示选项", "Display Options"))
  }

  private func collectionLabel(title: String, count: Int, icon: String) -> some View {
    HStack(spacing: 8) {
      Image(systemName: icon).frame(width: 16)
      Text(title).lineLimit(1).truncationMode(.middle)
      Spacer(minLength: 4)
      Text(count, format: .number).font(.caption).monospacedDigit()
    }.help(title)
  }

  private func results(narrow: Bool) -> some View {
    VStack(spacing: 0) {
      if total == 0 {
        ContentUnavailableView(
          text.copy("暂无匹配待办", "No Matching Tasks"), systemImage: "checklist",
          description: Text(text.copy("调整分类或搜索关键词以查看其他待办。", "Try another category or search term to see more tasks."))
        ).frame(maxWidth: .infinity, maxHeight: .infinity)
        if selection.narrowed {
          Button(text.copy("清除筛选", "Clear Filters")) {
            selection.query = ""
            selection.category = "all"
            selection.collection = nil
          }.padding(.bottom, 16)
        }
      } else {
        List {
          ForEach(groups) { group in
            Section {
              if !selection.collapsed.contains(group.id) {
                ForEach(group.items) { item in
                  WorkItemRowView(
                    item: item, compact: selection.compact, narrow: narrow, openSource: openSource,
                    sourceIcon: sourceIcon, workItemActions: workItemActions
                  )
                  .listRowSeparator(.visible)
                  .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                }
              }
            } header: {
              if !group.title.isEmpty { groupHeader(group) }
            }
          }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        Divider()
        HStack {
          Text(text.copy("\(shown) / \(total) 条待办", "\(shown) / \(total) tasks")).foregroundStyle(.secondary)
          Spacer()
          if shown < total || selection.expanded {
            Button(selection.expanded ? text.copy("收起待办", "Show Fewer Tasks") : text.copy("显示更多待办", "Show More Tasks"))
            {
              selection.expanded.toggle()
            }.buttonStyle(.borderless)
          }
        }.font(.caption).padding(.horizontal, 16).padding(.vertical, 10)
      }
    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private func groupHeader(_ group: WorkItemsBrowserSelection.Group) -> some View {
    Button {
      if selection.collapsed.contains(group.id) {
        selection.collapsed.remove(group.id)
      } else {
        selection.collapsed.insert(group.id)
      }
    } label: {
      HStack(spacing: 6) {
        Image(systemName: selection.collapsed.contains(group.id) ? "chevron.right" : "chevron.down")
          .font(.caption2)
        Text(group.title).lineLimit(1)
        Text(selection.groups(browser).first { $0.id == group.id }?.items.count ?? 0, format: .number)
          .monospacedDigit()
      }.font(.caption).foregroundStyle(.secondary)
    }
    .buttonStyle(.plain)
    .accessibilityValue(
      selection.collapsed.contains(group.id) ? text.copy("已收起", "Collapsed") : text.copy("已展开", "Expanded"))
  }
}

private struct WorkItemRowView: View {
  let item: TodayWorkBrowser.Item
  let compact: Bool
  let narrow: Bool
  let openSource: () -> Void
  let sourceIcon: String?
  let workItemActions: WorkItemQuickActionsModel
  private var text: L10n { .text }

  @ViewBuilder var body: some View {
    if let target = item.actionTarget, target.item.statusLabel ?? target.item.status != nil {
      accessibleRow.accessibilityAction(named: Text(text.copy("查看或更改状态", "View or Change Status"))) {
        guard !workItemActions.pending else { return }
        Task { await workItemActions.open(target, mode: .status) }
      }
    } else {
      accessibleRow
    }
  }

  private var accessibleRow: some View {
    row
      .accessibilityElement(children: .contain)
      .accessibilityAction(named: Text(text.copy("查看详情", "View Details")), openDetails)
      .accessibilityAction(named: Text(text.copy("复制标题", "Copy Title")), copyTitle)
  }

  private var row: some View {
    HStack(alignment: .top, spacing: 10) {
      PluginIconView(icon: sourceIcon, fallbackSymbol: "checklist", size: 18).accessibilityHidden(true)
        .padding(.top, 2)
      if narrow {
        VStack(alignment: .leading, spacing: 8) {
          title
          actions
        }
      } else {
        title
        actions.fixedSize(horizontal: true, vertical: false)
      }
    }.padding(.vertical, compact ? 4 : 8)
  }

  private var title: some View {
    Button(action: openDetails) {
      VStack(alignment: .leading, spacing: 4) {
        Text(item.title).font(.body).lineLimit(2)
        HStack(spacing: 7) {
          if item.actionTarget == nil, let status = item.status {
            Label(status, systemImage: "circle")
          }
          if let type = item.type { Text(type) }
          if let due = item.due {
            Label(due, systemImage: "calendar").foregroundStyle(
              item.categories.contains("overdue") ? Color.red : .secondary)
          }
        }.font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
    }.buttonStyle(.plain).help(text.copy("查看待办详情", "View Task Details"))
  }

  private var actions: some View {
    HStack(spacing: 8) {
      if let target = item.actionTarget {
        WorkItemQuickActions(target: target, model: workItemActions)
      }
      if item.categories.contains("important") {
        Image(systemName: "star.fill").font(.caption).foregroundStyle(.orange)
          .accessibilityLabel(text.copy("重要", "Important"))
      }
      if let url = DesktopBridge.externalURL(item.url) {
        Link(destination: url) { Image(systemName: "arrow.up.right") }
          .help(text.copy("打开原文", "Open Original"))
      }
      Button(action: copyTitle) {
        Image(systemName: "doc.on.doc")
      }.help(text.copy("复制标题", "Copy Title"))
    }.buttonStyle(.borderless).foregroundStyle(.secondary)
  }

  private func openDetails() {
    if let target = item.actionTarget {
      Task { await workItemActions.open(target, mode: .detail) }
    } else {
      openSource()
    }
  }

  private func copyTitle() {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(item.title, forType: .string)
  }
}
