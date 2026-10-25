import SwiftUI

struct SoftwarePageSearch: View {
  let title: String
  @Binding var query: String
  @FocusState.Binding var focused: Bool
  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
      TextField(title, text: $query).textFieldStyle(.plain).focused($focused).accessibilityLabel(title)
      if !query.isEmpty {
        Button {
          query = ""
          focused = true
        } label: {
          Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
        }.buttonStyle(.plain).accessibilityLabel(L10n.text.copy("清除搜索", "Clear Search"))
      }
    }.padding(.horizontal, 10).padding(.vertical, 7)
      .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
      .frame(minWidth: 180, maxWidth: 360)
  }
}

struct SoftwareStatusBadge: View {
  let title: String
  let symbol: String
  var color: Color = .secondary
  var body: some View {
    Label(title, systemImage: symbol).font(.caption.weight(.medium))
      .foregroundStyle(color).padding(.horizontal, 8).padding(.vertical, 4)
      .background(color.opacity(0.1), in: Capsule()).fixedSize()
      .accessibilityElement(children: .ignore).accessibilityLabel(title)
  }
}

extension View {
  func softwareManagementCard() -> some View {
    padding(14)
      .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
      .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.08)) }
  }
}
