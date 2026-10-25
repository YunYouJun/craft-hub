import AppKit
import SwiftUI

/// Consistent, labeled icon links in both the catalog and personal shortcuts.
struct SoftwareLinkButtons: View {
  let title: String
  let website: String
  let download: String?
  let repository: String?
  private var text: L10n { L10n.text }

  var body: some View {
    HStack(spacing: 6) {
      link(website, symbol: "globe", label: text.copy("访问官网", "Visit Website"))
      link(download, symbol: "arrow.down.circle", label: text.copy("官方下载页", "Official Download Page"))
      link(repository, symbol: "chevron.left.forwardslash.chevron.right", label: text.copy("源码仓库", "Source Repository"))
    }.buttonStyle(.borderless).fixedSize()
  }

  @ViewBuilder private func link(_ value: String?, symbol: String, label: String) -> some View {
    if let url = DesktopBridge.externalURL(value) {
      Button {
        NSWorkspace.shared.open(url)
      } label: {
        Image(systemName: symbol).frame(width: 24, height: 24).contentShape(Rectangle())
      }.help(label).accessibilityLabel(label + ": " + title)
    }
  }
}
