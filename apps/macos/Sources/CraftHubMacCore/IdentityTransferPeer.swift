import CraftHubIdentityIPC
import Darwin
import Foundation
import Security

/// Authenticates a source-owned maintenance process. Construct before reading a vault or generating a transfer key.
/// No caller-supplied PID, team identifier, requirement, environment override, or ad hoc exception is accepted.
public final class IdentityTransferPeer {
  public let sourceApplication: URL
  private let parentPID: pid_t
  private let parent: SecCode
  private let recipient: SecCode
  private let sourceRequirement: SecRequirement
  private let recipientRequirement: SecRequirement
  private let sourceHash: Data
  private var messageAudit: Data?

  public init() throws {
    let pid = getppid()
    guard pid > 1 else { throw IdentityTransferError.rejected }
    var ownCode: SecCode?
    guard SecCodeCopySelf([], &ownCode) == errSecSuccess, let ownCode else {
      throw IdentityTransferError.rejected
    }
    let ownInfo = try Self.information(ownCode)
    guard let team = ownInfo[kSecCodeInfoTeamIdentifier as String] as? String else {
      throw IdentityTransferError.rejected
    }
    let ownRequirement = try TransferCodePolicy.requirement(
      identifier: TransferCodePolicy.recipientIdentifier, team: team)
    try Self.validate(ownCode, requirement: ownRequirement)
    let sourceIdentifier = try TransferCodePolicy.recipient(ownInfo, team: team)
    let requirement = try TransferCodePolicy.requirement(identifier: sourceIdentifier, team: team)
    var source: SecCode?
    guard
      SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid: pid] as CFDictionary, [], &source)
        == errSecSuccess, let source
    else { throw IdentityTransferError.rejected }
    try Self.validate(source, requirement: requirement)
    let sourceInfo = try Self.information(source)
    try TransferCodePolicy.source(sourceInfo, identifier: sourceIdentifier, team: team)
    guard let executable = sourceInfo[kSecCodeInfoMainExecutable as String] as? URL,
      let hash = sourceInfo[kSecCodeInfoUnique as String] as? Data, !hash.isEmpty
    else {
      throw IdentityTransferError.rejected
    }
    let bundle = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    guard executable.deletingLastPathComponent().lastPathComponent == "MacOS",
      executable.deletingLastPathComponent().deletingLastPathComponent().lastPathComponent == "Contents",
      bundle.pathExtension == "app", getppid() == pid
    else { throw IdentityTransferError.rejected }
    sourceApplication = bundle
    parentPID = pid
    parent = source
    recipient = ownCode
    sourceRequirement = requirement
    recipientRequirement = ownRequirement
    sourceHash = hash
  }

  /// Call before every Keychain operation and after user interaction. Retains the original code object, not a new PID lookup.
  public func revalidate() throws {
    guard getppid() == parentPID else { throw IdentityTransferError.rejected }
    try Self.validate(parent, requirement: sourceRequirement)
    try Self.validate(recipient, requirement: recipientRequirement)
    guard getppid() == parentPID else { throw IdentityTransferError.rejected }
  }

  /// The token must come from the received Mach trailer, never a JSON body or a caller-provided PID.
  func revalidate(auditToken: Data) throws {
    try revalidate()
    guard messageAudit == nil || messageAudit == auditToken,
      auditToken.withUnsafeBytes({ ch_identity_audit_pid($0.baseAddress, $0.count) }) == parentPID
    else {
      throw IdentityTransferError.rejected
    }
    var sender: SecCode?
    guard
      SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributeAudit: auditToken] as CFDictionary, [], &sender)
        == errSecSuccess, let sender
    else { throw IdentityTransferError.rejected }
    try Self.validate(sender, requirement: sourceRequirement)
    guard try Self.information(sender)[kSecCodeInfoUnique as String] as? Data == sourceHash else {
      throw IdentityTransferError.rejected
    }
    try revalidate()
    messageAudit = auditToken
  }

  private static func information(_ code: SecCode) throws -> [String: Any] {
    // Security documents this polymorphic API for both SecCode and SecStaticCode; Swift imports only the latter.
    var information: CFDictionary?
    guard
      SecCodeCopySigningInformation(
        unsafeBitCast(code, to: SecStaticCode.self), SecCSFlags(rawValue: kSecCSSigningInformation), &information)
        == errSecSuccess, let information = information as? [String: Any]
    else { throw IdentityTransferError.rejected }
    return information
  }

  private static func validate(_ code: SecCode, requirement: SecRequirement) throws {
    guard SecCodeCheckValidity(code, [], requirement) == errSecSuccess else {
      throw IdentityTransferError.rejected
    }
    var disk: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &disk) == errSecSuccess, let disk,
      SecStaticCodeCheckValidity(
        disk, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckNestedCode | kSecCSCheckAllArchitectures),
        requirement) == errSecSuccess,
      SecCodeCheckValidity(code, [], requirement) == errSecSuccess
    else { throw IdentityTransferError.rejected }
  }
}

