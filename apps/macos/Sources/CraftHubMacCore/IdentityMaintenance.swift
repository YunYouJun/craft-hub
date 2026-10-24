import Darwin
import Foundation

/// Dispatch before constructing SwiftUI, NativeStorage, an instance lease, or a runtime sidecar.
public enum IdentityMaintenanceEntry {
  public enum Mode: Equatable { case application, recipient, rejected }
  public static let argument = "--craft-hub-native-identity-recipient"

  public static func mode(arguments: [String]) -> Mode {
    let values = Array(arguments.dropFirst())
    guard values.contains(where: { $0.hasPrefix("--craft-hub-native-identity-") }) else { return .application }
    return values == [argument] ? .recipient : .rejected
  }

  /// The real entry has no test peer, caller-selected PID, Keychain, or authentication bypass.
  public static func run() async -> Int32 {
    do {
      try IdentityMaintenanceInput.requirePipe(STDIN_FILENO)
      try IdentityMaintenanceInput.requirePipe(STDOUT_FILENO)
      let peer = try IdentityTransferPeer()
      let session = IdentityMaintenanceSession(authenticate: { try peer.revalidate() })
      return await runIdentityMachMaintenance(session: session, input: .standardInput) {
        try peer.revalidate(auditToken: $0)
      }
    } catch {
      return 1
    }
  }
}

