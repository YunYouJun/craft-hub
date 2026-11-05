import SwiftUI

struct NativeErrorView: View {
  let message: String
  var body: some View {
    Label(message, systemImage: "exclamationmark.triangle")
      .foregroundStyle(.secondary).textSelection(.enabled)
      .padding(12).frame(maxWidth: .infinity, alignment: .leading)
      .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
      .accessibilityLabel(L10n.text.copy("请求失败：", "Request failed: ") + message)
  }
}
