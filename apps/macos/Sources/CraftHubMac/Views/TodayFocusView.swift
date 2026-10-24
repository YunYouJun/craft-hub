import CraftHubMacCore
import SwiftUI

struct TodayFocusView: View {
  let today: TodayFocusModel
  let capture: () -> Void
  let navigate: (String) -> Void
  let showWorkbench: () -> Void
  @State private var expanded = false
  private var text: L10n { L10n.text }
  private var rows: [TodayFocusSnapshot.Item] {
    guard let snapshot = today.snapshot else { return [] }
    if let analysis = today.analysis {
      return analysis.items.compactMap { recommendation in snapshot.items.first { $0.key == recommendation.key } }
    }
    return Array(snapshot.items.prefix(expanded ? 80 : 5))
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        HStack {
          Label(text.copy("今日重点", "Today’s Focus"), systemImage: "sun.max").font(.title2)
          Spacer()
          Button(text.copy("完整工作台", "Full Workbench"), action: showWorkbench)
          Button(text.copy("快速记录", "Quick Capture"), systemImage: "square.and.pencil", action: capture)
            .buttonStyle(.borderedProminent)
        }
        HStack {
          Text(Date(), style: .date).foregroundStyle(.secondary)
          Spacer()
          if today.loading { ProgressView().controlSize(.small) }
          Button(text.copy("刷新", "Refresh"), systemImage: "arrow.clockwise") { Task { await today.load(force: true) } }
          Button(
            today.analyzing ? text.copy("分析中…", "Analyzing…") : text.copy("AI 分析", "AI Analysis"),
            systemImage: "sparkles"
          ) { Task { await today.analyze() } }
          .disabled(today.analyzing || !today.assistantAvailable || today.snapshot?.candidates.isEmpty != false)
        }
        if let error = today.error { NativeErrorView(message: error) }
        if let analysis = today.analysis { Text(analysis.summary).textSelection(.enabled) }
        if rows.isEmpty && !today.loading {
          ContentUnavailableView(
            text.copy("暂无未完成事项", "No unfinished work"), systemImage: "checkmark.circle",
            description: Text(text.copy("记录一件事，或在下方连接工作来源。", "Capture a task, or connect a work source below.")))
        }
        ForEach(rows) { item in
          DisclosureGroup {
            VStack(alignment: .leading, spacing: 8) {
              if let recommendation = today.analysis?.items.first(where: { $0.key == item.key }) {
                Text(recommendation.reason)
                Text(text.copy("下一步：", "Next: ") + recommendation.nextStep)
              } else {
                Text(item.reasons.joined(separator: " · "))
              }
              Button(text.copy("前往来源", "Open Source")) { navigate(item.path) }
            }.padding(.vertical, 8).textSelection(.enabled)
          } label: {
            VStack(alignment: .leading, spacing: 4) {
              Text(item.title).font(.headline).lineLimit(2)
              Text([item.project ?? item.sourceTitle, item.status].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary)
            }
          }
          Divider()
        }
        if today.analysis == nil, (today.snapshot?.items.count ?? 0) > 5 {
          Button(expanded ? text.copy("收起", "Show Less") : text.copy("显示更多", "Show More")) { expanded.toggle() }
        }
        if let snapshot = today.snapshot {
          Text(
            text.copy(
              "已读取 \(snapshot.loadedSourceCount)/\(snapshot.sourceCount) 个来源 · \(snapshot.completeSourceCount) 个完整载入 · \(snapshot.total) 项个人待办",
              "\(snapshot.loadedSourceCount)/\(snapshot.sourceCount) sources read · \(snapshot.completeSourceCount) complete · \(snapshot.total) personal tasks"
            )
          )
          .font(.caption).foregroundStyle(.secondary)
          ForEach(snapshot.sources) { source in
            HStack {
              VStack(alignment: .leading) {
                Text(source.sectionTitle ?? source.title)
                Text(sourceState(source)).font(.caption).foregroundStyle(.secondary)
              }
              Spacer()
              Button(text.copy("查看来源", "View Source")) { navigate(source.path) }
            }
          }
          if snapshot.sourceCount == 0 {
            Button(text.copy("添加工作来源", "Add Work Sources")) { navigate("/marketplace") }
          }
        }
      }.padding(24).frame(maxWidth: 1000, alignment: .leading).frame(maxWidth: .infinity)
    }
    .task(id: NativePreferences.shared.language) { await today.load(force: true) }
    .task {
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(60)) } catch { return }
        await today.load()
      }
    }
  }

  private func sourceState(_ source: TodayFocusSnapshot.Source) -> String {
    if source.state == "disconnected" { return text.copy("尚未连接", "Not Connected") }
    if source.state != "loaded" { return text.copy("读取失败，请检查来源连接", "Read failed; check the source connection") }
    if source.cached { return text.copy("显示缓存快照", "Showing a cached snapshot") }
    return source.complete
      ? text.copy("已完整读取", "Fully Loaded") : text.copy("部分载入，可前往来源继续查看", "Partial results; open the source for more")
  }
}
