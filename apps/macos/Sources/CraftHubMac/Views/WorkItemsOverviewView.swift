import CraftHubMacCore
import SwiftUI

struct WorkItemsOverviewView: View {
  let snapshot: TodayFocusSnapshot
  let loading: Bool
  let navigate: (String) -> Void
  let refresh: () -> Void
  let showWorkbench: () -> Void
  let workItemActions: WorkItemQuickActionsModel
  @State private var selectedSource = ""
  private var text: L10n { .text }
  private var source: TodayFocusSnapshot.Source? {
    snapshot.sources.first { $0.key == selectedSource } ?? snapshot.sources.first
  }
  private var sourceSelection: Binding<String> {
    Binding(get: { source?.key ?? "" }, set: { selectedSource = $0 })
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if !snapshot.sources.isEmpty {
        HStack(spacing: 12) {
          ViewThatFits(in: .horizontal) {
            sourcePicker(segmented: true)
            sourcePicker(segmented: false)
          }
          Spacer(minLength: 0)
          Button(action: refresh) { Image(systemName: "arrow.clockwise") }
            .buttonStyle(.borderless).help(text.copy("刷新待办来源", "Refresh Work Sources")).disabled(loading)
        }.padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 8)
      }
      if let source {
        HStack(spacing: 8) {
          PluginIconView(icon: source.icon, fallbackSymbol: "checklist", size: 18)
          Text(source.title).fontWeight(.medium)
          Text(source.state == "loaded" ? text.copy("已连接", "Connected") : text.copy("需要检查连接", "Check Connection"))
            .foregroundStyle(source.state == "loaded" ? Color.secondary : .orange)
          if let account = source.accountLabel { Text(account).foregroundStyle(.secondary).lineLimit(1) }
          Spacer(minLength: 8)
          Button {
            navigate(source.path)
          } label: {
            Label(text.copy("查看全部", "View All"), systemImage: "arrow.up.right")
          }.buttonStyle(.borderless)
        }.font(.callout).padding(.horizontal, 20).padding(.bottom, 10)
        Divider()
        if let browser = source.browser {
          WorkItemsBrowserView(
            browser: browser, openSource: { navigate(source.path) }, sourceIcon: source.icon,
            workItemActions: workItemActions
          )
          .id(source.key + (browser.accountKey ?? ""))
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          VStack {
            ContentUnavailableView(
              source.state == "disconnected"
                ? text.copy("连接你的工作来源", "Connect Your Work Source") : text.copy("待办暂不可用", "Tasks Unavailable"),
              systemImage: source.state == "disconnected"
                ? "link" : "exclamationmark.arrow.trianglehead.2.clockwise.rotate.90",
              description: Text(text.copy("打开来源检查连接，然后重新读取。", "Open the source to check its connection, then reload.")))
            Button(text.copy("打开来源", "Open Source")) { navigate(source.path) }.padding(.bottom, 16)
          }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        Spacer()
      }
      Divider()
      HStack(spacing: 8) {
        if let source, source.state == "loaded" {
          Text(text.copy("已载入 \(source.count) 条", "\(source.count) loaded"))
          Text("·")
          Text(
            source.complete
              ? text.copy("已完整载入", "Fully Loaded")
              : text.copy("部分内容，查看全部以继续", "Partial Results — View All for More"))
          if source.cached { Label(text.copy("缓存快照", "Cached Snapshot"), systemImage: "clock") }
        }
        Spacer()
        Text(
          text.copy(
            "\(snapshot.loadedSourceCount)/\(snapshot.sourceCount) 个来源 · \(snapshot.total) 项待办",
            "\(snapshot.loadedSourceCount)/\(snapshot.sourceCount) sources · \(snapshot.total) tasks"))
        Button(text.copy("完整工作台…", "Full Workbench…"), action: showWorkbench).buttonStyle(.borderless)
      }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 20).padding(.vertical, 8)
    }.frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private func sourcePicker(segmented: Bool) -> some View {
    WorkSourcePicker(sources: snapshot.sources, selection: sourceSelection, segmented: segmented)
  }
}
