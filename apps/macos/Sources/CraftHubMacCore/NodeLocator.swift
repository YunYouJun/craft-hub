import Foundation

/// A Node version, compared numerically.
public struct NodeVersion: Comparable, CustomStringConvertible, Sendable {
  public let major: Int
  public let minor: Int
  public let patch: Int

  public init(major: Int, minor: Int, patch: Int) {
    self.major = major
    self.minor = minor
    self.patch = patch
  }

  /// Parses `node --version` output such as `v24.11.0`.
  public init?(_ text: String) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.hasPrefix("v") else { return nil }
    let components = trimmed.dropFirst().split(separator: ".", omittingEmptySubsequences: false)
    guard
      components.allSatisfy({
        !$0.isEmpty && $0.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }) && ($0.count == 1 || $0.first != "0")
      })
    else { return nil }
    let parts = components.map { Int($0) }
    guard parts.count == 3, let major = parts[0], let minor = parts[1], let patch = parts[2] else { return nil }
    self.init(major: major, minor: minor, patch: patch)
  }

  /// Matches the runtime engines range `^22.18.0 || ^24.11.0 || ^26.0.0`.
  public var isSupportedByRuntime: Bool {
    major >= 0 && minor >= 0 && patch >= 0
      && ((major == 22 && minor >= 18) || (major == 24 && minor >= 11) || major == 26)
  }

  public var description: String { "v\(major).\(minor).\(patch)" }

  public static func < (lhs: NodeVersion, rhs: NodeVersion) -> Bool {
    (lhs.major, lhs.minor, lhs.patch) < (rhs.major, rhs.minor, rhs.patch)
  }
}

/// A Node executable the sidecar can run.
public struct ResolvedNode: Equatable, Sendable {
  public let path: String
  public let version: NodeVersion
  public let architecture: String
  /// Whether the user chose this path explicitly rather than it being found on the machine.
  public let explicit: Bool

  public init(
    path: String, version: NodeVersion, explicit: Bool, architecture: String = NodeRuntimeInfo.hostArchitecture
  ) {
    self.path = path
    self.version = version
    self.explicit = explicit
    self.architecture = architecture
  }
}

/// The executable's actual process architecture, which must match the native app and its bundled addons.
public struct NodeRuntimeInfo: Equatable, Sendable {
  public let version: NodeVersion
  public let architecture: String

  public init(version: NodeVersion, architecture: String = Self.hostArchitecture) {
    self.version = version
    self.architecture = architecture
  }

  public static var hostArchitecture: String {
    #if arch(arm64)
      return "arm64"
    #else
      return "x64"
    #endif
  }

  /// Inspect both properties in one process with bounded output, no shell and no inherited preload variables.
  public static func inspect(_ path: String, timeout: TimeInterval = 3) -> Result<Self, ExecutableProbeError> {
    let result = ExecutableProbe.run(
      path: path,
      arguments: ["--eval", "process.stdout.write(JSON.stringify({version:process.version,arch:process.arch}))"],
      timeout: timeout)
    return result.flatMap { data in
      struct Response: Decodable {
        let version: String
        let arch: String
      }
      guard let response = try? JSONDecoder().decode(Response.self, from: data),
        let version = NodeVersion(response.version), ["arm64", "x64"].contains(response.arch)
      else {
        return .failure(.invalidResponse)
      }
      return .success(Self(version: version, architecture: response.arch))
    }
  }
}

/// Why a user-selected executable was skipped; the caller can explain the fallback without logging probe output.
public struct NodeSelectionFailure: Equatable, Sendable {
  public enum Reason: Equatable, Sendable {
    case invalidPath
    case missingExecutable
    case probe(ExecutableProbeError)
    case unsupportedVersion(String)
    case architectureMismatch(found: String, expected: String)
  }
  public let path: String
  public let reason: Reason
}

/// A selected executable and, when applicable, the reason the explicit preference could not be used.
public struct NodeResolution: Equatable, Sendable {
  public let node: ResolvedNode?
  public let rejectedPreference: NodeSelectionFailure?
}

/// Finds a compatible Node without running shell startup scripts, using the same fixed GUI search rules as the
/// Electron host (`guiToolDirectories` in `apps/desktop/src/codex-executable.ts`).
public struct NodeLocator {
  public var home: String
  public var environment: [String: String]
  public var listDirectory: (String) -> [String]
  public var isExecutable: (String) -> Bool
  public var inspect: (String) -> Result<NodeRuntimeInfo, ExecutableProbeError>
  public var architecture: String

