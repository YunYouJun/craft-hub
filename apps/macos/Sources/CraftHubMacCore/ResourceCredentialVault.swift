import CryptoKit
import Foundation
import Security

/// Local resource credentials, isolated by profile, integration and browser origin. Never part of runtime pages.
public actor ResourceCredentialVault {
  private let service: String
  private let keychain: SecKeychain?

  public init(profile: URL, scope: String, keychain: SecKeychain? = nil) {
    let identity = profile.resolvingSymlinksInPath().standardizedFileURL.path + "\n" + scope
    service =
      "dev.craft-hub.resource-credentials."
      + SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    self.keychain = keychain
  }

  /// Metadata-only lookup. Automatic list rendering must never decrypt a password or prompt for access.
  public func contains(_ key: String) -> Bool {
    var query = selector(key)
    query[kSecReturnRef as String] = true
    var result: CFTypeRef?
    return (try? FileKeychainAccess.copyMatching(query, interactive: false, result: &result)) == errSecSuccess
  }

  /// Called only by an explicit show/copy action. No plaintext file or fallback exists.
  public func read(_ key: String) throws -> String {
    var query = selector(key)
    query[kSecReturnData as String] = true
    var result: CFTypeRef?
    let status = try FileKeychainAccess.copyMatching(query, interactive: true, result: &result)
    guard status == errSecSuccess, let data = result as? Data, data.count <= 4096,
      let value = String(data: data, encoding: .utf8), !value.isEmpty
    else { throw ResourceCredentialError.unavailable }
    return value
  }

  /// Imported credentials never leave the native host. Failure does not silently use plaintext storage.
  public func save(_ value: String, key: String) throws {
    guard !key.isEmpty, key.utf8.count <= 512, !value.isEmpty, value.utf8.count <= 4096 else {
      throw ResourceCredentialError.invalid
    }
    let data = Data(value.utf8)
    let status = try FileKeychainAccess.perform(interactive: true) {
      SecItemUpdate(selector(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    }
    if status == errSecSuccess { return }
    guard status == errSecItemNotFound else { throw ResourceCredentialError.unavailable }
    var query = selector(key)
    query.removeValue(forKey: kSecMatchSearchList as String)
    if let keychain { query[kSecUseKeychain as String] = keychain }
    query[kSecValueData as String] = data
    query[kSecAttrLabel as String] = "Craft Hub resource credential"
    let added = try FileKeychainAccess.perform(interactive: true) { SecItemAdd(query as CFDictionary, nil) }
    guard added == errSecSuccess else { throw ResourceCredentialError.unavailable }
  }

  public func remove(_ key: String) throws {
    let status = try FileKeychainAccess.perform(interactive: true) { SecItemDelete(selector(key) as CFDictionary) }
    guard status == errSecSuccess || status == errSecItemNotFound else { throw ResourceCredentialError.unavailable }
  }

  private func selector(_ key: String) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined(),
    ]
    if let keychain { query[kSecMatchSearchList as String] = [keychain] }
    return query
  }
}

public enum ResourceCredentialError: LocalizedError {
  case invalid, unavailable
  public var errorDescription: String? { "Local credential unavailable. Check secure storage or import again." }
}
