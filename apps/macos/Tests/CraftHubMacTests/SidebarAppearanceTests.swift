import AppKit
import SwiftUI
import Testing

@testable import CraftHubMac

@Suite(.serialized) @MainActor struct SidebarAppearanceTests {
  @Test func sidebarSelectionKeepsNativeSelectionAndUsesUnemphasizedRendering() {
    let row = NSTableRowView()
    let container = NSView()
    let probe = SidebarSelectionProbe()
    row.addSubview(container)
    container.addSubview(probe)
    row.isSelected = true
    row.isEmphasized = true
    probe.apply()
    #expect(row.isSelected && !row.isEmphasized)
    row.isEmphasized = true
    probe.configure()
    #expect(row.isSelected && !row.isEmphasized)
    row.isSelected = false
    row.isEmphasized = true
    probe.apply()
    #expect(!row.isSelected && row.isEmphasized)
    probe.removeFromSuperview()
    probe.stop()
  }

  private let icon = Data(
    ##"<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect width="18" height="18" fill="#1259df"/></svg>"##
      .utf8
  )

  @Test func pluginSidebarArtworkIsGrayUntilSelectedInLightAndDarkAppearances() async throws {
    let declaration = "data:image/svg+xml;base64," + icon.base64EncodedString()
    for appearance in [
      NSAppearance.Name.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua,
    ] {
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 40, height: 40), styleMask: [.borderless], backing: .buffered,
        defer: false)
      window.isReleasedWhenClosed = false
      defer {
        window.close()
        window.contentView = nil
      }
      window.appearance = NSAppearance(named: appearance)
      let hosting = NSHostingView(rootView: SidebarPluginIcon(icon: declaration, selected: true).padding(10))
      window.contentView = hosting
      for selected in [true, false, true] {
        hosting.rootView = SidebarPluginIcon(icon: declaration, selected: selected).padding(10)
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
        hosting.layoutSubtreeIfNeeded()
        let bitmap = try #require(hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds))
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        let color = try #require(
          bitmap.colorAt(x: bitmap.pixelsWide / 2, y: bitmap.pixelsHigh / 2)?.usingColorSpace(.deviceRGB))
        let chroma =
          max(color.redComponent, color.greenComponent, color.blueComponent)
          - min(color.redComponent, color.greenComponent, color.blueComponent)
        #expect(
          selected ? chroma > 0.4 : chroma < 0.02,
          "\(appearance.rawValue), selected=\(selected): \(color)")
      }
    }
  }
}
