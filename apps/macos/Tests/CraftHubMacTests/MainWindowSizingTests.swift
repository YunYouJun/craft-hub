import AppKit
import SwiftUI
import Testing

@testable import CraftHubMac

@MainActor private func withSizingWindow(_ body: (NSWindow) throws -> Void) rethrows {
  let window = NSWindow(
    contentRect: NSRect(x: 130, y: 170, width: 1280, height: 820), styleMask: [.titled, .closable], backing: .buffered,
    defer: false)
  window.isReleasedWhenClosed = false
  defer {
    window.contentView = nil
    window.close()
  }
  try body(window)
}

@Suite(.serialized) @MainActor struct MainWindowSizingTests {
  @Test func mainSizingConfiguresAnUnknownGenericHostWithoutChangingItsWindowFrame() throws {
    try withSizingWindow { window in
      let host = NSHostingView(
        rootView: VStack { Text("Workbench fixture") }.frame(minWidth: 900, minHeight: 620))
      host.sizingOptions = [.minSize, .intrinsicContentSize]
      window.contentView = host
      let frame = window.frame
      #expect(MainWindowSizing.configure(window) == .contentSizingDisabled)
      #expect(host.sizingOptions.isEmpty)
      #expect(window.contentMinSize == NSSize(width: 900, height: 620))
      #expect(window.frame == frame)
      #expect(MainWindowSizing.configure(window) == .alreadyWindowSized)
      #expect(window.frame == frame)
    }
  }

  @Test func mainSizingFindsTheOutermostHostingAncestorInsideAWindowWrapper() throws {
    try withSizingWindow { window in
      let wrapper = NSView(frame: NSRect(x: 0, y: 0, width: 1280, height: 820))
      let outer = NSHostingView(rootView: Text("Outer workbench fixture"))
      let inner = NSHostingView(rootView: HStack { Text("Inner fixture") })
      let probe = NSView(frame: .zero)
      outer.sizingOptions = [.minSize]
      inner.sizingOptions = [.intrinsicContentSize]
      inner.addSubview(probe)
      outer.addSubview(inner)
      wrapper.addSubview(outer)
      window.contentView = wrapper
      let frame = window.frame
      #expect(MainWindowSizing.configure(window, from: probe) == .contentSizingDisabled)
      #expect(outer.sizingOptions.isEmpty)
      #expect(inner.sizingOptions == [.intrinsicContentSize])
      #expect(window.contentMinSize == NSSize(width: 900, height: 620))
      #expect(window.frame == frame)
    }
  }

  @Test func mainSizingDoesNotConfigureAnUnrelatedWindowsHostingView() throws {
    try withSizingWindow { window in
      try withSizingWindow { otherWindow in
        window.contentView = NSView(frame: NSRect(x: 0, y: 0, width: 1280, height: 820))
        window.contentMinSize = NSSize(width: 300, height: 240)
        let host = NSHostingView(rootView: Text("Settings fixture"))
        host.sizingOptions = [.minSize]
        let probe = NSView(frame: .zero)
        host.addSubview(probe)
        otherWindow.contentView = host
        let frame = window.frame
        let otherFrame = otherWindow.frame
        #expect(MainWindowSizing.configure(window, from: probe) == .hostingViewUnavailable)
        #expect(host.sizingOptions == [.minSize])
        #expect(window.contentMinSize == NSSize(width: 300, height: 240))
        #expect(window.frame == frame && otherWindow.frame == otherFrame)
      }
    }
  }
}