// Internal injection is limited to compiled tests. The executable always constructs the real peer and system vault.
actor IdentityMaintenanceSession {
  typealias VaultFactory = (URL, URL, URL) throws -> KeychainDeviceVault
  private let authenticate: () throws -> Void
  private let makeVault: VaultFactory
  private var transfer: NativeIdentityTransfer?
  private var vault: KeychainDeviceVault?
  private var paths: ProfileIdentityContext.Paths?
  private var context: ProfileIdentityContext?
  private var sequence = 0
  private var busy = false
  private var closed = false

  init(
    authenticate: @escaping () throws -> Void,
    makeVault: @escaping VaultFactory = { try KeychainDeviceVault(profile: $0, endpoint: $1, webOrigin: $2) }
  ) {
    self.authenticate = authenticate
    self.makeVault = makeVault
  }

  func ready() throws -> Data {
    guard !closed, sequence == 0 else { throw IdentityTransferError.rejected }
    try authenticate()
    return try JSONSerialization.data(withJSONObject: ["version": 1, "kind": "identity-recipient-ready"]) + Data([10])
  }

  /// Exactly one bound transaction per process. Replies expose no identity secret or encrypted envelope.
  func accept(_ frame: Data) async throws -> Data {
    guard !busy, !closed else { throw IdentityTransferError.rejected }
    busy = true
    defer { busy = false }
    do {
      try authenticate()
      guard frame.count <= 64 * 1024,
        let object = try JSONSerialization.jsonObject(with: frame) as? [String: Any],
        integer(object["version"]) == 1, integer(object["id"]) == sequence + 1, sequence < 64,
        let operation = object["operation"] as? String
      else { throw IdentityTransferError.rejected }
      sequence += 1
      let base: Set<String> = ["version", "id", "operation"]
      let value: [String: Any]
      switch operation {
      case "prepare":
        guard vault == nil, Set(object.keys) == base.union(["paths", "endpoint", "webOrigin"]) else {
          throw IdentityTransferError.rejected
        }
        let roots = try decodePaths(object["paths"])
        let endpoint = try origin(object["endpoint"])
        let web = try origin(object["webOrigin"])
        let recipient = try NativeIdentityTransfer(
          source: URL(fileURLWithPath: roots.sourceData), target: URL(fileURLWithPath: roots.target),
          endpoint: endpoint, webOrigin: web)
        transfer = recipient
        paths = roots
        vault = try makeVault(URL(fileURLWithPath: roots.target), endpoint, web)
        value = ["request": try JSONSerialization.jsonObject(with: JSONEncoder().encode(recipient.request))]
      case "resume":
        guard vault == nil, Set(object.keys) == base.union(["context"]) else { throw IdentityTransferError.rejected }
        let bound = try decodeContext(object["context"])
        context = bound
        paths = bound.paths
        vault = try makeVault(
          URL(fileURLWithPath: bound.paths.target), try origin(bound.identity.endpoint),
          try origin(bound.identity.webOrigin))
        value = ["ready": true]
      case "inspect", "stage", "activate", "finish", "rollback":
        guard Set(object.keys) == base.union(operation == "stage" ? ["context", "envelope"] : ["context"]),
          let vault, let paths
        else { throw IdentityTransferError.rejected }
        let bound = try decodeContext(object["context"])
        guard bound.paths == paths, context == nil || context == bound else { throw IdentityTransferError.rejected }
        if let transfer { guard bound.matches(transfer.request) else { throw IdentityTransferError.rejected } }
        context = bound
        // The authenticated source owns exclusive runtime leases and durable decisions. This receiver neither opens
        // a normal profile nor reimplements the TypeScript coordinator's journal/rollback policy.
        switch operation {
        case "inspect": value = ["state": try await vault.migrationState(bound).rawValue]
        case "stage":
          guard let transfer, let envelope = object["envelope"] as? [String: Any] else {
            throw IdentityTransferError.rejected
          }
          let identity = try await transfer.receive(JSONSerialization.data(withJSONObject: envelope))
          try authenticate()
          try await vault.stageMigration(identity, request: transfer.request, context: bound)
          value = ["done": true]
        case "activate":
          try await vault.activateMigration(bound)
          value = ["done": true]
        case "finish":
          try await vault.finishMigration(bound)
          value = ["done": true]
        default:
          try await vault.rollbackMigration(bound)
          value = ["done": true]
        }
      case "close":
        guard Set(object.keys) == base else { throw IdentityTransferError.rejected }
        await close()
        value = ["closed": true]
      default: throw IdentityTransferError.rejected
      }
      // Recheck after secure-storage calls, including any OS authentication interaction. A lost parent never receives
      // an acknowledgement; durable guards and inspection resolve the uncertain outcome in a new session.
      try authenticate()
      return try JSONSerialization.data(withJSONObject: ["version": 1, "id": sequence, "value": value]) + Data([10])
    } catch {
      await close()
      throw IdentityTransferError.rejected
    }
  }

  var isClosed: Bool { closed }
  func close() async {
    closed = true
    await transfer?.cancel()
    transfer = nil
    vault = nil
    // Never undo a staged/active identity on EOF, cancellation or an ambiguous acknowledgement.
  }

  private func integer(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
      number.doubleValue == Double(number.intValue)
    else { return nil }
    return number.intValue
  }

  private func path(_ value: Any?) throws -> String {
    guard let path = value as? String, path.hasPrefix("/"), path != "/", path.utf8.count <= 4096,
      !path.contains(where: { $0 == "\r" || $0 == "\n" || $0 == "\0" }),
      try ProfileLockLocation.canonical(URL(fileURLWithPath: path)).path == path
    else { throw IdentityTransferError.rejected }
    return path
  }

  private func origin(_ value: Any?) throws -> URL {
    guard let text = value as? String, text.utf8.count <= 2048, let url = URL(string: text),
      try KeychainDeviceVault.origin(url) == text
    else { throw IdentityTransferError.rejected }
    return url
  }

  private func decodePaths(_ value: Any?) throws -> ProfileIdentityContext.Paths {
    guard let object = value as? [String: Any], Set(object.keys) == ["sourceData", "sourceConfig", "target"] else {
      throw IdentityTransferError.rejected
    }
    let roots = try ["sourceData", "sourceConfig", "target"].map { try path(object[$0]) }
    guard
      !roots.enumerated().contains(where: { index, root in
        roots.enumerated().contains { other, candidate in
          index != other && (root == candidate || root.hasPrefix(candidate + "/"))
        }
      })
    else { throw IdentityTransferError.rejected }
    return .init(sourceData: roots[0], sourceConfig: roots[1], target: roots[2])
  }

  private func decodeContext(_ value: Any?) throws -> ProfileIdentityContext {
    guard let object = value as? [String: Any], Set(object.keys) == ["transaction", "paths", "identity"],
      let identity = object["identity"] as? [String: Any],
      Set(identity.keys).subtracting(["deviceId"]) == ["id", "sourceRevision", "publicKey", "endpoint", "webOrigin"],
      let publicKey = identity["publicKey"] as? String
    else { throw IdentityTransferError.rejected }
    let roots = try decodePaths(object["paths"])
    let transaction = try path(object["transaction"])
    let target = URL(fileURLWithPath: roots.target)
    let expectedPrefix = target.deletingLastPathComponent().appendingPathComponent(
      ".\(target.lastPathComponent).migration-"
    ).path
    guard transaction.hasPrefix(expectedPrefix),
      let id = UUID(uuidString: String(transaction.dropFirst(expectedPrefix.count))),
      transaction == expectedPrefix + id.uuidString.lowercased()
    else { throw IdentityTransferError.rejected }
    for key in ["id", "sourceRevision"] {
      guard let digest = identity[key] as? String,
        digest.range(of: "^[a-f0-9]{64}\\z", options: .regularExpression) != nil
      else {
        throw IdentityTransferError.rejected
      }
    }
    if identity["deviceId"] != nil {
      guard let device = identity["deviceId"] as? String,
        device.range(of: "^[A-Za-z0-9_.-]{1,128}\\z", options: .regularExpression) != nil
      else {
        throw IdentityTransferError.rejected
      }
    }
    try CloudDeviceIdentity.validatePublicKey(publicKey)
    _ = try origin(identity["endpoint"])
    _ = try origin(identity["webOrigin"])
    return try JSONDecoder().decode(ProfileIdentityContext.self, from: JSONSerialization.data(withJSONObject: object))
  }
}

