import Foundation

/// The shared launcher supplies terminal application IDs; a native client never accepts an arbitrary launch path.
public struct ProjectTerminalApplications: Decodable, Equatable, Sendable {
  public let version: Int
  public let applications: [String]
}

/// Opening a directory creates an independent external session, without executing a project command.
public struct ProjectTerminalReceipt: Decodable, Equatable, Sendable {
  public let version: Int
  public let destination: String
  public let application: String
}

extension RuntimeAPIClient {
  /// Inspect currently available terminal applications through the authenticated native host contract.
  public func projectTerminalApplications() async throws -> [String] {
    let result: ProjectTerminalApplications = try await fetch(path: "/api/native-host/terminal-applications")
    guard result.version == 1, result.applications.count <= 64,
      Set(result.applications).count == result.applications.count,
      result.applications.allSatisfy({ Self.validTerminalApplication($0) })
    else { throw RuntimeAPIError.invalidResponse }
    return result.applications
  }

  /// Send registered IDs only. The runtime re-reads the project or command and derives its contained directory.
  public func openProjectTerminal(projectID: String, application: String, capabilityID: String? = nil) async throws
    -> ProjectTerminalReceipt
  {
    struct Request: Encodable {
      let projectId: String
      let application: String
      let capabilityId: String?
    }
    guard !projectID.isEmpty, Self.validTerminalApplication(application), capabilityID?.isEmpty != true else {
      throw RuntimeAPIError.invalidEndpoint
    }
    let body = try JSONEncoder().encode(
      Request(projectId: projectID, application: application, capabilityId: capabilityID))
    let result: ProjectTerminalReceipt = try await fetch(path: "/api/native-host/open-project-terminal", body: body)
    guard result.version == 1, result.destination == "terminal", result.application == application else {
      throw RuntimeAPIError.invalidResponse
    }
    return result
  }

  private static func validTerminalApplication(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 256
      && !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
  }
}
