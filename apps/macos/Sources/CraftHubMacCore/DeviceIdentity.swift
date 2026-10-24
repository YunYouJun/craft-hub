import CryptoKit
import Foundation

/// Matches the shared personal-cloud controller. Private material belongs only to the host and its private pipe.
public struct CloudDeviceIdentity: Codable, Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
  public let deviceId: String?
  public let privateKey: String
  public let publicKey: String
  public var description: String { "CloudDeviceIdentity(<redacted>)" }
  public var debugDescription: String { description }

  public init(deviceId: String? = nil, privateKey: String, publicKey: String) throws {
    self.deviceId = deviceId
    self.privateKey = privateKey
    self.publicKey = publicKey
    try validate()
  }

  /// Ed25519 PKCS#8/SPKI encoding used by the existing Node vault; never invent a second identity format.
  public static func create() throws -> Self {
    let key = Curve25519.Signing.PrivateKey()
    return try Self(
      privateKey: pem(Data(privatePrefix) + key.rawRepresentation, label: "PRIVATE KEY"),
      publicKey: pem(Data(publicPrefix) + key.publicKey.rawRepresentation, label: "PUBLIC KEY"))
  }

  public func registered(as id: String) throws -> Self {
    try Self(deviceId: id, privateKey: privateKey, publicKey: publicKey)
  }

  /// Reject malformed, mismatched and unsupported keys before accepting stored or transferred material.
  public func validate() throws {
    if let deviceId {
      guard !deviceId.isEmpty, deviceId.utf8.count <= 128,
        deviceId.utf8.allSatisfy({
          (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || [45, 46, 95].contains($0)
        })
      else { throw DeviceVaultError.invalidIdentity }
    }
    let secret = try Self.raw(privateKey, label: "PRIVATE KEY", prefix: Self.privatePrefix)
    let publicBytes = try Self.raw(publicKey, label: "PUBLIC KEY", prefix: Self.publicPrefix)
    guard let derived = try? Curve25519.Signing.PrivateKey(rawRepresentation: secret),
      derived.publicKey.rawRepresentation == publicBytes
    else { throw DeviceVaultError.invalidIdentity }
  }

  static func validatePublicKey(_ publicKey: String) throws {
    _ = try Curve25519.Signing.PublicKey(rawRepresentation: raw(publicKey, label: "PUBLIC KEY", prefix: publicPrefix))
  }

  private static let privatePrefix: [UInt8] = [
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]
  private static let publicPrefix: [UInt8] = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]

  private static func pem(_ data: Data, label: String) -> String {
    let base64 = Array(data.base64EncodedString())
    let lines = stride(from: 0, to: base64.count, by: 64).map { String(base64[$0..<min($0 + 64, base64.count)]) }
    return "-----BEGIN \(label)-----\n" + lines.joined(separator: "\n") + "\n-----END \(label)-----\n"
  }

  private static func raw(_ pem: String, label: String, prefix: [UInt8]) throws -> Data {
    guard pem.utf8.count <= 1024 else { throw DeviceVaultError.invalidIdentity }
    let lines = pem.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: .newlines)
    guard lines.first == "-----BEGIN \(label)-----", lines.last == "-----END \(label)-----",
      let bytes = Data(base64Encoded: lines.dropFirst().dropLast().joined()),
      bytes.count == prefix.count + 32, bytes.starts(with: prefix)
    else { throw DeviceVaultError.invalidIdentity }
    return bytes.dropFirst(prefix.count)
  }
}

public enum DeviceVaultError: Error, LocalizedError, Equatable {
  case unavailable, invalidIdentity, identityChanged, invalidScope, migrationPending
  public var errorDescription: String? {
    switch self {
    case .unavailable: return "Secure storage is locked or unavailable. Read its state again before continuing."
    case .invalidIdentity: return "The stored device identity is invalid. Preserve it for recovery."
    case .identityChanged: return "The device identity changed. Refresh before continuing."
    case .invalidScope: return "The secure-storage scope is invalid."
    case .migrationPending: return "A device identity transfer needs recovery before this account can be used."
    }
  }
}
