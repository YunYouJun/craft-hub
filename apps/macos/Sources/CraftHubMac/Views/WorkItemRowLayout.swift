import SwiftUI

enum WorkItemRowLayout {
  private enum FirstLineCenter: AlignmentID {
    static func defaultValue(in context: ViewDimensions) -> CGFloat { context[VerticalAlignment.center] }
  }

  static let titleAlignment = VerticalAlignment(FirstLineCenter.self)

  static func firstLineCenter(in dimensions: ViewDimensions) -> CGFloat {
    // Remove the height between baselines so wrapped titles still anchor to their first line.
    (dimensions.height + dimensions[.firstTextBaseline] - dimensions[.lastTextBaseline]) / 2
  }
}

struct WorkItemDisclosureStyle: DisclosureGroupStyle {
  let title: String
  @ScaledMetric(relativeTo: .caption) private var indicatorWidth: CGFloat = 12
  private var text: L10n { .text }

  func makeBody(configuration: Configuration) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: WorkItemRowLayout.titleAlignment, spacing: 8) {
        Button {
          configuration.isExpanded.toggle()
        } label: {
          Image(systemName: configuration.isExpanded ? "chevron.down" : "chevron.right")
            .font(.caption).foregroundStyle(.secondary)
            .frame(width: indicatorWidth).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
          (configuration.isExpanded ? text.copy("收起详情：", "Collapse Details: ") : text.copy("展开详情：", "Expand Details: "))
            + title
        )
        .accessibilityValue(configuration.isExpanded ? text.copy("已展开", "Expanded") : text.copy("已收起", "Collapsed"))
        configuration.label
      }
      if configuration.isExpanded {
        configuration.content.padding(.leading, indicatorWidth + 8)
      }
    }
  }
}
