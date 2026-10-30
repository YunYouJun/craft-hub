import AppKit
import SwiftUI
import Testing

@testable import CraftHubMac

@Suite(.serialized) @MainActor struct SidebarAppearanceTests {
  @Test func destinationLabelMatchesSystemSidebarRendering() async throws {
    for appearance in [NSAppearance.Name.aqua, .darkAqua] {
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 240, height: 100), styleMask: [.titled], backing: .buffered,
        defer: false)
      window.isReleasedWhenClosed = false
      defer {
        window.close()
        window.contentView = nil
      }
      window.appearance = NSAppearance(named: appearance)
      func render(_ label: AnyView) async throws -> NSBitmapImageRep {
        let hosting = NSHostingView(
          rootView: List(selection: .constant(Destination.projects as Destination?)) {
            label.tag(Destination.projects)
          }.listStyle(.sidebar))
        window.contentView = hosting
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
        hosting.layoutSubtreeIfNeeded()
        let bitmap = try #require(hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds))
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        return bitmap
      }
      let reference = try await render(
        AnyView(Label(Destination.projects.title, systemImage: Destination.projects.symbol)))
      let actual = try await render(AnyView(SidebarDestinationLabel(destination: .projects)))
      var difference: CGFloat = 0
      for y in 0..<reference.pixelsHigh {
        for x in 0..<reference.pixelsWide {
          let expected = try #require(reference.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB))
          let found = try #require(actual.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB))
          difference +=
            abs(expected.redComponent - found.redComponent)
            + abs(expected.greenComponent - found.greenComponent) + abs(expected.blueComponent - found.blueComponent)
        }
      }
      let meanDifference = difference / CGFloat(reference.pixelsWide * reference.pixelsHigh * 3)
      #expect(meanDifference < 0.001, "\(appearance.rawValue): sidebar differs from system Label by \(meanDifference)")
    }
  }

  private let icon = Data(
    ##"<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect width="18" height="18" fill="#1259df"/></svg>"##
      .utf8
  )

  @Test func pluginSidebarArtworkInheritsForegroundInLightAndDarkAppearances() async throws {
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
      let hosting = NSHostingView(
        rootView: SidebarPluginIcon(icon: declaration).foregroundStyle(Color.white).padding(10))
      window.contentView = hosting
      for (foreground, expected) in [(Color.white, CGFloat(1)), (Color.black, CGFloat(0))] {
        hosting.rootView = SidebarPluginIcon(icon: declaration).foregroundStyle(foreground).padding(10)
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
        hosting.layoutSubtreeIfNeeded()
        let bitmap = try #require(hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds))
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        let color = try #require(
          bitmap.colorAt(x: bitmap.pixelsWide / 2, y: bitmap.pixelsHigh / 2)?.usingColorSpace(.deviceRGB))
        #expect(
          abs(color.redComponent - expected) < 0.02 && abs(color.greenComponent - expected) < 0.02
            && abs(color.blueComponent - expected) < 0.02,
          "\(appearance.rawValue): \(color)")
      }
    }
  }
}
