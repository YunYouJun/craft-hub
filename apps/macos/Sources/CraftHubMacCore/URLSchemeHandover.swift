import AppKit
import CryptoKit
import Darwin
import Foundation

/// A reviewed local application, including metadata that changes when it is replaced or updated.
public struct LinkApplication: Codable, Equatable {
  public let path: String
  public let identifier: String
  public let revision: String
  public var url: URL { URL(fileURLWithPath: path, isDirectory: true) }
}

/// The system remains the source of truth. A successful setter callback is not a verified handover.
@MainActor public protocol URLSchemeRegistry {
  func current(_ scheme: String) throws -> LinkApplication?
  func inspect(_ url: URL, scheme: String) throws -> LinkApplication
  func set(_ application: LinkApplication, scheme: String) async throws
}

@MainActor public struct WorkspaceURLSchemeRegistry: URLSchemeRegistry {
  public init() {}
  public func current(_ scheme: String) throws -> LinkApplication? {
    guard let url = URL(string: "\(scheme)://open"),
      let application = NSWorkspace.shared.urlForApplication(toOpen: url)
    else { return nil }
    return try inspect(application, scheme: scheme)
  }

  public func inspect(_ url: URL, scheme: String) throws -> LinkApplication {
    let url = url.standardizedFileURL.resolvingSymlinksInPath()
    guard url.isFileURL, url.pathExtension == "app",
      !url.path.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
    else { throw LinkHandoverError.invalidApplication }
    let infoURL = url.appendingPathComponent("Contents/Info.plist")
    let attributes = try FileManager.default.attributesOfItem(atPath: infoURL.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular,
      (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= 1_048_576
    else { throw LinkHandoverError.invalidApplication }
    let bytes = try Data(contentsOf: infoURL)
    guard let info = try PropertyListSerialization.propertyList(from: bytes, format: nil) as? [String: Any],
      let identifier = info["CFBundleIdentifier"] as? String, !identifier.isEmpty,
      !identifier.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
      let executable = info["CFBundleExecutable"] as? String, !executable.isEmpty,
      !executable.contains("/"), executable != ".", executable != "..",
      let types = info["CFBundleURLTypes"] as? [[String: Any]],
      types.contains(where: { ($0["CFBundleURLSchemes"] as? [String])?.contains(scheme) == true })
    else { throw LinkHandoverError.invalidApplication }
    let binary = url.appendingPathComponent("Contents/MacOS/\(executable)")
    var file = stat()
    guard lstat(binary.path, &file) == 0, file.st_mode & S_IFMT == S_IFREG,
      FileManager.default.isExecutableFile(atPath: binary.path)
    else { throw LinkHandoverError.invalidApplication }
    let identity =
      "\(file.st_dev)|\(file.st_ino)|\(file.st_size)|\(file.st_mtimespec.tv_sec)|\(file.st_mtimespec.tv_nsec)"
      + "|\(file.st_ctimespec.tv_sec)|\(file.st_ctimespec.tv_nsec)"
    let revision = SHA256.hash(data: bytes + Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    return LinkApplication(path: url.path, identifier: identifier, revision: revision)
  }

  public func set(_ application: LinkApplication, scheme: String) async throws {
    try await NSWorkspace.shared.setDefaultApplication(at: application.url, toOpenURLsWithScheme: scheme)
  }
}

public enum LinkHandoverError: LocalizedError {
  case invalidApplication, unavailable, changed, invalidReceipt, noPrevious, notVerified
  public var errorDescription: String? {
    switch self {
    case .invalidApplication: "The application is missing or does not declare this link scheme."
    case .unavailable: "This build is not enabled for public-link handover."
    case .changed: "The application, default handler or recovery record changed. Review the current state again."
    case .invalidReceipt: "The private link-handover record is unavailable or invalid. Existing files were retained."
    case .noPrevious: "No previous application is available for a verified rollback."
    case .notVerified:
      "The system did not confirm the requested application. Refresh before retrying; the rollback record was retained."
    }
  }
}

/// One level of rollback, written before contacting Launch Services; contains paths and bundle IDs, never URLs.
public struct LinkHandoverReceipt: Codable, Equatable {
  public let version: Int
  public let id: UUID
  public let scheme: String
  public let previous: LinkApplication
  public let requested: LinkApplication
}

public struct LinkHandoverReview: Equatable {
  public enum Action { case adopt, restore }
  public let action: Action
  public let current: LinkApplication
  public let desired: LinkApplication
  public let receipt: LinkHandoverReceipt?
}

/// Global per-account recovery, independent of the active profile and of caller HOME/TMPDIR overrides.
public struct LinkHandoverStore {
  public let root: URL
  public init(root: URL) { self.root = root }
  public static func account() throws -> Self {
    Self(root: try ProfileLockLocation.guardDirectory().deletingLastPathComponent().appendingPathComponent("links"))
  }
  private var file: URL { root.appendingPathComponent("handover.json") }

  public func read() throws -> LinkHandoverReceipt? {
    var info = stat()
    if lstat(root.path, &info) != 0 {
      if errno == ENOENT { return nil }
      throw LinkHandoverError.invalidReceipt
    }
    try requireDirectory()
    if lstat(file.path, &info) != 0 {
      if errno == ENOENT { return nil }
      throw LinkHandoverError.invalidReceipt
    }
    guard info.st_mode & S_IFMT == S_IFREG, info.st_uid == getuid(), info.st_nlink == 1,
      info.st_mode & 0o077 == 0, info.st_size <= 65_536
    else { throw LinkHandoverError.invalidReceipt }
    let receipt = try JSONDecoder().decode(LinkHandoverReceipt.self, from: Data(contentsOf: file))
    guard receipt.version == 1,
      [receipt.previous, receipt.requested].allSatisfy({
        $0.path.hasPrefix("/") && $0.path.hasSuffix(".app") && !$0.identifier.isEmpty
          && !$0.path.unicodeScalars.contains(where: { $0.value < 32 })
      })
    else { throw LinkHandoverError.invalidReceipt }
    return receipt
  }

  func write(_ receipt: LinkHandoverReceipt) throws {
    if !FileManager.default.fileExists(atPath: root.path) {
      try FileManager.default.createDirectory(
        at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    }
    try requireDirectory()
    _ = try read()
    try JSONEncoder().encode(receipt).write(to: file, options: .atomic)
    guard chmod(file.path, 0o600) == 0 else { throw LinkHandoverError.invalidReceipt }
    let descriptor = try ProfileLockLocation.openPrivate(file.path)
    defer { Darwin.close(descriptor) }
    guard fsync(descriptor) == 0 else { throw LinkHandoverError.invalidReceipt }
    let directory = Darwin.open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard directory >= 0 else { throw LinkHandoverError.invalidReceipt }
    defer { Darwin.close(directory) }
    guard fsync(directory) == 0 else { throw LinkHandoverError.invalidReceipt }
  }

  private func requireDirectory() throws {
    var info = stat()
    guard root.isFileURL, lstat(root.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
      info.st_uid == getuid(), info.st_mode & 0o077 == 0
    else { throw LinkHandoverError.invalidReceipt }
  }
}

/// Only native UI owns this service. No bridge, URL or runtime request can adopt a system default.
@MainActor public final class URLSchemeHandover {
  public let scheme: String
  private let application: URL
  private let registry: any URLSchemeRegistry
  private let store: LinkHandoverStore
  private let enabled: Bool

  public init(
    scheme: String, application: URL, store: LinkHandoverStore, enabled: Bool,
    registry: any URLSchemeRegistry
  ) {
    self.scheme = scheme
    self.application = application
    self.store = store
    self.enabled = enabled
    self.registry = registry
  }

  public func current() throws -> LinkApplication? { try registry.current(scheme) }
  public func receipt() throws -> LinkHandoverReceipt? { try store.read() }

  /// Read-only; the previous application must exist so that every offered switch has a concrete rollback target.
  public func review(_ action: LinkHandoverReview.Action) throws -> LinkHandoverReview {
    guard enabled else { throw LinkHandoverError.unavailable }
    let target = try registry.inspect(application, scheme: scheme)
    guard let current = try registry.current(scheme) else { throw LinkHandoverError.noPrevious }
    let receipt = try store.read()
    if let receipt, receipt.scheme != scheme { throw LinkHandoverError.invalidReceipt }
    let desired: LinkApplication
    switch action {
    case .adopt:
      // If a setter completed before a crash, the retained record still supports rollback; do not replace it
      // with a useless target-to-target record. Repeated adoption requires no system mutation.
      if current.path == target.path {
        guard let receipt, receipt.requested.path == target.path,
          receipt.requested.identifier == target.identifier
        else { throw LinkHandoverError.noPrevious }
      }
      desired = target
    case .restore:
      guard let receipt, receipt.requested.path == target.path,
        receipt.requested.identifier == target.identifier
      else { throw LinkHandoverError.noPrevious }
      desired = try registry.inspect(receipt.previous.url, scheme: scheme)
      guard desired.identifier == receipt.previous.identifier,
        current == target || current == desired
      else { throw LinkHandoverError.changed }
    }
    return LinkHandoverReview(action: action, current: current, desired: desired, receipt: receipt)
  }

  /// Recheck after confirmation while holding an account-wide lease, then verify the system's actual selection.
  public func apply(_ reviewed: LinkHandoverReview) async throws {
    let lease = try ProfileLease(paths: [store.root], exclusive: true)
    defer { lease.release() }
    guard !Task.isCancelled, try review(reviewed.action) == reviewed else { throw LinkHandoverError.changed }
    if reviewed.current == reviewed.desired { return }
    if reviewed.action == .adopt {
      try store.write(
        LinkHandoverReceipt(
          version: 1, id: UUID(), scheme: scheme, previous: reviewed.current, requested: reviewed.desired))
    }
    guard !Task.isCancelled else { throw CancellationError() }
    try await registry.set(reviewed.desired, scheme: scheme)
    guard try registry.current(scheme) == reviewed.desired else { throw LinkHandoverError.notVerified }
  }
}
