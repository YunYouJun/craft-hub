import Foundation

/// No raw frames or underlying decoding errors may be displayed or logged by the host.
public enum NativeHostChannelError: LocalizedError {
  case invalidFrame, closed, busy
  public var errorDescription: String? {
    switch self {
    case .invalidFrame: "The runtime returned an invalid private host message."
    case .closed: "The private host connection closed. Refresh before continuing."
    case .busy: "The private host connection has too many pending requests."
    }
  }
}

/// Versioned and strictly bounded child-to-parent messages. This contract is never a web bridge method.
public struct NativeVaultRequest: Sendable {
  public enum Operation: Sendable {
    case load, create
    case register(CloudDeviceIdentity, String)
    case clear(CloudDeviceIdentity)
  }
  public let id: String
  public let operation: Operation

  public init(frame: Data) throws {
    do {
      guard frame.count <= 16 * 1024,
        let object = try JSONSerialization.jsonObject(with: frame) as? [String: Any],
        Set(object.keys) == ["hostBridge", "id", "method", "payload"],
        let version = object["hostBridge"] as? NSNumber,
        CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
        let id = object["id"] as? String, id.count == 36, UUID(uuidString: id) != nil,
        let method = object["method"] as? String, let payload = object["payload"] as? [String: Any]
      else { throw NativeHostChannelError.invalidFrame }
      self.id = id
      switch method {
      case "vault.load", "vault.create":
        guard payload.isEmpty else { throw NativeHostChannelError.invalidFrame }
        operation = method == "vault.load" ? .load : .create
      case "vault.register":
        guard Set(payload.keys) == ["expected", "deviceId"], let deviceId = payload["deviceId"] as? String else {
          throw NativeHostChannelError.invalidFrame
        }
        let identity = try Self.identity(payload["expected"])
        _ = try identity.registered(as: deviceId)
        operation = .register(identity, deviceId)
      case "vault.clear":
        guard Set(payload.keys) == ["expected"] else { throw NativeHostChannelError.invalidFrame }
        operation = .clear(try Self.identity(payload["expected"]))
      default: throw NativeHostChannelError.invalidFrame
      }
    } catch { throw NativeHostChannelError.invalidFrame }
  }

  private static func identity(_ value: Any?) throws -> CloudDeviceIdentity {
    guard let object = value as? [String: Any],
      Set(object.keys)
        == (object["deviceId"] == nil ? ["privateKey", "publicKey"] : ["privateKey", "publicKey", "deviceId"])
    else { throw NativeHostChannelError.invalidFrame }
    let identity = try JSONDecoder().decode(
      CloudDeviceIdentity.self, from: JSONSerialization.data(withJSONObject: object))
    try identity.validate()
    return identity
  }
}

/// Serial pipe decoder. The first line remains the existing v1 handshake; subsequent lines cannot replace it.
public struct NativeHostOutputDecoder: Sendable {
  public enum Message: Sendable {
    case connection(RuntimeConnection)
    case vault(NativeVaultRequest)
  }
  private var buffer = Data()
  private var receivedHandshake = false
  private var failed = false
  public init() {}

  public mutating func append(_ chunk: Data) throws -> [Message] {
    guard !failed else { throw NativeHostChannelError.closed }
    do {
      var messages: [Message] = []
      var offset = chunk.startIndex
      while offset < chunk.endIndex {
        let newline = chunk[offset...].firstIndex(of: 10)
        let end = newline ?? chunk.endIndex
        guard buffer.count + chunk.distance(from: offset, to: end) <= 16 * 1024 else {
          throw NativeHostChannelError.invalidFrame
        }
        buffer.append(contentsOf: chunk[offset..<end])
        guard let newline else { break }
        guard messages.count < 32 else { throw NativeHostChannelError.busy }
        if receivedHandshake {
          messages.append(.vault(try NativeVaultRequest(frame: buffer)))
        } else {
          messages.append(.connection(try RuntimeConnection(handshake: buffer)))
          receivedHandshake = true
        }
        buffer.removeAll(keepingCapacity: true)
        offset = chunk.index(after: newline)
      }
      return messages
    } catch {
      failed = true
      buffer.removeAll()
      throw NativeHostChannelError.invalidFrame
    }
  }
}

/// Handles one sidecar generation. Closing it discards pending replies; failed mutations must be re-read.
public actor NativeVaultServer {
  private let vault: KeychainDeviceVault?
  private var closed = false
  private var pending = Set<String>()
  private var recent: [String] = []
  private var closeWaiters: [CheckedContinuation<Void, Never>] = []

  public init(vault: KeychainDeviceVault?) { self.vault = vault }

  public func close() async {
    closed = true
    if !pending.isEmpty { await withCheckedContinuation { closeWaiters.append($0) } }
  }

  public func reply(to request: NativeVaultRequest) async throws -> Data {
    guard !closed else { throw NativeHostChannelError.closed }
    let key = request.id.lowercased()
    guard !pending.contains(key), !recent.contains(key) else { throw NativeHostChannelError.invalidFrame }
    guard pending.count < 8 else { throw NativeHostChannelError.busy }
    pending.insert(key)
    defer {
      pending.remove(key)
      recent.append(key)
      if recent.count > 256 { recent.removeFirst() }
      if closed && pending.isEmpty {
        for waiter in closeWaiters { waiter.resume() }
        closeWaiters.removeAll()
      }
    }
    var response: [String: Any] = ["hostBridge": 1, "id": request.id]
    if let vault {
      do {
        let identity: CloudDeviceIdentity?
        switch request.operation {
        case .load: identity = try await vault.load()
        case .create: identity = try await vault.loadOrCreate()
        case .register(let expected, let deviceId):
          identity = try await vault.register(expected: expected, deviceId: deviceId)
        case .clear(let expected):
          try await vault.clear(expected: expected)
          identity = nil
        }
        response["ok"] = true
        response["value"] =
          try identity.map { try JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) } ?? NSNull()
      } catch {
        response["ok"] = false
        switch error {
        case DeviceVaultError.invalidIdentity: response["error"] = "invalidIdentity"
        case DeviceVaultError.identityChanged: response["error"] = "identityChanged"
        default: response["error"] = "unavailable"
        }
      }
    } else {
      response["ok"] = false
      response["error"] = "unconfigured"
    }
    guard !closed else { throw NativeHostChannelError.closed }
    return try JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]) + Data([10])
  }
}
