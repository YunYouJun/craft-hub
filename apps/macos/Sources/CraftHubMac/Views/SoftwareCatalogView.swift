import CraftHubMacCore
import SwiftUI

/// Filters are presentation state; capabilities and installation approvals remain owned by the runtime.
struct SoftwareCatalogView: View {
  @Bindable var machine: MachineModel
  @FocusState.Binding var searchFocused: Bool
  @State private var categoryID = ""
  @State private var sourceID = ""
  private var text: L10n { .text }
  private var sources: [SoftwareSnapshot.Source] { machine.software?.sources ?? [] }
  private var filteredSources: [SoftwareSnapshot.Source] { sources.filter { sourceID.isEmpty || $0.id == sourceID } }
  private var categories: [SoftwareSnapshot.Group] {
    var seen = Set<String>()
    return filteredSources.flatMap(\.items).map(\.group).filter { seen.insert($0.id).inserted }
  }
  private var visibleCount: Int { filteredSources.reduce(0) { $0 + items($1).count } }
  private var totalCount: Int { sources.reduce(0) { $0 + $1.items.count } }
  private var filtered: Bool {
    !machine.search.isEmpty || machine.softwareFilter != "all" || !categoryID.isEmpty || !sourceID.isEmpty
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 12) {
          search
          filters
        }
        VStack(alignment: .leading, spacing: 10) {
          search
          filters
        }
      }.padding(.horizontal, 20).padding(.bottom, 12)
      HStack(spacing: 8) {
        Text(text.copy("\(visibleCount) / \(totalCount) 款软件", "\(visibleCount) of \(totalCount) apps"))
          .monospacedDigit()
        if filtered {
          Button(text.copy("重置筛选", "Reset Filters"), action: resetFilters).buttonStyle(.link)
        }
        Spacer()
        if machine.checkingSoftware { ProgressView().controlSize(.mini) }
      }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 20).padding(.bottom, 12)
      if let error = machine.softwareError { notice(error, error: true) }
      if let error = machine.installations.error { notice(error, error: true) }
      if let message = machine.operationMessage { notice(message) }
      content
      SoftwareSelectionBar(model: machine.installations, sources: sources)
    }
    .onChange(of: categories.map(\.id)) {
      if !categories.contains(where: { $0.id == categoryID }) { categoryID = "" }
    }
    .onChange(of: sources.map(\.id)) {
      if !sources.contains(where: { $0.id == sourceID }) { sourceID = "" }
    }
  }

  private var search: some View {
    HStack(spacing: 6) {
      Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
      TextField(text.copy("搜索软件或分类", "Search software or categories"), text: $machine.search)
        .textFieldStyle(.plain).focused($searchFocused).accessibilityLabel(text.copy("搜索软件", "Search Software"))
      if !machine.search.isEmpty {
        Button {
          machine.search = ""
          searchFocused = true
        } label: {
          Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
        }.buttonStyle(.plain).accessibilityLabel(text.copy("清除搜索", "Clear Search"))
      }
    }
    .padding(.horizontal, 10).padding(.vertical, 7)
    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    .frame(minWidth: 180, maxWidth: 360)
  }

  private var filters: some View {
    HStack(spacing: 8) {
      Picker(text.copy("分类", "Category"), selection: $categoryID) {
        Text(text.copy("全部分类", "All Categories")).tag("")
        ForEach(categories, id: \.id) { group in
          Text(group.title.localized(chinese: text.chinese)).tag(group.id)
        }
      }.frame(width: 135)
      Picker(text.copy("安装状态", "Installation Status"), selection: $machine.softwareFilter) {
        Text(text.copy("全部状态", "All Statuses")).tag("all")
        Text(text.copy("已检测到", "Detected")).tag("detected")
        Text(text.copy("未检测到", "Not Detected")).tag("not-detected")
        Text(text.copy("未知", "Unknown")).tag("unknown")
      }.frame(width: 120)
        .help(
          text.copy(
            "未检测到的软件可能安装在其他位置；未知表示来源未提供本机检测结果。",
            "Undetected apps may be installed elsewhere. Unknown means no local observations are available."))
      Picker(text.copy("软件来源", "Software Source"), selection: $sourceID) {
        Text(text.copy("全部来源", "All Sources")).tag("")
        ForEach(sources) { source in Text(source.title).tag(source.id) }
      }.frame(width: 150)
    }.labelsHidden().controlSize(.small).fixedSize(horizontal: true, vertical: false)
  }

  @ViewBuilder private var content: some View {
    if machine.software == nil {
      if machine.checkingSoftware {
        ProgressView(text.copy("正在读取软件目录…", "Loading software…"))
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ContentUnavailableView(
          text.copy("无法读取软件目录", "Could Not Load Software"), systemImage: "exclamationmark.triangle")
      }
    } else if sources.isEmpty {
      ContentUnavailableView(text.copy("尚未接入软件目录", "No Software Catalog"), systemImage: "shippingbox")
    } else {
      GeometryReader { geometry in
        ScrollView {
          VStack(alignment: .leading, spacing: 16) {
            ForEach(filteredSources) { source in
              let visible = items(source)
              if !visible.isEmpty || source.error != nil {
                VStack(alignment: .leading, spacing: 10) {
                  HStack(spacing: 6) {
                    Text(source.title).fontWeight(.medium)
                    Text("· \(visible.count)").monospacedDigit()
                  }.font(.caption).foregroundStyle(.secondary)
                  if source.error != nil {
                    Label(
                      text.copy("来源暂时不可用，请重新检测", "Source unavailable. Check again to retry."),
                      systemImage: "exclamationmark.triangle"
                    ).font(.callout).foregroundStyle(.secondary)
                  }
                  LazyVGrid(columns: columns(width: geometry.size.width), spacing: 12) {
                    ForEach(visible) { item in SoftwareCatalogCard(machine: machine, source: source, item: item) }
                  }
                }
              }
            }
            if visibleCount == 0 {
              ContentUnavailableView {
                Label(text.copy("没有匹配的软件", "No Matching Software"), systemImage: "magnifyingglass")
              } description: {
                Text(text.copy("试试其他关键词，或重置筛选条件。", "Try another keyword or reset the filters."))
              } actions: {
                if filtered { Button(text.copy("重置筛选", "Reset Filters"), action: resetFilters) }
              }.frame(maxWidth: .infinity)
            }
          }.padding(.horizontal, 20).padding(.bottom, 20)
        }
      }
    }
  }

  private func columns(width: CGFloat) -> [GridItem] {
    Array(
      repeating: GridItem(.flexible(), spacing: 12, alignment: .top),
      count: min(4, max(1, Int((width - 40 + 12) / 312))))
  }
  private func items(_ source: SoftwareSnapshot.Source) -> [SoftwareSnapshot.Item] {
    machine.visibleItems(source).filter { categoryID.isEmpty || $0.group.id == categoryID }
  }
  private func resetFilters() {
    machine.search = ""
    machine.softwareFilter = "all"
    categoryID = ""
    sourceID = ""
  }
  @ViewBuilder private func notice(_ message: String, error: Bool = false) -> some View {
    Group {
      if error {
        NativeErrorView(message: message)
      } else {
        Text(message).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
      }
    }.padding(.horizontal, 20).padding(.bottom, 8)
  }
}
