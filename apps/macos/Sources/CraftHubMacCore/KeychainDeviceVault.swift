import CryptoKit
import Foundation
import Security

/// A profile- and cloud-scoped Ed25519 identity. No key material is written into the profile directory.
/// Security calls run on this actor, not the UI actor. Automatic reads never trigger authentication UI.
public actor KeychainDeviceVault {
  private let service: String
  private let keychain: SecKeychain?
  private static let account = "device-v1"
  private static let transferAccount = "device-transfer-v1"

  private struct Transfer: Codable {
    let request: IdentityTransferRequest
    let identity: CloudDeviceIdentity
    var activated: Bool
  }

  public struct TransferState: Sendable {
    public let request: IdentityTransferRequest
    public let activated: Bool
  }

  /// A specific keychain is used only by isolated tests; production uses the user's system keychain.
  public init(profile: URL, endpoint: URL, webOrigin: URL, keychain: SecKeychain? = nil) throws {
    let canonical = try ProfileLockLocation.canonical(profile)
    let origins = try [endpoint, webOrigin].map(Self.origin)
    let scope = String(decoding: try JSONEncoder().encode([canonical.path] + origins), as: UTF8.self)
    service = "dev.craft-hub.macos-prototype.personal-cloud." + ProfileLockLocation.digest(scope)
    self.keychain = keychain
  }

  public func load(interactive: Bool = false) throws -> CloudDeviceIdentity? {
    guard try transfer(interactive: interactive) == nil else { throw DeviceVaultError.migrationPending }
    return try activeIdentity(interactive: interactive)
  }

  private func activeIdentity(interactive: Bool) throws -> CloudDeviceIdentity? {
    var query = selector(interactive: interactive)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = try FileKeychainAccess.copyMatching(query, interactive: interactive, result: &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw DeviceVaultError.unavailable }
    guard data.count <= 4096, let identity = try? JSONDecoder().decode(CloudDeviceIdentity.self, from: data) else {
      throw DeviceVaultError.invalidIdentity
    }
    try identity.validate()
    return identity
  }

  /// Called only after an explicit connection action. Missing storage never causes a plaintext fallback.
  public func loadOrCreate() throws -> CloudDeviceIdentity {
    if let identity = try load(interactive: true) { return identity }
    let identity = try CloudDeviceIdentity.create()
    var query = selector(interactive: true)
    query.removeValue(forKey: kSecMatchSearchList as String)
    if let keychain { query[kSecUseKeychain as String] = keychain }
    query[kSecValueData as String] = try JSONEncoder().encode(identity)
    query[kSecAttrLabel as String] = "Craft Hub native personal-cloud device"
    let status = try FileKeychainAccess.perform(interactive: true) { SecItemAdd(query as CFDictionary, nil) }
    if status == errSecDuplicateItem, let current = try load(interactive: true) { return current }
    guard status == errSecSuccess else { throw DeviceVaultError.unavailable }
    return identity
  }

  /// Registration cannot replace a key that another connection or migration changed.
  public func register(expected: CloudDeviceIdentity, deviceId: String) throws -> CloudDeviceIdentity {
    try expected.validate()
    guard let current = try load(interactive: true), current == expected else { throw DeviceVaultError.identityChanged }
    let registered = try current.registered(as: deviceId)
    let status = try FileKeychainAccess.perform(interactive: true) {
      SecItemUpdate(
        selector(interactive: true) as CFDictionary,
        [kSecValueData as String: try JSONEncoder().encode(registered)] as CFDictionary)
    }
    guard status == errSecSuccess else { throw DeviceVaultError.unavailable }
    return registered
  }

  /// Delete only the identity the user disconnected, never an unrelated or subsequently migrated item.
  public func clear(expected: CloudDeviceIdentity) throws {
    try expected.validate()
    guard let current = try load(interactive: true) else { return }
    guard current == expected else { throw DeviceVaultError.identityChanged }
    let status = try FileKeychainAccess.perform(interactive: true) {
      SecItemDelete(selector(interactive: true) as CFDictionary)
    }
    guard status == errSecSuccess || status == errSecItemNotFound else { throw DeviceVaultError.unavailable }
  }

  /// Metadata only, for recovery. Pending transfers always keep ordinary account reads and mutations closed.
  public func transferState() throws -> TransferState? {
    try transfer(interactive: false).map { TransferState(request: $0.request, activated: $0.activated) }
  }

  /// Metadata-only recovery inspection. The host must authenticate its coordinator and hold all profile leases.
  public func migrationState(_ context: ProfileIdentityContext) throws -> ProfileIdentityState {
    try migrationState(context, interactive: false)
  }

  /// Stage only the identity request bound to the coordinator's reviewed source, target, cloud and device.
  public func stageMigration(
    _ identity: CloudDeviceIdentity, request: IdentityTransferRequest, context: ProfileIdentityContext
  ) throws {
    try validateMigrationScope(context)
    guard context.matches(request) else { throw DeviceVaultError.identityChanged }
    try stageTransfer(identity, request: request)
  }

  /// Idempotent preparation; an already finished transfer is inspected separately by the coordinator.
  public func activateMigration(_ context: ProfileIdentityContext) throws {
    let state = try migrationState(context, interactive: true)
    guard state == .staged || state == .activated else { throw DeviceVaultError.identityChanged }
    try activateTransfer(id: context.identity.id)
  }

  /// The coordinator must persist its commit decision before releasing this reservation.
  public func finishMigration(_ context: ProfileIdentityContext) throws {
    let state = try migrationState(context, interactive: true)
    if state == .active { return }
    guard state == .activated else { throw DeviceVaultError.identityChanged }
    try finishTransfer(id: context.identity.id)
  }

  /// Used only after a durable rollback decision and source-preservation check under exclusive profile leases.
  /// Unlike abortTransfer, this also handles a finished transfer, and never removes an unrelated active device.
  public func rollbackMigration(_ context: ProfileIdentityContext) throws {
    let state = try migrationState(context, interactive: true)
    switch state {
    case .empty: return
    case .staged, .activated: try abortTransfer(id: context.identity.id)
    case .active:
      guard let current = try activeIdentity(interactive: true) else { throw DeviceVaultError.identityChanged }
      try clear(expected: current)
    }
  }

  private func migrationState(_ context: ProfileIdentityContext, interactive: Bool) throws -> ProfileIdentityState {
    try validateMigrationScope(context)
    let pending = try transfer(interactive: interactive)
    let current = try activeIdentity(interactive: interactive)
    if let pending {
      guard context.matches(pending.request), current == nil || current == pending.identity,
        !pending.activated || current == pending.identity
      else { throw DeviceVaultError.identityChanged }
      return pending.activated ? .activated : .staged
    }
    guard let current else { return .empty }
    guard current.publicKey == context.identity.publicKey, current.deviceId == context.identity.deviceId else {
      throw DeviceVaultError.identityChanged
    }
    return .active
  }

  private func validateMigrationScope(_ context: ProfileIdentityContext) throws {
    let binding = context.identity
    guard binding.id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      binding.sourceRevision.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      let endpoint = URL(string: binding.endpoint), let web = URL(string: binding.webOrigin),
      try Self.origin(endpoint) == binding.endpoint, try Self.origin(web) == binding.webOrigin,
      try ProfileLockLocation.canonical(URL(fileURLWithPath: context.paths.target)).path == context.paths.target,
      try ProfileLockLocation.canonical(URL(fileURLWithPath: context.paths.sourceData)).path
        == context.paths.sourceData,
      try ProfileLockLocation.canonical(URL(fileURLWithPath: context.paths.sourceConfig)).path
        == context.paths.sourceConfig,
      try ProfileLockLocation.canonical(URL(fileURLWithPath: context.transaction)).path == context.transaction
    else { throw DeviceVaultError.invalidScope }
    let scope = String(
      decoding: try JSONEncoder().encode([context.paths.target, binding.endpoint, binding.webOrigin]), as: UTF8.self)
    guard service == "dev.craft-hub.macos-prototype.personal-cloud." + ProfileLockLocation.digest(scope) else {
      throw DeviceVaultError.invalidScope
    }
  }

  /// Reserve an empty destination and persist only in Keychain. The caller holds exclusive profile leases.
  public func stageTransfer(_ identity: CloudDeviceIdentity, request: IdentityTransferRequest) throws {
    try identity.validate()
    try validateTransferScope(request)
    guard request.publicKey == identity.publicKey, request.deviceId == identity.deviceId else {
      throw DeviceVaultError.invalidIdentity
    }
    if let existing = try transfer(interactive: true) {
      guard existing.request == request, existing.identity == identity else { throw DeviceVaultError.migrationPending }
      return
    }
    guard request.expiresAt > Int64(Date().timeIntervalSince1970 * 1000),
      request.expiresAt <= Int64(Date().timeIntervalSince1970 * 1000) + 120_000
    else { throw DeviceVaultError.identityChanged }
    guard try activeIdentity(interactive: true) == nil else { throw DeviceVaultError.identityChanged }
    var query = selector(interactive: true, account: Self.transferAccount)
    query.removeValue(forKey: kSecMatchSearchList as String)
    if let keychain { query[kSecUseKeychain as String] = keychain }
    query[kSecAttrLabel as String] = "Craft Hub pending device identity transfer"
    query[kSecValueData as String] = try JSONEncoder().encode(
      Transfer(request: request, identity: identity, activated: false))
    let status = try FileKeychainAccess.perform(interactive: true) { SecItemAdd(query as CFDictionary, nil) }
    guard status == errSecSuccess else { throw DeviceVaultError.unavailable }
  }

  /// Prepare activation after the data copy; the reservation still blocks automatic cloud startup until finish.
  public func activateTransfer(id: String) throws {
    var pending = try requireTransfer(id)
    if let current = try activeIdentity(interactive: true) {
      guard current == pending.identity else { throw DeviceVaultError.identityChanged }
    } else {
      var query = selector(interactive: true)
      query.removeValue(forKey: kSecMatchSearchList as String)
      if let keychain { query[kSecUseKeychain as String] = keychain }
      query[kSecAttrLabel as String] = "Craft Hub native personal-cloud device"
      query[kSecValueData as String] = try JSONEncoder().encode(pending.identity)
      guard
        try FileKeychainAccess.perform(interactive: true, { SecItemAdd(query as CFDictionary, nil) }) == errSecSuccess
      else { throw DeviceVaultError.unavailable }
    }
    pending.activated = true
    guard
      try FileKeychainAccess.perform(
        interactive: true,
        {
          SecItemUpdate(
            selector(interactive: true, account: Self.transferAccount) as CFDictionary,
            [kSecValueData as String: try JSONEncoder().encode(pending)] as CFDictionary)
        }) == errSecSuccess
    else { throw DeviceVaultError.unavailable }
  }

  /// Release the reservation only after the coordinator durably records a complete profile transaction.
  public func finishTransfer(id: String) throws {
    let pending = try requireTransfer(id)
    guard pending.activated, try activeIdentity(interactive: true) == pending.identity else {
      throw DeviceVaultError.identityChanged
    }
    try deleteTransfer()
  }

  /// Restore the previously empty destination, including interruption between active-item and marker writes.
  /// Never revoke or modify the source device; an unrelated destination identity is preserved for recovery.
  public func abortTransfer(id: String) throws {
    let pending = try requireTransfer(id)
    if let current = try activeIdentity(interactive: true) {
      guard current == pending.identity else { throw DeviceVaultError.identityChanged }
      guard
        try FileKeychainAccess.perform(
          interactive: true,
          {
            SecItemDelete(selector(interactive: true) as CFDictionary)
          }) == errSecSuccess
      else {
        throw DeviceVaultError.unavailable
      }
    }
    try deleteTransfer()
  }

  private func requireTransfer(_ id: String) throws -> Transfer {
    guard let pending = try transfer(interactive: true), pending.request.challenge == id else {
      throw DeviceVaultError.identityChanged
    }
    return pending
  }

  private func deleteTransfer() throws {
    guard
      try FileKeychainAccess.perform(
        interactive: true,
        {
          SecItemDelete(selector(interactive: true, account: Self.transferAccount) as CFDictionary)
        }) == errSecSuccess
    else {
      throw DeviceVaultError.unavailable
    }
  }

  private func transfer(interactive: Bool) throws -> Transfer? {
    var query = selector(interactive: interactive, account: Self.transferAccount)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = try FileKeychainAccess.copyMatching(query, interactive: interactive, result: &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw DeviceVaultError.unavailable }
    guard data.count <= 16 * 1024, let pending = try? JSONDecoder().decode(Transfer.self, from: data) else {
      throw DeviceVaultError.invalidIdentity
    }
    try pending.identity.validate()
    try validateTransferScope(pending.request)
    guard pending.request.deviceId == pending.identity.deviceId, pending.request.publicKey == pending.identity.publicKey
    else {
      throw DeviceVaultError.invalidIdentity
    }
    return pending
  }

  private func validateTransferScope(_ request: IdentityTransferRequest) throws {
    guard request.version == 1, request.challenge.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      request.sourceRevision.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      let endpoint = URL(string: request.endpoint), let web = URL(string: request.webOrigin),
      try Self.origin(endpoint) == request.endpoint, try Self.origin(web) == request.webOrigin,
      try ProfileLockLocation.canonical(URL(fileURLWithPath: request.targetProfile)).path == request.targetProfile
    else { throw DeviceVaultError.invalidScope }
    let scope = String(
      decoding: try JSONEncoder().encode([request.targetProfile, request.endpoint, request.webOrigin]), as: UTF8.self)
    guard service == "dev.craft-hub.macos-prototype.personal-cloud." + ProfileLockLocation.digest(scope) else {
      throw DeviceVaultError.invalidScope
    }
  }

  private func selector(interactive: Bool, account: String = KeychainDeviceVault.account) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecUseAuthenticationUI as String: interactive ? kSecUseAuthenticationUIAllow : kSecUseAuthenticationUIFail,
    ]
    if let keychain { query[kSecMatchSearchList as String] = [keychain] }
    // File-based macOS Keychain supports local/ad-hoc builds. Do not request synchronizable/data-protection items
    // or fabricate access-group entitlements; Developer ID access behavior is a separate release acceptance gate.
    return query
  }

  static func origin(_ url: URL) throws -> String {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      let host = components.host, !host.isEmpty,
      let scheme = components.scheme?.lowercased(),
      scheme == "https"
        || (scheme == "http" && ["127.0.0.1", "localhost", "[::1]", "::1"].contains(host.lowercased())),
      components.user == nil, components.password == nil, components.query == nil, components.fragment == nil,
      components.port.map({ (1...65535).contains($0) }) ?? true,
      ["", "/"].contains(components.percentEncodedPath)
    else { throw DeviceVaultError.invalidScope }
    var canonical = components
    canonical.scheme = scheme
    canonical.host = host.lowercased()
    canonical.path = ""
    if (canonical.scheme == "https" && canonical.port == 443) || (canonical.scheme == "http" && canonical.port == 80) {
      canonical.port = nil
    }
    guard let value = canonical.string else { throw DeviceVaultError.invalidScope }
    return value
  }
}
