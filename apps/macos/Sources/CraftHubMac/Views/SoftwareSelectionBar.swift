import CraftHubMacCore
import SwiftUI

/// Selections stay visible across filters. Each provider still receives its own reviewed installation plan.
struct SoftwareSelectionBar: View {
  @Bindable var model: SoftwareInstallationModel
  let sources: [SoftwareSnapshot.Source]
  private var text: L10n { .text }
  private var selectedSources: [SoftwareSnapshot.Source] { sources.filter { !model.selectedIDs($0).isEmpty } }
  private var count: Int { selectedSources.reduce(0) { $0 + model.selectedIDs($1).count } }

  var body: some View {
    if count > 0 {
      VStack(spacing: 0) {
        Divider()
        HStack(spacing: 12) {
          Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.accentColor).accessibilityHidden(true)
          Text(text.copy("已选择 \(count) 款软件", "\(count) apps selected")).fontWeight(.medium)
          Button(text.copy("清除选择", "Clear Selection")) { model.selected.removeAll() }.buttonStyle(.link)
          Spacer()
          if model.planning { ProgressView().controlSize(.small) }
          if selectedSources.count == 1, let source = selectedSources.first {
            review(source).buttonStyle(.borderedProminent)
          } else {
            Menu(text.copy("按来源审阅安装…", "Review by Source…")) {
              ForEach(selectedSources) { source in
                review(source, title: "\(source.title) · \(model.selectedIDs(source).count)")
              }
            }.menuStyle(.borderedButton)
          }
        }.controlSize(.regular).padding(.horizontal, 20).padding(.vertical, 12)
      }.background(.bar)
    }
  }

  private func review(_ source: SoftwareSnapshot.Source, title: String? = nil) -> some View {
    Button(title ?? text.copy("审阅安装…", "Review Installation…")) {
      Task { await model.preview(source: source.id, ids: model.selectedIDs(source)) }
    }.disabled(model.planning || model.installing || model.sourceBusy(source.id))
  }
}
