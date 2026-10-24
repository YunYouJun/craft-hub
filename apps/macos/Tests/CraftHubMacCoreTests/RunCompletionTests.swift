import Foundation
import Testing

@testable import CraftHubMacCore

@Test func completionAlertsEstablishAQuietBaselineAndDoNotReplayOldSnapshots() throws {
  func summary(_ project: String, _ finished: String) -> ProjectRunSummary {
    ProjectRunSummary(projectId: project, lastStatus: .completed, lastFinishedAt: finished)
  }
  var tracker = RunCompletionTracker()
  let old = summary("one", "2026-10-22T01:00:00Z")
  let next = summary("one", "2026-10-22T02:00:00Z")
  #expect(tracker.consume([old]).isEmpty)
  #expect(tracker.consume([old]).isEmpty)
  #expect(tracker.consume([next]) == [next])
  #expect(tracker.consume([]).isEmpty)
  #expect(tracker.consume([next]).isEmpty)
  let newProject = summary("two", "2026-10-22T03:00:00Z")
  #expect(tracker.consume([next, newProject]) == [newProject])
  tracker = RunCompletionTracker()
  #expect(tracker.consume([next, newProject]).isEmpty)
}

@Test func completionAlertsWaitForATerminalSummary() throws {
  var tracker = RunCompletionTracker()
  let running = try JSONDecoder().decode(ProjectRunSummary.self, from: Data(#"{"projectId":"one","running":1}"#.utf8))
  #expect(tracker.consume([running]).isEmpty)
  let done = ProjectRunSummary(projectId: "one", lastStatus: .failed, lastFinishedAt: "2026-10-22T03:00:00Z")
  #expect(tracker.consume([done]) == [done])
  #expect(tracker.consume([done]).isEmpty)
}
