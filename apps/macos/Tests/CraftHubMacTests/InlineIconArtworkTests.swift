import Foundation
import Testing

@testable import CraftHubMac

@MainActor @Test func inlinePluginArtworkDecodesOfflineAndRejectsUnsupportedOrBrokenData() {
  let svg = Data(
    #"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>"#
      .utf8)
  #expect(InlineIconArtwork.image("data:image/svg+xml;base64," + svg.base64EncodedString())?.isValid == true)
  for value in [
    "data:text/html;base64," + svg.base64EncodedString(),
    "data:image/png;base64,broken!", "https://example.com/icon.png", "file:///tmp/icon.png",
    "data:image/png;base64," + String(repeating: "A", count: 512 * 1024),
  ] {
    #expect(InlineIconArtwork.image(value) == nil)
  }
  #expect(InlineIconArtwork.image(nil) == nil)
}
