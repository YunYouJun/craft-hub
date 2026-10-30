import SwiftUI

/// Page gutters are shared; only forms, prose and empty states cap their content width.
enum NativePageLayout {
  static let horizontalInset: CGFloat = 20
  // An inset List already supplies 16pt; safe-area padding supplies the remaining 4pt.
  static let listInsetAdjustment: CGFloat = 4

  enum ContentWidth {
    case flexible
    case form
    case reading
    case emptyState

    var maximum: CGFloat {
      switch self {
      case .flexible: .infinity
      case .form: 880
      case .reading: 800
      case .emptyState: 520
      }
    }

    var alignment: Alignment {
      switch self {
      case .emptyState: .center
      default: .leading
      }
    }
  }
}

extension View {
  /// Apply once to a page's content, inside its scroll view when it has one.
  func nativePageContent(_ width: NativePageLayout.ContentWidth = .flexible) -> some View {
    frame(maxWidth: width.maximum, alignment: width.alignment)
      .padding(.horizontal, NativePageLayout.horizontalInset)
      .frame(maxWidth: .infinity)
  }

  /// Preserve native row insets while aligning an inset List with the page gutter.
  func nativePageListContent(_ width: NativePageLayout.ContentWidth = .flexible) -> some View {
    contentMargins(.horizontal, 0, for: .scrollContent)
      .safeAreaPadding(.horizontal, NativePageLayout.listInsetAdjustment)
      .frame(maxWidth: width.maximum + NativePageLayout.horizontalInset * 2)
      .frame(maxWidth: .infinity)
  }

  /// Grouped Form supplies its own group margins and may choose a narrower reading width.
  func nativePageFormContent(_ width: NativePageLayout.ContentWidth = .form) -> some View {
    contentMargins(.horizontal, 0, for: .scrollContent)
      .frame(maxWidth: width.maximum + NativePageLayout.horizontalInset * 2)
      .frame(maxWidth: .infinity)
  }
}
