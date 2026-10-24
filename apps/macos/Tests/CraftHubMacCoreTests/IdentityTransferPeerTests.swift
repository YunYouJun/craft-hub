import Foundation
import Security
import Testing

@testable import CraftHubMacCore

private let peerTeam = "ABCDE12345"
private let peerSource = "org.example.craft-hub"

private func peerInformation(source: Bool = false) -> [String: Any] {
  let identifier = source ? peerSource : TransferCodePolicy.recipientIdentifier
  var plist: [String: Any] = [
    "CFBundleIdentifier": identifier, "CraftHubProfileMigrationGuardVersion": 1,
  ]
  if source {
    plist["CraftHubIdentityRecipientBundleIdentifier"] = TransferCodePolicy.recipientIdentifier
    plist["CraftHubIdentityHostSecurityVersion"] = 1
    plist["CraftHubIdentityTransferVersion"] = 1
    plist["CraftHubIdentityTransferCapabilities"] = ["preview", "coordinated-transfer"]
  } else {
    plist["CraftHubIdentitySourceBundleIdentifier"] = peerSource
    plist["CraftHubIdentityRecipientVersion"] = 1
  }
  return [
    kSecCodeInfoIdentifier as String: identifier,
    kSecCodeInfoTeamIdentifier as String: peerTeam,
    kSecCodeInfoFlags as String: SecCodeSignatureFlags.runtime.rawValue,
    kSecCodeInfoPList as String: plist,
  ]
}

@Test func identityPeerPolicyRequiresBothReleaseContracts() throws {
  #expect(try TransferCodePolicy.recipient(peerInformation(), team: peerTeam) == peerSource)
  try TransferCodePolicy.source(peerInformation(source: true), identifier: peerSource, team: peerTeam)
  for source in [true, false] {
    var info = peerInformation(source: source)
    var plist = info[kSecCodeInfoPList as String] as! [String: Any]
    let key = source ? "CraftHubIdentityHostSecurityVersion" : "CraftHubIdentityRecipientVersion"
    for value: Any in [NSNull(), true, 0, 2, 1.5, "1"] {
      plist[key] = value
      info[kSecCodeInfoPList as String] = plist
      #expect(throws: IdentityTransferError.self) {
        if source {
          try TransferCodePolicy.source(info, identifier: peerSource, team: peerTeam)
        } else {
          _ = try TransferCodePolicy.recipient(info, team: peerTeam)
        }
      }
    }
  }
}

@Test func identityPeersRejectOldGuardsWrongIdentifiersAndUnsignedFlags() {
  let variants: [[String: Any]] = [
    [kSecCodeInfoIdentifier as String: "org.example.unrelated"],
    [kSecCodeInfoTeamIdentifier as String: "OTHER12345"],
    [kSecCodeInfoFlags as String: 0],
    [kSecCodeInfoFlags as String: SecCodeSignatureFlags.runtime.rawValue | SecCodeSignatureFlags.adhoc.rawValue],
    [kSecCodeInfoFlags as String: true],
    [kSecCodeInfoPList as String: ["CFBundleIdentifier": TransferCodePolicy.recipientIdentifier]],
  ]
  for variant in variants {
    let info = peerInformation().merging(variant) { _, new in new }
    #expect(throws: IdentityTransferError.self) { try TransferCodePolicy.recipient(info, team: peerTeam) }
  }
  for value: Any in [NSNull(), 0, true, "1", 1.5] {
    var info = peerInformation()
    var plist = info[kSecCodeInfoPList as String] as! [String: Any]
    plist["CraftHubProfileMigrationGuardVersion"] = value
    info[kSecCodeInfoPList as String] = plist
    #expect(throws: IdentityTransferError.self) { try TransferCodePolicy.recipient(info, team: peerTeam) }
  }
}