// This policy consumes Security's sealed signing information only, never Bundle.infoDictionary or an input frame.
// These metadata checks do not validate a signature; IdentityTransferPeer does that before using them.
enum TransferCodePolicy {
  static let recipientIdentifier = "dev.craft-hub.macos-prototype"

  static func requirement(identifier: String, team: String) throws -> SecRequirement {
    guard validIdentifier(identifier), team.range(of: "^[A-Z0-9]{10}\\z", options: .regularExpression) != nil else {
      throw IdentityTransferError.rejected
    }
    let expression = """
      anchor apple generic and identifier "\(identifier)" and \
      certificate 1[field.1.2.840.113635.100.6.2.6] exists and \
      certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "\(team)"
      """
    var requirement: SecRequirement?
    guard SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess,
      let requirement
    else { throw IdentityTransferError.rejected }
    return requirement
  }

  static func recipient(_ info: [String: Any], team: String) throws -> String {
    let plist = try common(info, identifier: recipientIdentifier, team: team)
    guard let source = plist["CraftHubIdentitySourceBundleIdentifier"] as? String,
      validIdentifier(source), source != recipientIdentifier,
      integer(plist["CraftHubIdentityRecipientVersion"]) == 1
    else { throw IdentityTransferError.rejected }
    return source
  }

  static func source(_ info: [String: Any], identifier: String, team: String) throws {
    let plist = try common(info, identifier: identifier, team: team)
    // This is a signed release promise: package validation must verify fuses, ASAR integrity and maintenance isolation
    // before writing this version. Preview-only/older Electron builds deliberately lack it and cannot transfer a key.
    guard plist["CraftHubIdentityRecipientBundleIdentifier"] as? String == recipientIdentifier,
      integer(plist["CraftHubIdentityHostSecurityVersion"]) == 1,
      integer(plist["CraftHubIdentityTransferVersion"]) == 1,
      let capabilities = plist["CraftHubIdentityTransferCapabilities"] as? [String],
      capabilities.contains("coordinated-transfer")
    else { throw IdentityTransferError.rejected }
  }

  private static func common(_ info: [String: Any], identifier: String, team: String) throws -> [String: Any] {
    guard validIdentifier(identifier), team.range(of: "^[A-Z0-9]{10}\\z", options: .regularExpression) != nil,
      info[kSecCodeInfoIdentifier as String] as? String == identifier,
      info[kSecCodeInfoTeamIdentifier as String] as? String == team,
      let flags = integer(info[kSecCodeInfoFlags as String]),
      flags & Int(SecCodeSignatureFlags.runtime.rawValue) != 0, flags & Int(SecCodeSignatureFlags.adhoc.rawValue) == 0,
      let plist = info[kSecCodeInfoPList as String] as? [String: Any],
      plist["CFBundleIdentifier"] as? String == identifier,
      integer(plist["CraftHubProfileMigrationGuardVersion"]) == 1
    else { throw IdentityTransferError.rejected }
    // A hardened runtime exception allowing injection defeats parent authentication. JIT alone remains allowed
    // for Electron; broad executable-memory, library-validation, dyld and debugger exceptions do not.
    if info[kSecCodeInfoEntitlements as String] != nil && info[kSecCodeInfoEntitlementsDict as String] == nil {
      throw IdentityTransferError.rejected
    }
    if let raw = info[kSecCodeInfoEntitlementsDict as String] {
      guard let entitlements = raw as? [String: Any] else { throw IdentityTransferError.rejected }
      for key in [
        "com.apple.security.get-task-allow", "com.apple.security.cs.allow-dyld-environment-variables",
        "com.apple.security.cs.disable-library-validation", "com.apple.security.cs.allow-unsigned-executable-memory",
        "com.apple.security.cs.disable-executable-page-protection",
      ] {
        if let value = entitlements[key] {
          guard let value = value as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID(), !value.boolValue else {
            throw IdentityTransferError.rejected
          }
        }
      }
    }
    return plist
  }

  private static func validIdentifier(_ value: String) -> Bool {
    value.utf8.count <= 255
      && value.range(of: "^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+\\z", options: .regularExpression) != nil
  }

  private static func integer(_ value: Any?) -> Int? {
    guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
      value.doubleValue == Double(value.intValue)
    else { return nil }
    return value.intValue
  }
}
