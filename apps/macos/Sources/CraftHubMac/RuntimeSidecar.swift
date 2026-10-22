import AppKit
import CraftHubMacCore
import Foundation
import Observation

/// Runs the shared TypeScript runtime as a child process on the user's own Node and reports its local URL.
///
/// The backend prints one JSON line with a one-use bootstrap URL, then serves the workbench until its stdin pipe
/// closes. Holding that pipe ties the backend's lifetime to this app, including a crash or force quit.
@MainActor
@Observable
final class RuntimeSidecar {
  enum State: Equatable {
    case resolving
    case missingNode
    case starting(ResolvedNode)
    case ready(RuntimeConnection, ResolvedNode)
    case failed(String)
  }

  @ObservationIgnored var onConnectionChange: ((RuntimeConnection?) -> Void)?
  private(set) var state: State = .resolving {
    didSet {
      if case .ready(let connection, _) = state { onConnectionChange?(connection) }
      else { onConnectionChange?(nil) }
    }
  }
  private var process: Process?
  private var drainingProcess: Process?
  private var input: Pipe?
  private var stderrTail = ""
  private var generation = UUID()
  private var startupTimeout: Task<Void, Never>?
  private var recoveryTask: Task<Void, Never>?
  private var recoveryAttempts = 0
  private(set) var recoveryMessage: String?

  /// The user's explicit Node choice; it wins over the machine search while it stays compatible.
  var explicitNodePath: String? {
    get { UserDefaults.standard.string(forKey: "nodeExecutablePath") }
    set { UserDefaults.standard.set(newValue, forKey: "nodeExecutablePath") }
  }

  func start(resetRecovery: Bool = true) {
    let previous = stop()
    let attempt = generation
    if resetRecovery {
      recoveryAttempts = 0
      recoveryMessage = nil
    }
    stderrTail = ""
    state = .resolving
    let explicit = ProcessInfo.processInfo.environment["CRAFT_HUB_NODE"] ?? explicitNodePath
    Task {
      // Never start a second writer against the same data directory while the old sidecar is still draining.
      let node = await Task.detached(priority: .userInitiated) {
        if let previous, previous.isRunning { previous.waitUntilExit() }
        return NodeLocator().resolve(explicitPath: explicit)
      }.value
      guard generation == attempt else { return }
      guard let node else {
        state = .missingNode
        return
      }
      launch(node, attempt: attempt)
    }
  }

  /// Lets the user pick a Node executable when none was found, then retries.
  func chooseNode() {
    let panel = NSOpenPanel()
    panel.canChooseFiles = true
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = false
    panel.directoryURL = URL(fileURLWithPath: "/usr/local/bin")
    panel.message = L10n.text.chooseNodeMessage
    guard panel.runModal() == .OK, let url = panel.url else { return }
    explicitNodePath = url.path
    start()
  }

  @discardableResult
  func stop() -> Process? {
    generation = UUID()
    startupTimeout?.cancel()
    recoveryTask?.cancel()
    try? input?.fileHandleForWriting.close()
    let previous = process ?? drainingProcess
    drainingProcess = previous
    if let previous, previous.isRunning {
      DispatchQueue.global().asyncAfter(deadline: .now() + 3) {
        if previous.isRunning { previous.terminate() }
      }
      DispatchQueue.global().asyncAfter(deadline: .now() + 7) {
        if previous.isRunning { kill(previous.processIdentifier, SIGKILL) }
      }
    }
    process = nil
    input = nil
    return previous
  }

  /// Keep the host alive while stdin closure drains the runtime, including during an update installation.
  func stopAndWait() async {
    guard let previous = stop() else { return }
    await Task.detached {
      if previous.isRunning { previous.waitUntilExit() }
    }.value
  }

  private func fail(_ message: String, attempt: UUID) {
    guard generation == attempt else { return }
    stop()
    state = .failed(message)
  }

