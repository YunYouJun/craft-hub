import Foundation

/// Ranked personal work and source coverage supplied by the runtime; native UI does not repeat ranking rules.
public struct TodayFocusSnapshot: Decodable, Sendable {
  public struct Source: Decodable, Identifiable, Sendable {
    public let key: String
    public let title: String
    public let sectionTitle: String?
    public let path: String
    public let state: String
    public let complete: Bool
    public let cached: Bool
    public let count: Int
    public var id: String { key }
  }
  public struct Item: Decodable, Identifiable, Sendable {
    public let key: String
    public let title: String
    public let sourceTitle: String
    public let path: String
    public let reasons: [String]
    public let status: String?
    public let project: String?
    public var id: String { key }
  }
  public struct Candidate: Codable, Sendable {
    public let key: String
    public let title: String
    public let source: String
    public let project: String?
    public let status: String?
    public let priority: String?
    public let due: String?
    public let reasons: [String]
  }
  public let version: Int
  public let checkedAt: String
  public let sourceCount: Int
  public let total: Int
  public let sources: [Source]
  public let items: [Item]
  public let candidates: [Candidate]

  /// Describe loaded coverage explicitly instead of presenting a bounded page as the whole account.
  public var loadedSourceCount: Int { sources.filter { $0.state == "loaded" }.count }
  public var completeSourceCount: Int { sources.filter { $0.state == "loaded" && $0.complete }.count }
}

public struct TodayFocusAnalysis: Decodable, Sendable {
  public struct Recommendation: Decodable, Sendable {
    public let key: String
    public let reason: String
    public let nextStep: String
  }
  public let summary: String
  public let items: [Recommendation]
}

extension RuntimeAPIClient {
  /// Read global, unconfirmed work-item sources through the shared projection.
  public func todayFocus(locale: String) async throws -> TodayFocusSnapshot {
    let snapshot: TodayFocusSnapshot = try await fetch(
      path: "/api/workbench/today", query: [.init(name: "locale", value: locale)])
    guard snapshot.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return snapshot
  }

  /// Analyze the currently reviewed snapshot only after an explicit user request.
  public func analyzeTodayFocus(_ snapshot: TodayFocusSnapshot, locale: String) async throws -> TodayFocusAnalysis {
    struct Input: Encodable {
      let candidates: [TodayFocusSnapshot.Candidate]
      let localNow: String
      let locale: String
      let coverage: String
    }
    let input = Input(
      candidates: snapshot.candidates, localNow: CaptureDates.local(Date()), locale: locale,
      coverage:
        "\(snapshot.loadedSourceCount)/\(snapshot.sourceCount) sources read; \(snapshot.completeSourceCount) complete; \(snapshot.total) personal unfinished items; \(snapshot.candidates.count) candidates supplied."
    )
    return try await fetch(path: "/api/work-assistant/focus", body: JSONEncoder().encode(input), timeout: 100)
  }
}
