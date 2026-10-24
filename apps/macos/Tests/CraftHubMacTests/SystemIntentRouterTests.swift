import Testing

@testable import CraftHubMac

@MainActor @Test func systemIntentsWaitForNavigationAndDeliverOnlyNavigation() throws {
  let router = SystemIntentRouter()
  var delivered: [SystemIntentRouter.Request] = []
  try router.openProject("Old project")
  try router.openProject("  Current project  ")
  router.connect { delivered.append($0) }
  #expect(delivered == [.project("Current project")])
  router.capture()
  #expect(delivered == [.project("Current project"), .capture])
  router.connect { delivered.append($0) }
  #expect(delivered.count == 2)
  #expect(throws: (any Error).self) { try router.openProject("bad\nproject") }
  #expect(throws: (any Error).self) { try router.openProject(String(repeating: "x", count: 1025)) }
  #expect(delivered.count == 2)
}
