import Foundation
import Testing

@testable import CraftHubMacCore

@Test func desktopLinksWaitForStartupWithIndependentLastWinsLanes() throws {
  var inbox = DesktopLinkInbox()
  #expect(inbox.accept(try #require(URL(string: "craft-hub-native://open?v=1"))))
  #expect(inbox.accept(try #require(URL(string: "craft-hub-native://celebrate?v=1"))))
  #expect(
    inbox.accept(
      try #require(URL(string: "craft-hub-native://marketplace/sources/import?catalog=https%3A%2F%2Fexample.com"))))
  #expect(inbox.accept(try #require(URL(string: "craft-hub-native://workspace?v=1&id=team"))))
  #expect(
    inbox.drain() == [
      "craft-hub-native://marketplace/sources/import?catalog=https%3A%2F%2Fexample.com",
      "craft-hub-native://celebrate?v=1", "craft-hub-native://workspace?v=1&id=team",
    ])
  #expect(inbox.drain().isEmpty)
}

@Test func desktopLinkTransportDoesNotQueueOtherProtocolsOrUnboundedInputs() throws {
  var inbox = DesktopLinkInbox()
  for raw in [
    "https://example.com", "file:///tmp/project",
    "craft-hub-native://open?padding=" + String(repeating: "a", count: 2049),
  ] {
    #expect(!inbox.accept(try #require(URL(string: raw))))
  }
  #expect(inbox.drain().isEmpty)
}
