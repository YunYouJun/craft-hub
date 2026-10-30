import SwiftUI

/// Shared, transient feedback for explicit actions in the native workbench.
@MainActor @Observable final class NativeToastCenter {
  struct Message: Identifiable {
    let id = UUID()
    let text: String
    let isError: Bool
  }
  private(set) var message: Message?
  private var dismissal: Task<Void, Never>?

  func show(_ text: String, isError: Bool = false) {
    dismissal?.cancel()
    message = Message(text: text, isError: isError)
    dismissal = Task {
      try? await Task.sleep(for: .seconds(isError ? 5 : 2))
      guard !Task.isCancelled else { return }
      message = nil
    }
  }

  func dismiss() {
    dismissal?.cancel()
    dismissal = nil
    message = nil
  }
}

private struct NativeToastKey: EnvironmentKey {
  static let defaultValue: NativeToastCenter? = nil
}

extension EnvironmentValues {
  var nativeToast: NativeToastCenter? {
    get { self[NativeToastKey.self] }
    set { self[NativeToastKey.self] = newValue }
  }
}

extension View {
  func nativeToast(_ center: NativeToastCenter) -> some View {
    environment(\.nativeToast, center)
      .overlay(alignment: .top) {
        if let message = center.message {
          Label(message.text, systemImage: message.isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
            .font(.callout).padding(.horizontal, 16).padding(.vertical, 10)
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Color(nsColor: .separatorColor).opacity(0.5), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
            .padding(.top, 8).id(message.id)
            .accessibilityAddTraits(.updatesFrequently)
            .allowsHitTesting(false)
        }
      }
      .onDisappear { center.dismiss() }
  }
}
