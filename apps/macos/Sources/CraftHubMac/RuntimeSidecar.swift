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
    case ready(URL, ResolvedNode)
    case failed(String)
  }

  private(set) var state: State = .resolving
  private var process: Process?
  private var input: Pipe?
  private var stderrTail = ""
  private var stopping = false

  /// The user's explicit Node choice; it wins over the machine search while it stays compatible.
  var explicitNodePath: String? {
    get { UserDefaults.standard.string(forKey: "nodeExecutablePath") }
    set { UserDefaults.standard.set(newValue, forKey: "nodeExecutablePath") }
  }

  func start() {
    stop()
    stopping = false
    state = .resolving
    let explicit = ProcessInfo.processInfo.environment["CRAFT_HUB_NODE"] ?? explicitNodePath
    Task.detached(priority: .userInitiated) {
      let node = NodeLocator().resolve(explicitPath: explicit)
      await MainActor.run {
        guard let node else {
          self.state = .missingNode
          return
        }
        self.launch(node)
      }
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

  func stop() {
    stopping = true
    // Closing stdin asks the backend to drain and exit; terminate only if it lingers.
    try? input?.fileHandleForWriting.close()
    if let process, process.isRunning {
      DispatchQueue.global().asyncAfter(deadline: .now() + 3) { [process] in
        if process.isRunning { process.terminate() }
      }
    }
    process = nil
    input = nil
  }

  private func launch(_ node: ResolvedNode) {
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
      guard !chunk.isEmpty else { return }
      buffer.data.append(chunk)
      guard let newline = buffer.data.firstIndex(of: 0x0A) else { return }
      let line = buffer.data[..<newline]
      // Only the first line matters; later output is drained so the pipe never fills.
      handle.readabilityHandler = { _ = $0.availableData }
      let url = (try? JSONSerialization.jsonObject(with: line) as? [String: Any])?["url"] as? String
      Task { @MainActor in
        guard let self else { return }
        if let url, let parsed = URL(string: url), parsed.host == "127.0.0.1" {
          self.state = .ready(parsed, node)
        }
        else {
          self.state = .failed(L10n.text.backendHandshakeFailed)
        }
      }
    }
    errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let text = String(decoding: handle.availableData, as: UTF8.self)
      Task { @MainActor in
        guard let self else { return }
        self.stderrTail = String((self.stderrTail + text).suffix(2000))
      }
    }
    process.terminationHandler = { [weak self] ended in
      Task { @MainActor in
        guard let self, !self.stopping else { return }
        let detail = self.stderrTail.trimmingCharacters(in: .whitespacesAndNewlines)
        self.state = .failed(L10n.text.backendExited(ended.terminationStatus, detail))
      }
    }
    do {
      try process.run()
      self.process = process
      self.input = input
    }
    catch {
      state = .failed(error.localizedDescription)
    }
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
