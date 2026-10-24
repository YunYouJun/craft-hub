import Foundation

/// A narrow notification projection; no command, arguments, output or secrets enter notifications.
public struct ProjectRunSummary: Decodable, Equatable, Sendable {
  public enum Status: String, Decodable, Sendable { case completed, failed, cancelled }
  public let projectId: String
  public let lastStatus: Status?
  public let lastFinishedAt: String?
}

extension RuntimeAPIClient {
  public func runSummaries() async throws -> [ProjectRunSummary] {
    try await fetch(path: "/api/runs/summary")
  }
}

/// Establish a quiet baseline before announcing later completions. Reconnect snapshots do not replay old work.
public struct RunCompletionTracker {
  private var baseline = false
  private var seen: [String: String] = [:]
  public init() {}
  public mutating func consume(_ snapshot: [ProjectRunSummary]) -> [ProjectRunSummary] {
    var completed: [ProjectRunSummary] = []
    var next: [String: String] = [:]
    for summary in snapshot.prefix(10_000) {
      guard let finished = summary.lastFinishedAt, !finished.isEmpty, summary.lastStatus != nil else { continue }
      next[summary.projectId] = finished
      if baseline && seen[summary.projectId] != finished { completed.append(summary) }
    }
    seen.merge(next) { _, latest in latest }
    if seen.count > 10_000 { seen = next }
    baseline = true
    return completed
  }
}