  private func launch(_ node: ResolvedNode, attempt: UUID) {
    guard let backend = Self.backendScript() else {
      state = .failed(L10n.text.backendMissing)
      return
    }
    state = .starting(node)
    let process = Process()
    process.executableURL = URL(fileURLWithPath: node.path)
    process.arguments = [backend.path]
    process.environment = Self.environment(nodeDirectory: (node.path as NSString).deletingLastPathComponent)
    let input = Pipe()
    let output = Pipe()
    let errors = Pipe()
    process.standardInput = input
    process.standardOutput = output
    process.standardError = errors

    let buffer = HandshakeBuffer()
    output.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let chunk = handle.availableData
      guard !chunk.isEmpty else { handle.readabilityHandler = nil; return }
      buffer.data.append(chunk)
      guard let newline = buffer.data.firstIndex(of: 0x0A) else {
        if buffer.data.count > 16 * 1024 {
          handle.readabilityHandler = { if $0.availableData.isEmpty { $0.readabilityHandler = nil } }
          Task { @MainActor in self?.fail(L10n.text.backendHandshakeFailed, attempt: attempt) }
        }
        return
      }
      let line = Data(buffer.data[..<newline])
      handle.readabilityHandler = { if $0.availableData.isEmpty { $0.readabilityHandler = nil } }
      let connection = line.count <= 16 * 1024 ? try? RuntimeConnection(handshake: line) : nil
      Task { @MainActor in
        guard let self, self.generation == attempt else { return }
        if let connection {
          self.startupTimeout?.cancel()
          self.state = .ready(connection, node)
        } else {
          self.fail(L10n.text.backendHandshakeFailed, attempt: attempt)
        }
      }
    }
    errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty else { handle.readabilityHandler = nil; return }
      let text = String(decoding: data, as: UTF8.self)
      Task { @MainActor in
        guard let self, self.generation == attempt else { return }
        self.stderrTail = String((self.stderrTail + text).suffix(2000))
      }
    }
    process.terminationHandler = { [weak self] ended in
      Task { @MainActor in
        guard let self, self.generation == attempt else { return }
        let wasReady: Bool
        if case .ready = self.state { wasReady = true } else { wasReady = false }
        let detail = self.stderrTail.trimmingCharacters(in: .whitespacesAndNewlines)
        self.fail(L10n.text.backendExited(ended.terminationStatus, detail), attempt: attempt)
        // Bound crash recovery. A launch failure or a repeated crash remains visible with a manual retry.
        if wasReady && self.recoveryAttempts < 2 {
          self.recoveryAttempts += 1
          self.recoveryMessage = L10n.text.copy("运行时意外退出，已尝试自动恢复。", "The runtime exited unexpectedly. Automatic recovery was attempted.")
          let recoveryGeneration = self.generation
          self.recoveryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled, let self, self.generation == recoveryGeneration else { return }
            self.start(resetRecovery: false)
          }
        }
      }
    }
    do {
      try process.run()
      drainingProcess = nil
      self.process = process
      self.input = input
      startupTimeout = Task { [weak self] in
        try? await Task.sleep(for: .seconds(30))
        guard !Task.isCancelled else { return }
        self?.fail(L10n.text.copy("运行时启动超时，请重试。", "Runtime startup timed out. Please retry."), attempt: attempt)
      }
    }
    catch { fail(error.localizedDescription, attempt: attempt) }
  }

  /// The deployed desktop sidecar, or a development override such as `apps/desktop/dist/sidecar.mjs` in a checkout.
  private static func backendScript() -> URL? {
    if let override = ProcessInfo.processInfo.environment["CRAFT_HUB_SIDECAR"] {
      return URL(fileURLWithPath: override)
    }
    let bundled = Bundle.main.resourceURL?.appendingPathComponent("app/apps/desktop/dist/sidecar.mjs")
    return bundled.flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }
  }

  /// A minimal environment: no `NODE_OPTIONS`, `NODE_PATH` or other variables that load extra code, and a PATH
  /// that lets project commands find the same Node and common tool directories.
  private static func environment(nodeDirectory: String) -> [String: String] {
    let inherited = ProcessInfo.processInfo.environment
    var environment: [String: String] = [:]
    for name in ["HOME", "USER", "LOGNAME", "LANG", "TMPDIR", "SHELL"] {
      if let value = inherited[name] { environment[name] = value }
    }
    let home = inherited["HOME"] ?? NSHomeDirectory()
    let path = [nodeDirectory, "\(home)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    environment["PATH"] = path.joined(separator: ":")
    // The prototype keeps its own runtime state; it never shares the Electron app's data while both may run.
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
    environment["CRAFT_HUB_SIDECAR_DIR"] = support.appendingPathComponent("Craft Hub Prototype").path
    return environment
  }
}

/// Bytes read before the backend's first line; only the pipe's serial reader touches it.
private final class HandshakeBuffer: @unchecked Sendable {
  var data = Data()
}
