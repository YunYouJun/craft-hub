import Foundation

/// Public journal binding shared with the runtime coordinator. This value never contains device secrets or ciphertext.
public struct ProfileIdentityContext: Codable, Equatable, Sendable {
  public struct Paths: Codable, Equatable, Sendable {
    public let sourceData: String
    public let sourceConfig: String
    public let target: String
  }
  public struct Identity: Codable, Equatable, Sendable {
    public let id: String
    public let sourceRevision: String
    public let publicKey: String
    public let deviceId: String?
    public let endpoint: String
    public let webOrigin: String
  }
  public let transaction: String
  public let paths: Paths
  public let identity: Identity

  func matches(_ request: IdentityTransferRequest) -> Bool {
    request.challenge == identity.id && request.sourceRevision == identity.sourceRevision
      && request.publicKey == identity.publicKey && request.deviceId == identity.deviceId
      && request.endpoint == identity.endpoint && request.webOrigin == identity.webOrigin
      && request.sourceData == paths.sourceData && request.targetProfile == paths.target
  }
}

/// A recreated native recipient can distinguish a lost acknowledgement from an operation that did not happen.
public enum ProfileIdentityState: String, Codable, Sendable {
  case empty, staged, activated, active
}