@Test func identityPeerRejectsPreviewOnlySourcesAndWrongRecipient() {
  for replacement: [String: Any] in [
    ["CraftHubIdentityTransferCapabilities": ["preview"]],
    ["CraftHubIdentityTransferCapabilities": "coordinated-transfer"],
    ["CraftHubIdentityRecipientBundleIdentifier": "org.example.other-recipient"],
    ["CFBundleIdentifier": "org.example.other-source"],
  ] {
    var info = peerInformation(source: true)
    let plist = info[kSecCodeInfoPList as String] as! [String: Any]
    info[kSecCodeInfoPList as String] = plist.merging(replacement) { _, new in new }
    #expect(throws: IdentityTransferError.self) {
      try TransferCodePolicy.source(info, identifier: peerSource, team: peerTeam)
    }
  }
}

@Test(arguments: [
  "com.apple.security.get-task-allow", "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.disable-library-validation", "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-executable-page-protection",
])
func identityPeersRejectCodeInjectionExceptions(_ key: String) throws {
  var info = peerInformation()
  for value: Any in [true, 1, 0, "false", NSNull()] {
    info[kSecCodeInfoEntitlementsDict as String] = [key: value]
    #expect(throws: IdentityTransferError.self) { try TransferCodePolicy.recipient(info, team: peerTeam) }
  }
  info[kSecCodeInfoEntitlementsDict as String] = [key: false, "com.apple.security.cs.allow-jit": true]
  #expect(try TransferCodePolicy.recipient(info, team: peerTeam) == peerSource)
}

@Test func identityPeerRejectsUndecodableEntitlements() {
  var info = peerInformation()
  info[kSecCodeInfoEntitlements as String] = Data([1, 2, 3])
  #expect(throws: IdentityTransferError.self) { try TransferCodePolicy.recipient(info, team: peerTeam) }
  info[kSecCodeInfoEntitlementsDict as String] = "invalid"
  #expect(throws: IdentityTransferError.self) { try TransferCodePolicy.recipient(info, team: peerTeam) }
}

@Test func identityPeerRequirementsCompileAndRejectInterpolation() throws {
  _ = try TransferCodePolicy.requirement(identifier: TransferCodePolicy.recipientIdentifier, team: peerTeam)
  for identifier in ["", "org.example\" or true", "-invalid", String(repeating: "x", count: 256), "org.example\n"] {
    #expect(throws: IdentityTransferError.self) {
      try TransferCodePolicy.requirement(identifier: identifier, team: peerTeam)
    }
  }
  for team in ["", "abcde12345", "ABCDE12345\" or true", "ABCDE12345\n"] {
    #expect(throws: IdentityTransferError.self) {
      try TransferCodePolicy.requirement(identifier: peerSource, team: team)
    }
  }
}

@Test func identityPeerCannotBeCreatedByTheTestRunner() {
  // Exercises the real Security APIs and real current/parent processes. Unit fixtures above cannot authenticate a peer.
  #expect(throws: IdentityTransferError.self) { try IdentityTransferPeer() }
}

@Test func copiedAdHocApplicationCannotForgeDeveloperIDIdentity() throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let app = root.appendingPathComponent("Fixture.app")
  let contents = app.appendingPathComponent("Contents")
  let executable = contents.appendingPathComponent("MacOS/Fixture")
  try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  try FileManager.default.copyItem(at: URL(fileURLWithPath: "/usr/bin/true"), to: executable)
  var plist = peerInformation()[kSecCodeInfoPList as String] as! [String: Any]
  plist["CFBundleExecutable"] = "Fixture"
  plist["CFBundlePackageType"] = "APPL"
  let bytes = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
  try bytes.write(to: contents.appendingPathComponent("Info.plist"))
  let signer = Process()
  signer.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
  signer.arguments = ["--force", "--sign", "-", "--options", "runtime", app.path]
  signer.standardOutput = FileHandle.nullDevice
  signer.standardError = FileHandle.nullDevice
  try signer.run()
  signer.waitUntilExit()
  #expect(signer.terminationStatus == 0)
  var code: SecStaticCode?
  #expect(SecStaticCodeCreateWithPath(app as CFURL, [], &code) == errSecSuccess)
  let signed = try #require(code)
  #expect(SecStaticCodeCheckValidity(signed, [], nil) == errSecSuccess)
  let requirement = try TransferCodePolicy.requirement(
    identifier: TransferCodePolicy.recipientIdentifier, team: peerTeam)
  #expect(SecStaticCodeCheckValidity(signed, [], requirement) != errSecSuccess)
}