  public init(
    home: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment,
    listDirectory: @escaping (String) -> [String] = {
      (try? FileManager.default.contentsOfDirectory(atPath: $0)) ?? []
    },
    isExecutable: @escaping (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) },
    architecture: String = NodeRuntimeInfo.hostArchitecture,
    inspect: @escaping (String) -> Result<NodeRuntimeInfo, ExecutableProbeError> = { NodeRuntimeInfo.inspect($0) }
  ) {
    self.home = home
    self.environment = environment
    self.listDirectory = listDirectory
    self.isExecutable = isExecutable
    self.inspect = inspect
    self.architecture = architecture
  }

  /// Directories searched for `node`, in priority order.
  public func candidateDirectories() -> [String] {
    func join(_ base: String, _ path: String) -> String { (base as NSString).appendingPathComponent(path) }
    let pathEntries = (environment["PATH"] ?? "").split(separator: ":").map(String.init).filter { $0.hasPrefix("/") }
    let common = [
      join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", join(home, "Library/pnpm"),
    ]
    let pnpmHome = environment["PNPM_HOME"].flatMap { $0.hasPrefix("/") ? [$0] : nil } ?? []
    var fnmRoots: [String] = []
    if let configured = environment["FNM_DIR"], configured.hasPrefix("/") {
      fnmRoots.append(configured)
    }
    fnmRoots += [join(home, "Library/Application Support/fnm"), join(home, ".local/share/fnm"), join(home, ".fnm")]
    var fnmDirectories: [String] = []
    for root in fnmRoots {
      fnmDirectories.append(join(root, "aliases/default/bin"))
      let versions = listDirectory(join(root, "node-versions"))
        .compactMap { name in NodeVersion(name).map { (name, $0) } }
        .sorted { $0.1 > $1.1 }
      fnmDirectories += versions.map { join(root, "node-versions/\($0.0)/installation/bin") }
    }
    var seen = Set<String>()
    return (pathEntries + pnpmHome + common + fnmDirectories).filter { seen.insert($0).inserted }
  }

  /// Returns the explicit path when it is compatible, otherwise the first compatible Node found on the machine.
  public func resolve(explicitPath: String?) -> ResolvedNode? {
    resolveWithDiagnostics(explicitPath: explicitPath).node
  }

  /// Reports explicit-path failures while continuing fixed GUI discovery; every candidate is inspected at most once.
  public func resolveWithDiagnostics(explicitPath: String?) -> NodeResolution {
    var rejected: NodeSelectionFailure?
    if let explicitPath {
      switch candidate(explicitPath, explicit: true) {
      case .success(let node): return NodeResolution(node: node, rejectedPreference: nil)
      case .failure(let reason): rejected = NodeSelectionFailure(path: explicitPath, reason: reason)
      }
    }
    for directory in candidateDirectories() {
      let path = (directory as NSString).appendingPathComponent("node")
      guard path != explicitPath else { continue }
      if case .success(let node) = candidate(path, explicit: false) {
        return NodeResolution(node: node, rejectedPreference: rejected)
      }
    }
    return NodeResolution(node: nil, rejectedPreference: rejected)
  }

  private func candidate(_ path: String, explicit: Bool) -> Result<ResolvedNode, NodeSelectionFailure.Reason> {
    guard path.hasPrefix("/"), !path.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else {
      return .failure(.invalidPath)
    }
    guard isExecutable(path) else { return .failure(.missingExecutable) }
    switch inspect(path) {
    case .failure(let failure): return .failure(.probe(failure))
    case .success(let info):
      guard info.version.isSupportedByRuntime else { return .failure(.unsupportedVersion(info.version.description)) }
      guard info.architecture == architecture else {
        return .failure(.architectureMismatch(found: info.architecture, expected: architecture))
      }
      return .success(
        ResolvedNode(path: path, version: info.version, explicit: explicit, architecture: info.architecture))
    }
  }
}

extension NodeSelectionFailure.Reason: Error {}

extension NodeLocator {
  /// Private Node is a fallback after both explicit and fixed machine discovery, never an implicit preference.
  public func resolveWithPrivateFallback(explicitPath: String?, store: PrivateNodeStore) -> NodeResolution {
    let machine = resolveWithDiagnostics(explicitPath: explicitPath)
    guard machine.node == nil else { return machine }
    return NodeResolution(node: store.resolve(locator: self), rejectedPreference: machine.rejectedPreference)
  }
}
