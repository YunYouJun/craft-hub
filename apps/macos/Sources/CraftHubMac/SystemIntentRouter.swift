import CraftHubMacCore
import Foundation

/// A process-local handoff to existing UI. Intents cannot execute commands, grant trust, or save remote items.
@MainActor final class SystemIntentRouter {
  static let shared = SystemIntentRouter()
  enum Request: Equatable {
    case project(String)
    case capture
  }
  private var pending: Request?
  private var deliver: ((Request) -> Void)?

  func connect(_ deliver: @escaping (Request) -> Void) {
    self.deliver = deliver
    if let pending {
      self.pending = nil
      deliver(pending)
    }
  }

  func openProject(_ query: String?) throws {
    let query = (query ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard query.count <= 1024, !query.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else {
      throw RuntimeAPIError.rejected(400, "Project name or path is invalid")
    }
    accept(.project(query))
  }
  func capture() { accept(.capture) }
  private func accept(_ request: Request) {
    if let deliver { deliver(request) } else { pending = request }
  }
}
