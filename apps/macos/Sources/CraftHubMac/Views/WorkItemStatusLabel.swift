import SwiftUI

/// Semantic state controls the symbol; provider-owned copy remains readable alongside it.
struct WorkItemStatusLabel: View {
  let title: String
  let category: String?
  private var symbol: String {
    switch category {
    case "active": "circle.lefthalf.filled"
    case "planning": "calendar"
    case "review": "eye"
    case "testing": "flask"
    case "releasing": "shippingbox"
    case "resolved", "done", "closed": "checkmark.circle"
    case "cancelled": "xmark.circle"
    default: "circle"
    }
  }
  private var tint: Color {
    switch category {
    case "active": .blue
    case "review", "testing": .purple
    case "releasing": .teal
    case "resolved", "done", "closed": .green
    default: .secondary
    }
  }
  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: symbol).foregroundStyle(tint).accessibilityHidden(true)
      Text(title)
    }.accessibilityElement(children: .combine)
  }
}
