import AppKit
import CraftHubMacCore
import SwiftUI

/// A compact collection keeps each destination's identifying details together.
struct WebsiteNavigationGroup: View {
  let panel: NavigationPanel
  let entries: [WebsiteNavigationModel.Entry]
  let canOpen: Bool
  let open: (NavigationPanel.Link) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        NavigationIconView(icon: panel.icon, size: 24)
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            Text(panel.title).font(.headline).lineLimit(1)
            Text(entries.count.formatted()).font(.caption).monospacedDigit().foregroundStyle(.secondary)
          }
          Text(panel.pluginName).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer(minLength: 0)
      }.padding(.horizontal, 10).padding(.top, 10).padding(.bottom, 6)
        .help(
          [panel.description, panel.pluginId + " · " + panel.pluginVersion].compactMap { $0 }.joined(separator: "\n"))
      ForEach(entries) { entry in
        WebsiteNavigationLink(link: entry.link, canOpen: canOpen, open: open)
      }
    }
    .padding(6).frame(maxWidth: .infinity, alignment: .topLeading)
    .background(.background, in: RoundedRectangle(cornerRadius: 12))
    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.quaternary, lineWidth: 1))
  }
}

private struct WebsiteNavigationLink: View {
  let link: NavigationPanel.Link
  let canOpen: Bool
  let open: (NavigationPanel.Link) -> Void
  private var text: L10n { .text }

  var body: some View {
    Button {
      open(link)
    } label: {
      HStack(alignment: .center, spacing: 10) {
        NavigationIconView(icon: link.icon, website: link.destination?.absoluteString ?? "", size: 32)
        VStack(alignment: .leading, spacing: 3) {
          Text(link.title).fontWeight(.medium).foregroundStyle(.primary).lineLimit(1)
          if let description = link.description {
            Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
          Text(link.destination?.host ?? link.url).font(.caption2).foregroundStyle(.secondary)
            .lineLimit(1).truncationMode(.middle)
        }.frame(maxWidth: .infinity, alignment: .leading)
        Image(systemName: "arrow.up.right").font(.caption2).foregroundStyle(.tertiary)
      }.frame(minHeight: 48).contentShape(Rectangle())
    }.buttonStyle(WebsiteNavigationLinkStyle())
      .disabled(!canOpen || link.destination == nil)
      .help([link.title, link.description, link.url].compactMap { $0 }.joined(separator: "\n"))
      .accessibilityLabel(text.copy("打开网站：", "Open Website: ") + link.title)
      .accessibilityHint(link.url)
      .contextMenu {
        if let url = link.destination {
          Button(text.copy("复制链接", "Copy Link")) {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(url.absoluteString, forType: .string)
          }
        }
      }
  }
}

private struct WebsiteNavigationLinkStyle: ButtonStyle {
  @Environment(\.isEnabled) private var isEnabled
  @State private var hovered = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.padding(10)
      .background(
        Color.accentColor.opacity(isEnabled && (hovered || configuration.isPressed) ? 0.08 : 0),
        in: RoundedRectangle(cornerRadius: 8)
      )
      .opacity(isEnabled ? 1 : 0.45)
      .onHover { hovered = $0 }
  }
}
