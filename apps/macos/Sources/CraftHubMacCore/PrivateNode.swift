import CryptoKit
import Darwin
import Foundation

public enum PrivateNodeError: LocalizedError {
  case invalidRelease, invalidStore, busy, downloadFailed, downloadTooLarge, checksumMismatch, invalidArchive,
    incompatibleExecutable, startupFailed, noPreviousVersion
  public var errorDescription: String? {
    switch self {
    case .invalidRelease: "The private Node release is unsupported."
    case .invalidStore: "The private Node directory or saved state is invalid. Existing files were retained."
    case .busy: "Another Craft Hub process is already managing private Node."
    case .downloadFailed: "The official Node download failed. Retry when the connection is available."
    case .downloadTooLarge: "The Node download exceeded its size limit."
    case .checksumMismatch: "Node checksum verification failed. No downloaded executable was run."
    case .invalidArchive: "The Node archive could not be safely extracted."
    case .incompatibleExecutable: "The downloaded Node version or architecture did not match this app."
    case .startupFailed:
      "The downloaded Node could not start and stop the bundled runtime. The previous version was retained."
    case .noPreviousVersion: "No previous private Node version is available."
    }
  }
}

/// Immutable release pins reviewed with the runtime compatibility matrix. Updating the app may update this pin;
/// users explicitly download an upgrade. Never resolve a mutable latest URL on their behalf.
public struct PrivateNodeRelease: Sendable {
  public let version: NodeVersion
  public let architecture: String
  public let sha256: String
  public var directoryName: String { "node-\(version)-darwin-\(architecture)" }
  public var filename: String { directoryName + ".tar.gz" }
  public var baseURL: URL { URL(string: "https://nodejs.org/dist/\(version)/")! }
  public var manifestURL: URL { baseURL.appendingPathComponent("SHASUMS256.txt") }
  public var archiveURL: URL { baseURL.appendingPathComponent(filename) }

  public static func pinned(architecture: String = NodeRuntimeInfo.hostArchitecture) throws -> Self {
    let hash: String
    switch architecture {
    case "arm64": hash = "89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7"
    case "x64": hash = "d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035"
    default: throw PrivateNodeError.invalidRelease
    }
    return Self(version: NodeVersion(major: 24, minor: 22, patch: 1), architecture: architecture, sha256: hash)
  }

  /// Require one exact official manifest entry and the app's pin before trusting any archive bytes.
  public func verifyManifest(_ data: Data) throws {
    guard data.count <= 64 * 1024, let text = String(data: data, encoding: .utf8) else {
      throw PrivateNodeError.checksumMismatch
    }
    let entries = text.split(whereSeparator: \.isNewline).compactMap { line -> String? in
      let fields = line.split(whereSeparator: \.isWhitespace)
      return fields.count == 2 && fields[1] == filename ? String(fields[0]) : nil
    }
    guard entries.count == 1, entries[0] == sha256 else { throw PrivateNodeError.checksumMismatch }
  }
}

public struct PrivateNodeReceipt: Codable, Equatable, Sendable {
  public let directory: String
  public let version: String
  public let architecture: String
  public let archiveSHA256: String
}
public struct PrivateNodeState: Codable, Sendable {
  public let version: Int
  public let current: PrivateNodeReceipt
  public let previous: PrivateNodeReceipt?
}

