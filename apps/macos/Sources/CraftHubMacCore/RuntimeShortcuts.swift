import Foundation

extension RuntimeAPIClient {
  /// Read only the runtime-owned shortcut map; native menus never retain unrelated settings.
  public func shortcuts() async throws -> [String: String] {
    struct Settings: Decodable {
      let shortcuts: [String: String]?
      enum CodingKeys: String, CodingKey { case shortcuts = "workbench.shortcuts" }
    }
    struct Snapshot: Decodable { let settings: Settings }
    let snapshot: Snapshot = try await fetch(path: "/api/settings")
    return snapshot.settings.shortcuts ?? [:]
  }
}
