import CryptoKit
import Darwin
import Foundation
import Security

public enum IdentityTransferError: Error, LocalizedError {
  case rejected
  public var errorDescription: String? {
    "Device identity transfer was rejected. Review the source and destination again."
  }
}

/// Public, bounded review fields. The source host must independently check them before decrypting its vault.
public struct IdentityTransferRequest: Codable, Equatable, Sendable {
  public let version: Int
  public let sourceData: String
  public let sourceRevision: String
  public let deviceId: String?
  public let publicKey: String
  public let targetProfile: String
  public let endpoint: String
  public let webOrigin: String
  public let challenge: String
  public let recipientKey: String
  public let expiresAt: Int64

  var context: Data {
    let values = [
      "CRAFT-HUB-IDENTITY-TRANSFER-V1", sourceData, sourceRevision, deviceId ?? "", publicKey, targetProfile,
      endpoint, webOrigin, challenge, recipientKey, String(expiresAt),
    ]
    return Data(values.map { "\($0.utf8.count):\($0)" }.joined().utf8)
  }
}

/// One in-memory recipient. A failed or consumed envelope requires a fresh review and key; no retry or export.
public actor NativeIdentityTransfer {
  public nonisolated let request: IdentityTransferRequest
  private var recipient: Curve25519.KeyAgreement.PrivateKey?

  public init(source: URL, target: URL, endpoint: URL, webOrigin: URL, now: Date = Date()) throws {
    do {
      let source = try ProfileLockLocation.canonical(source)
      let target = try ProfileLockLocation.canonical(target)
      guard source.path != "/", target.path != "/", source != target,
        !source.path.hasPrefix(target.path + "/"), !target.path.hasPrefix(source.path + "/"),
        [source.path, target.path].allSatisfy({
          $0.utf8.count <= 4096 && !$0.contains(where: { $0 == "\r" || $0 == "\n" || $0 == "\0" })
        })
      else { throw IdentityTransferError.rejected }
      let review = try Self.readSource(source)
      let key = Curve25519.KeyAgreement.PrivateKey()
      var random = [UInt8](repeating: 0, count: 32)
      guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else {
        throw IdentityTransferError.rejected
      }
      recipient = key
      request = IdentityTransferRequest(
        version: 1, sourceData: source.path, sourceRevision: review.revision, deviceId: review.deviceId,
        publicKey: review.publicKey, targetProfile: target.path,
        endpoint: try KeychainDeviceVault.origin(endpoint), webOrigin: try KeychainDeviceVault.origin(webOrigin),
        challenge: random.map { String(format: "%02x", $0) }.joined(),
        recipientKey: key.publicKey.rawRepresentation.base64EncodedString(),
        expiresAt: Int64(now.timeIntervalSince1970 * 1000) + 120_000)
    } catch { throw IdentityTransferError.rejected }
  }

  public func cancel() { recipient = nil }

  /// Does not activate an account. The migration coordinator must stage the result under exclusive profile leases.
  public func receive(_ envelope: Data, now: Date = Date()) throws -> CloudDeviceIdentity {
    let key = recipient
    recipient = nil
    do {
      guard let key, Int64(now.timeIntervalSince1970 * 1000) < request.expiresAt,
        envelope.count <= 8192,
        let object = try JSONSerialization.jsonObject(with: envelope) as? [String: Any],
        Set(object.keys) == ["version", "challenge", "senderKey", "sealed"],
        let version = object["version"] as? NSNumber,
        CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
        object["challenge"] as? String == request.challenge,
        let sender = object["senderKey"] as? String,
        let senderData = Data(base64Encoded: sender), senderData.count == 32,
        senderData.base64EncodedString() == sender,
        let sealed = object["sealed"] as? String,
        let sealedData = Data(base64Encoded: sealed), sealedData.count >= 28, sealedData.count <= 4096,
        sealedData.base64EncodedString() == sealed,
        try ProfileLockLocation.canonical(URL(fileURLWithPath: request.sourceData)).path == request.sourceData,
        try ProfileLockLocation.canonical(URL(fileURLWithPath: request.targetProfile)).path == request.targetProfile
      else { throw IdentityTransferError.rejected }
      let source = try Self.readSource(URL(fileURLWithPath: request.sourceData))
      guard source.revision == request.sourceRevision, source.publicKey == request.publicKey,
        source.deviceId == request.deviceId
      else { throw IdentityTransferError.rejected }
      let secret = try key.sharedSecretFromKeyAgreement(
        with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: senderData))
      let salt = Data(
        stride(from: 0, to: request.challenge.count, by: 2).map { offset in
          let start = request.challenge.index(request.challenge.startIndex, offsetBy: offset)
          return UInt8(request.challenge[start..<request.challenge.index(start, offsetBy: 2)], radix: 16)!
        })
      let symmetric = secret.hkdfDerivedSymmetricKey(
        using: SHA256.self, salt: salt, sharedInfo: Data("CRAFT-HUB-IDENTITY-TRANSFER-V1".utf8), outputByteCount: 32)
      var plain = try AES.GCM.open(
        AES.GCM.SealedBox(combined: sealedData), using: symmetric, authenticating: request.context)
      defer { plain.resetBytes(in: 0..<plain.count) }
      guard let value = try JSONSerialization.jsonObject(with: plain) as? [String: Any],
        Set(value.keys)
          == (request.deviceId == nil ? ["privateKey", "publicKey"] : ["deviceId", "privateKey", "publicKey"])
      else { throw IdentityTransferError.rejected }
      let identity = try JSONDecoder().decode(CloudDeviceIdentity.self, from: plain)
      try identity.validate()
      guard identity.deviceId == request.deviceId, identity.publicKey == request.publicKey else {
        throw IdentityTransferError.rejected
      }
      return identity
    } catch { throw IdentityTransferError.rejected }
  }

  private static func readSource(_ source: URL) throws -> (revision: String, publicKey: String, deviceId: String?) {
    let descriptor = Darwin.open(
      source.appendingPathComponent("personal-cloud-device.json").path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
    guard descriptor >= 0 else { throw IdentityTransferError.rejected }
    defer { Darwin.close(descriptor) }
    var info = stat()
    guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
      info.st_uid == getuid(), info.st_nlink == 1, info.st_size <= 16 * 1024
    else { throw IdentityTransferError.rejected }
    var bytes = [UInt8](repeating: 0, count: 16 * 1024 + 1)
    let count = Darwin.read(descriptor, &bytes, bytes.count)
    guard count >= 0, count <= 16 * 1024 else { throw IdentityTransferError.rejected }
    let data = Data(bytes.prefix(count))
    guard let stored = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      Set(stored.keys).isSubset(of: ["schemaVersion", "deviceId", "publicKey", "encryptedPrivateKey"]),
      let version = stored["schemaVersion"] as? NSNumber,
      CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
      let publicKey = stored["publicKey"] as? String,
      let encrypted = stored["encryptedPrivateKey"] as? String, !encrypted.isEmpty,
      let cipher = Data(base64Encoded: encrypted), cipher.base64EncodedString() == encrypted
    else { throw IdentityTransferError.rejected }
    try CloudDeviceIdentity.validatePublicKey(publicKey)
    let deviceId = stored["deviceId"] as? String
    if stored["deviceId"] != nil {
      guard let deviceId, deviceId.range(of: "^[A-Za-z0-9_.-]{1,128}$", options: .regularExpression) != nil else {
        throw IdentityTransferError.rejected
      }
    }
    return (SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), publicKey, deviceId)
  }
}