/// Profile-local immutable releases and an atomically replaced selection. Existing releases are retained for rollback.
public struct PrivateNodeStore: Sendable {
  public let root: URL
  public init(root: URL) { self.root = root }
  public func state() throws -> PrivateNodeState? {
    let path = root.appendingPathComponent("state.json")
    guard FileManager.default.fileExists(atPath: path.path) else { return nil }
    try requireDirectory(root)
    let attrs = try FileManager.default.attributesOfItem(atPath: path.path)
    guard attrs[.type] as? FileAttributeType == .typeRegular,
      (attrs[.size] as? NSNumber)?.intValue ?? Int.max <= 64 * 1024
    else { throw PrivateNodeError.invalidStore }
    let state = try JSONDecoder().decode(PrivateNodeState.self, from: Data(contentsOf: path))
    guard state.version == 1 else { throw PrivateNodeError.invalidStore }
    _ = try executable(state.current)
    if let previous = state.previous { _ = try executable(previous) }
    return state
  }
  public func executable(_ receipt: PrivateNodeReceipt) throws -> URL {
    guard let version = NodeVersion(receipt.version), version.isSupportedByRuntime,
      ["arm64", "x64"].contains(receipt.architecture),
      receipt.directory.range(of: #"^v[0-9]+\.[0-9]+\.[0-9]+-(arm64|x64)-[A-F0-9-]{36}$"#, options: .regularExpression)
        != nil,
      receipt.directory.hasPrefix(version.description + "-" + receipt.architecture + "-"),
      receipt.archiveSHA256.count == 64, receipt.archiveSHA256.allSatisfy({ $0.isHexDigit })
    else { throw PrivateNodeError.invalidStore }
    let url = root.appendingPathComponent("releases").appendingPathComponent(receipt.directory).appendingPathComponent(
      "bin/node")
    let expected = root.resolvingSymlinksInPath().appendingPathComponent("releases").appendingPathComponent(
      receipt.directory
    ).appendingPathComponent("bin/node")
    guard url.resolvingSymlinksInPath() == expected else { throw PrivateNodeError.invalidStore }
    return url
  }
  /// Fixed system discovery must run before consulting this fallback. This does not mutate explicit preferences.
  public func resolve(locator: NodeLocator = NodeLocator()) -> ResolvedNode? {
    guard let saved = try? state(), saved.current.architecture == locator.architecture,
      let executable = try? executable(saved.current), FileManager.default.isExecutableFile(atPath: executable.path),
      case .success(let info) = locator.inspect(executable.path), info.version.description == saved.current.version,
      info.architecture == saved.current.architecture, info.version.isSupportedByRuntime
    else { return nil }
    return ResolvedNode(path: executable.path, version: info.version, explicit: false, architecture: info.architecture)
  }
  public func rollback() throws -> PrivateNodeState {
    try prepare()
    let lease = try PrivateNodeLease(root: root)
    defer { lease.release() }
    guard let state = try state(), let previous = state.previous else { throw PrivateNodeError.noPreviousVersion }
    let executable = try executable(previous)
    guard FileManager.default.isExecutableFile(atPath: executable.path),
      case .success(let info) = NodeRuntimeInfo.inspect(executable.path), info.version.description == previous.version,
      info.architecture == NodeRuntimeInfo.hostArchitecture
    else { throw PrivateNodeError.incompatibleExecutable }
    let next = PrivateNodeState(version: 1, current: previous, previous: state.current)
    try write(next)
    return next
  }
  func prepare() throws {
    guard root.isFileURL, root.path.hasPrefix("/"), root.path != "/" else { throw PrivateNodeError.invalidStore }
    try FileManager.default.createDirectory(
      at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try requireDirectory(root)
    for name in ["releases", "staging"] {
      let url = root.appendingPathComponent(name)
      try FileManager.default.createDirectory(
        at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      try requireDirectory(url)
    }
  }
  private func requireDirectory(_ url: URL) throws {
    let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
    guard attrs[.type] as? FileAttributeType == .typeDirectory,
      (attrs[.ownerAccountID] as? NSNumber)?.uint32Value == geteuid()
    else { throw PrivateNodeError.invalidStore }
  }
  func write(_ state: PrivateNodeState) throws {
    let temporary = root.appendingPathComponent(".state-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: temporary) }
    try JSONEncoder().encode(state).write(to: temporary, options: [.withoutOverwriting])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
    guard rename(temporary.path, root.appendingPathComponent("state.json").path) == 0 else {
      throw PrivateNodeError.invalidStore
    }
  }
}

/// A kernel-held lease survives crashes safely: no stale lock-file deletion or timeout-based lock stealing.
final class PrivateNodeLease {
  private var descriptor: Int32
  init(root: URL) throws {
    descriptor = open(
      root.appendingPathComponent("install.lock").path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
    guard descriptor >= 0 else { throw PrivateNodeError.invalidStore }
    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
      close(descriptor)
      descriptor = -1
      throw PrivateNodeError.busy
    }
  }
  func release() {
    if descriptor >= 0 {
      // A concurrent fork can briefly inherit this open file description before CLOEXEC takes effect.
      // Explicitly release the lease; closing only our descriptor would leave the child holding it.
      _ = flock(descriptor, LOCK_UN)
      close(descriptor)
      descriptor = -1
    }
  }
  deinit { release() }
}

public enum PrivateNodePhase: Sendable {
  case manifest
  case download(Int64, Int64?)
  case verify, extract, validate, complete
}

public struct PrivateNodeInstaller {
  public typealias Download =
    @Sendable (URL, URL, Int64, @escaping @Sendable (Int64, Int64?) -> Void) async throws -> Void
  public let store: PrivateNodeStore
  private let download: Download
  public init(store: PrivateNodeStore, download: Download? = nil) {
    self.store = store
    self.download =
      download ?? { source, destination, limit, progress in
        try await PrivateNodeDownload(source: source, destination: destination, limit: limit, progress: progress).run()
      }
  }
  /// Download only on explicit UI approval. Activation follows checksum, extraction, Node probe and sidecar validation.
  public func install(
    release: PrivateNodeRelease, validate: @Sendable (ResolvedNode) async throws -> Void,
    progress: @escaping @Sendable (PrivateNodePhase) -> Void = { _ in }
  ) async throws -> PrivateNodeReceipt {
    try Task.checkCancellation()
    try store.prepare()
    let lease = try PrivateNodeLease(root: store.root)
    defer { lease.release() }
    let previous = try store.state()
    let staging = store.root.appendingPathComponent("staging").appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(
      at: staging, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: staging) }
    progress(.manifest)
    let manifest = staging.appendingPathComponent("SHASUMS256.txt")
    try await download(release.manifestURL, manifest, 64 * 1024, { _, _ in })
    try release.verifyManifest(Data(contentsOf: manifest))
    try Task.checkCancellation()
    let archive = staging.appendingPathComponent(release.filename)
    progress(.download(0, nil))
    try await download(release.archiveURL, archive, 256 * 1024 * 1024, { progress(.download($0, $1)) })
    try Task.checkCancellation()
    progress(.verify)
    guard try Self.hash(archive) == release.sha256 else { throw PrivateNodeError.checksumMismatch }
    try Task.checkCancellation()
    progress(.extract)
    let listing = try ExecutableProbe.run(
      path: "/usr/bin/tar", arguments: ["-tzf", archive.path], timeout: 20, maximumOutput: 4 * 1024 * 1024
    ).get()
    try Self.validateListing(listing, root: release.directoryName)
    _ = try ExecutableProbe.run(
      path: "/usr/bin/tar",
      arguments: ["-xzf", archive.path, "--no-same-owner", "--no-same-permissions", "-C", staging.path], timeout: 30
    ).get()
    try Task.checkCancellation()
    let extracted = staging.appendingPathComponent(release.directoryName)
    let extractedBinary = extracted.appendingPathComponent("bin/node")
    guard
      extractedBinary.resolvingSymlinksInPath()
        == extracted.resolvingSymlinksInPath().appendingPathComponent("bin/node"),
      try FileManager.default.attributesOfItem(atPath: extractedBinary.path)[.type] as? FileAttributeType
        == .typeRegular
    else { throw PrivateNodeError.incompatibleExecutable }
    let receipt = PrivateNodeReceipt(
      directory: "\(release.version)-\(release.architecture)-\(UUID().uuidString)",
      version: release.version.description, architecture: release.architecture, archiveSHA256: release.sha256)
    let destination = store.root.appendingPathComponent("releases").appendingPathComponent(receipt.directory)
    try FileManager.default.moveItem(at: extracted, to: destination)
    do {
      try Task.checkCancellation()
      progress(.validate)
      // Prepare the final path: moving an already-probed x64 executable can require first-launch work again.
      // Only this checksum-verified install gets the longer bound; ordinary machine discovery stays short.
      let binary = try store.executable(receipt)
      guard case .success(let info) = NodeRuntimeInfo.inspect(binary.path, timeout: 30),
        info.version == release.version, info.architecture == release.architecture,
        info.architecture == NodeRuntimeInfo.hostArchitecture
      else { throw PrivateNodeError.incompatibleExecutable }
      let node = ResolvedNode(
        path: binary.path, version: info.version, explicit: false, architecture: info.architecture)
      try await validate(node)
      try Task.checkCancellation()
      try store.write(PrivateNodeState(version: 1, current: receipt, previous: previous?.current))
    } catch {
      try? FileManager.default.removeItem(at: destination)
      throw error
    }
    progress(.complete)
    return receipt
  }
  static func hash(_ url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hash = SHA256()
    while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty {
      try Task.checkCancellation()
      hash.update(data: data)
    }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
  }
  static func validateListing(_ data: Data, root: String) throws {
    guard let text = String(data: data, encoding: .utf8) else { throw PrivateNodeError.invalidArchive }
    let paths = text.split(separator: "\n", omittingEmptySubsequences: true)
    guard !paths.isEmpty, paths.count <= 30000, paths.contains(Substring(root + "/bin/node")),
      paths.allSatisfy({ path in
        !path.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) && path.hasPrefix(root + "/")
          && !path.split(separator: "/").contains("..")
      })
    else { throw PrivateNodeError.invalidArchive }
  }
}
