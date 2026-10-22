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
    guard components.allSatisfy({ !$0.isEmpty && $0.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }) && ($0.count == 1 || $0.first != "0") }) else { return nil }
    let parts = components.map { Int($0) }
    guard parts.count == 3, let major = parts[0], let minor = parts[1], let patch = parts[2] else { return nil }
    self.init(major: major, minor: minor, patch: patch)
  }

  /// Matches the runtime engines range `^22.18.0 || ^24.11.0 || ^26.0.0`.
  public var isSupportedByRuntime: Bool {
    major >= 0 && minor >= 0 && patch >= 0 && ((major == 22 && minor >= 18) || (major == 24 && minor >= 11) || major == 26)
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
  /// Whether the user chose this path explicitly rather than it being found on the machine.
  public let explicit: Bool

  public static func == (lhs: ResolvedNode, rhs: ResolvedNode) -> Bool {
    lhs.path == rhs.path && lhs.version == rhs.version && lhs.explicit == rhs.explicit
  }
}

/// Finds a compatible Node without running shell startup scripts, using the same fixed GUI search rules as the
/// Electron host (`guiToolDirectories` in `apps/desktop/src/codex-executable.ts`).
public struct NodeLocator {
  public var home: String
  public var environment: [String: String]
  public var listDirectory: (String) -> [String]
  public var isExecutable: (String) -> Bool
  public var readVersion: (String) -> NodeVersion?

  public init(
    home: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment,
    listDirectory: @escaping (String) -> [String] = { (try? FileManager.default.contentsOfDirectory(atPath: $0)) ?? [] },
    isExecutable: @escaping (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) },
    readVersion: @escaping (String) -> NodeVersion? = NodeLocator.runVersion
  ) {
    self.home = home
    self.environment = environment
    self.listDirectory = listDirectory
    self.isExecutable = isExecutable
    self.readVersion = readVersion
  }

  /// Directories searched for `node`, in priority order.
  public func candidateDirectories() -> [String] {
    func join(_ base: String, _ path: String) -> String { (base as NSString).appendingPathComponent(path) }
    let pathEntries = (environment["PATH"] ?? "").split(separator: ":").map(String.init).filter { $0.hasPrefix("/") }
    let common = [join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", join(home, "Library/pnpm")]
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
    if let explicitPath, isExecutable(explicitPath), let version = readVersion(explicitPath), version.isSupportedByRuntime {
      return ResolvedNode(path: explicitPath, version: version, explicit: true)
    }
    for directory in candidateDirectories() {
      let path = (directory as NSString).appendingPathComponent("node")
      guard isExecutable(path), let version = readVersion(path), version.isSupportedByRuntime else { continue }
      return ResolvedNode(path: path, version: version, explicit: false)
    }
    return nil
  }

  /// Runs `node --version` with a short timeout and an environment that cannot preload code.
  public static func runVersion(_ path: String) -> NodeVersion? {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: path)
    process.arguments = ["--version"]
    process.environment = ["PATH": "/usr/bin:/bin"]
    let output = Pipe()
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    do { try process.run() } catch { return nil }
    let deadline = Date().addingTimeInterval(3)
    while process.isRunning && Date() < deadline { usleep(20_000) }
    if process.isRunning {
      process.terminate()
      return nil
    }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8).flatMap(NodeVersion.init)
  }
}