/// Sequential private transport. EOF retires only ephemeral state; it never guesses a transaction decision.
func runIdentityMaintenance(session: IdentityMaintenanceSession, input: FileHandle, output: FileHandle) async -> Int32 {
  var writer: NativePipeWriter?
  do {
    let reader = try IdentityMaintenanceInput(handle: input)
    let channel = try NativePipeWriter(handle: output)
    writer = channel
    try await channel.send(session.ready())
    while let frame = try await reader.next() {
      try await channel.send(session.accept(frame))
      if await session.isClosed { break }
    }
    await session.close()
    await channel.close()
    return 0
  } catch {
    await session.close()
    await writer?.close()
    return 1
  }
}

final class IdentityMaintenanceInput {
  private let descriptor: Int32
  private var buffer = Data()
  private let timeout: Duration

  static func requirePipe(_ descriptor: Int32) throws {
    var info = stat()
    guard fstat(descriptor, &info) == 0, [S_IFIFO, S_IFSOCK].contains(info.st_mode & S_IFMT) else {
      throw IdentityTransferError.rejected
    }
  }

  init(handle: FileHandle, timeout: Duration = .seconds(120)) throws {
    try Self.requirePipe(handle.fileDescriptor)
    let copy = dup(handle.fileDescriptor)
    guard copy >= 0 else { throw IdentityTransferError.rejected }
    guard fcntl(copy, F_SETFD, FD_CLOEXEC) == 0,
      fcntl(copy, F_SETFL, fcntl(copy, F_GETFL) | O_NONBLOCK) == 0
    else {
      Darwin.close(copy)
      throw IdentityTransferError.rejected
    }
    descriptor = copy
    self.timeout = timeout
  }
  deinit { Darwin.close(descriptor) }

  func next() async throws -> Data? {
    try await read(deadline: ContinuousClock.now.advanced(by: timeout))
  }

  /// After the address bootstrap, stdin carries only lifetime. Active Mach traffic owns its own idle deadline.
  func waitForClosure() async throws {
    guard try await read(deadline: nil, closureOnly: true) == nil else { throw IdentityTransferError.rejected }
  }

  private func read(deadline: ContinuousClock.Instant?, closureOnly: Bool = false) async throws -> Data? {
    while !Task.isCancelled, deadline.map({ ContinuousClock.now < $0 }) ?? true {
      guard !closureOnly || buffer.isEmpty else { throw IdentityTransferError.rejected }
      if let newline = buffer.firstIndex(of: 10) {
        guard newline <= 64 * 1024 else { throw IdentityTransferError.rejected }
        let frame = Data(buffer[..<newline])
        buffer.removeSubrange(...newline)
        return frame
      }
      guard buffer.count <= 64 * 1024 else { throw IdentityTransferError.rejected }
      var bytes = [UInt8](repeating: 0, count: 4096)
      let count = Darwin.read(descriptor, &bytes, bytes.count)
      if count > 0 {
        guard !closureOnly else { throw IdentityTransferError.rejected }
        buffer.append(contentsOf: bytes.prefix(count))
      } else if count == 0 {
        guard buffer.isEmpty else { throw IdentityTransferError.rejected }
        return nil
      } else if errno == EINTR {
        continue
      } else if errno == EAGAIN || errno == EWOULDBLOCK {
        try await Task.sleep(for: .milliseconds(10))
      } else {
        throw IdentityTransferError.rejected
      }
    }
    throw IdentityTransferError.rejected
  }
}
