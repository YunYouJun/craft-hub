import CryptoKit
import Darwin
import Foundation
import RuntimeIPC

struct Configuration: Decodable {
  let fixtureOnly: Bool
  let serviceName: String
  let clientRequirement: String
  let nodePath: String
  let nodeSHA256: String
  let workerPath: String
  let workerSHA256: String
  let workerConfigPath: String
}

final class Broker: NSObject, NSXPCListenerDelegate, RuntimeBrokerProtocol {
  private let config: Configuration
  private let queue = DispatchQueue(label: "dev.craft-hub.runtime-broker")
  private let listener: NSXPCListener
  private var connections: [NSXPCConnection] = []
  private var worker: Process?
  private var input: FileHandle?
  private var output: FileHandle?
  private var buffer = Data()
  private var replies: [String: (String) -> Void] = [:]
  private var waiting: [Data] = []
  private var ready = false
  private var ending = false
  private var signalSource: DispatchSourceSignal?

  init(_ config: Configuration) {
    self.config = config
    listener = NSXPCListener(machServiceName: config.serviceName)
    super.init()
    listener.delegate = self
    // Foundation enforces this on the actual XPC peer, avoiding PID/path identity races.
    listener.setConnectionCodeSigningRequirement(config.clientRequirement)
  }

  func run() {
    signal(SIGTERM, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: queue)
    source.setEventHandler { [weak self] in self?.stop() }
    source.resume()
    signalSource = source
    listener.resume()
    queue.asyncAfter(deadline: .now() + 15) { [weak self] in
      if self?.worker == nil { self?.stop() }
    }
    dispatchMain()
  }

  func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
    guard connection.effectiveUserIdentifier == getuid() else { return false }
    connection.setCodeSigningRequirement(config.clientRequirement)
    connection.exportedInterface = NSXPCInterface(with: RuntimeBrokerProtocol.self)
    connection.exportedObject = self
    queue.async { self.connections.append(connection) }
    connection.invalidationHandler = { [weak self, weak connection] in
      self?.queue.async { [weak self, weak connection] in
        self?.connections.removeAll { $0 === connection }
      }
    }
    connection.resume()
    return true
  }

  func request(_ json: String, withReply reply: @escaping (String) -> Void) {
    guard isCaptureMessage(json) else {
      reply(runtimeFailure("Invalid capture request"))
      return
    }
    queue.async {
      guard !self.ending, self.replies.count < 128 else {
        reply(runtimeFailure("Runtime draining or busy"))
        return
      }
      let id = UUID().uuidString
      let request = try! JSONSerialization.jsonObject(with: Data(json.utf8))
      let envelope: [String: Any] = ["id": id, "clientId": "fixture-capture", "request": request]
      var data = try! JSONSerialization.data(withJSONObject: envelope)
      data.append(10)
      self.replies[id] = reply
      do {
        if self.worker == nil { try self.startWorker() }
        if self.ready { try self.input?.write(contentsOf: data) } else { self.waiting.append(data) }
      } catch { self.stop() }
    }
  }

  private func startWorker() throws {
    // P0 config is local acceptance-only; both executable contents are pinned by the host.
    for (path, expected) in [(config.nodePath, config.nodeSHA256), (config.workerPath, config.workerSHA256)] {
      guard path.hasPrefix("/"), expected.count == 64 else { throw CocoaError(.fileReadInvalidFileName) }
      let digest = SHA256.hash(data: try Data(contentsOf: URL(fileURLWithPath: path))).map {
        String(format: "%02x", $0)
      }.joined()
      guard digest == expected else { throw CocoaError(.fileReadCorruptFile) }
    }
    let child = Process()
    let stdin = Pipe()
    let stdout = Pipe()
    child.executableURL = URL(fileURLWithPath: config.nodePath)
    child.arguments = [config.workerPath, config.workerConfigPath]
    // Do not inherit a user's Node injection settings into the independently hosted worker.
    child.environment = ["PATH": "/usr/bin:/bin", "TMPDIR": NSTemporaryDirectory()]
    child.standardInput = stdin
    child.standardOutput = stdout
    child.standardError = FileHandle.standardError
    input = stdin.fileHandleForWriting
    output = stdout.fileHandleForReading
    output?.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      self?.queue.async { self?.consume(data) }
    }
    child.terminationHandler = { [weak self] _ in self?.queue.async { self?.stop() } }
    try child.run()
    worker = child
    queue.asyncAfter(deadline: .now() + 15) { [weak self] in
      guard let self, !self.ready else { return }
      self.stop()
    }
  }

  private func consume(_ data: Data) {
    guard !ending else { return }
    guard !data.isEmpty else {
      stop()
      return
    }
    buffer.append(data)
    guard buffer.count <= 1_000_000 else {
      stop()
      return
    }
    while let newline = buffer.firstIndex(of: 10) {
      let line = buffer.prefix(upTo: newline)
      buffer.removeSubrange(...newline)
      guard let message = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else {
        stop()
        return
      }
      if message["event"] as? String == "ready" {
        ready = true
        for request in waiting {
          do { try input?.write(contentsOf: request) } catch {
            stop()
            return
          }
        }
        waiting.removeAll()
      } else if let id = message["id"] as? String, let reply = replies.removeValue(forKey: id) {
        reply(String(decoding: line, as: UTF8.self))
      } else if message["event"] as? String == "startup-failed" {
        stop()
        return
      }
    }
  }

  private func stop() {
    guard !ending else { return }
    ending = true
    listener.invalidate()
    for reply in replies.values { reply(runtimeFailure("Runtime stopped; query the same attempt after reconnecting")) }
    replies.removeAll()
    waiting.removeAll()
    try? input?.close()
    input = nil
    for connection in connections { connection.invalidate() }
    connections.removeAll()
    // EOF gives Node time to persist uncertainty. Never kill by process name.
    DispatchQueue.global().async { [self] in
      if let child = worker, child.isRunning {
        let deadline = Date().addingTimeInterval(6)
        while child.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
        if child.isRunning { kill(child.processIdentifier, SIGKILL) }
        child.waitUntilExit()
      }
      exit(0)
    }
  }
}

do {
  guard CommandLine.arguments.count == 2, CommandLine.arguments[1].hasPrefix("/") else {
    throw CocoaError(.fileReadInvalidFileName)
  }
  let config = try JSONDecoder().decode(
    Configuration.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
  guard config.fixtureOnly, config.serviceName.hasPrefix("dev.craft-hub.fixture."), !config.clientRequirement.isEmpty
  else {
    throw CocoaError(.fileReadCorruptFile)
  }
  let broker = Broker(config)
  withExtendedLifetime(broker) { broker.run() }
} catch {
  FileHandle.standardError.write(Data("Fixture broker configuration or startup failed\n".utf8))
  exit(1)
}
