import Foundation

/// Durable native draft and retry identity; contains no authentication credentials.
public struct CaptureDocument: Codable, Equatable {
  public var text = ""
  public var draft = CaptureDraft()
  public var requestID: String?
  public var fingerprint: String?
  public var preferredLists: [String: String] = [:]
  public var receipt: String?
  public init() {}

  /// Reuse the same ID after a timeout or restart, including when the runtime accepted an unseen response.
  public mutating func prepareAttempt(payload: [String: String], important: Bool) throws -> String {
    var fields: [String: Any] = payload
    fields["important"] = important
    let fingerprint = String(
      decoding: try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]), as: UTF8.self)
    if self.fingerprint != fingerprint || requestID == nil {
      self.fingerprint = fingerprint
      requestID = UUID().uuidString.lowercased()
    }
    return requestID!
  }
}

public struct CaptureDraftStore {
  public let url: URL
  public init(url: URL) { self.url = url }
  public func load() throws -> CaptureDocument {
    guard FileManager.default.fileExists(atPath: url.path) else { return CaptureDocument() }
    return try JSONDecoder().decode(CaptureDocument.self, from: Data(contentsOf: url))
  }
  /// Persist before a remote mutation, with private permissions and an atomic replacement.
  public func save(_ document: CaptureDocument) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    try JSONEncoder().encode(document).write(to: url, options: [.atomic])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }
}
