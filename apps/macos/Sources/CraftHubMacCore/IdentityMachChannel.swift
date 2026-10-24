import CraftHubIdentityIPC
import Foundation

/// Owns one receive right and one peer send right. This transport never interprets a payload before authentication.
final class IdentityMachChannel {
  private let receivePort: UInt32
  private let peerPort: UInt32
  private let authenticate: (Data) throws -> Void

  init(service: String, authenticate: @escaping (Data) throws -> Void) throws {
    guard !service.utf8.contains(0), service.utf8.count < CH_IDENTITY_SERVICE_CAPACITY else {
      throw IdentityTransferError.rejected
    }
    let peer = service.withCString { ch_identity_port_lookup($0) }
    guard peer != 0 else { throw IdentityTransferError.rejected }
    let port = ch_identity_port_create(nil, 0)
    guard port != 0 else {
      ch_identity_port_release(peer)
      throw IdentityTransferError.rejected
    }
    receivePort = port
    peerPort = peer
    self.authenticate = authenticate
  }
  deinit {
    ch_identity_port_destroy(receivePort)
    ch_identity_port_release(peerPort)
  }

  /// This first message carries only a protocol marker and a reply port. No identity key is generated here.
  func announce() throws {
    try send(Data(#"{"version":1,"kind":"identity-recipient-channel-ready"}"#.utf8), reply: receivePort)
  }
  func send(_ data: Data) throws { try send(data, reply: 0) }
  private func send(_ data: Data, reply: UInt32) throws {
    guard !Task.isCancelled,
      data.withUnsafeBytes({ ch_identity_send(peerPort, reply, $0.baseAddress, $0.count, 2000) }) == 0
    else { throw IdentityTransferError.rejected }
  }
  func next(timeout: Duration = .seconds(120)) async throws -> Data {
    let deadline = ContinuousClock.now.advanced(by: timeout)
    var bytes = [UInt8](repeating: 0, count: Int(CH_IDENTITY_FRAME_LIMIT))
    while !Task.isCancelled, ContinuousClock.now < deadline {
      var message = ch_identity_message()
      let result = ch_identity_receive(receivePort, &bytes, bytes.count, &message, 0)
      if result == 0 {
        try await Task.sleep(for: .milliseconds(10))
        continue
      }
      guard result == 1 else { throw IdentityTransferError.rejected }
      defer { ch_identity_port_release(message.reply_port) }
      guard message.reply_port == 0 else { throw IdentityTransferError.rejected }
      try authenticate(withUnsafeBytes(of: message.audit) { Data($0) })
      return Data(bytes.prefix(message.count))
    }
    throw IdentityTransferError.rejected
  }
}

/// Pipe input is only an address bootstrap and parent-lifetime signal. Transaction bytes use authenticated Mach messages.
func runIdentityMachMaintenance(
  session: IdentityMaintenanceSession, input: FileHandle, authenticate: @escaping (Data) throws -> Void
) async -> Int32 {
  do {
    let reader = try IdentityMaintenanceInput(handle: input)
    guard let first = try await reader.next(), first.count < 512,
      let object = try JSONSerialization.jsonObject(with: first) as? [String: Any],
      Set(object.keys) == ["version", "service"], let version = object["version"] as? NSNumber,
      CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1,
      let service = object["service"] as? String
    else { throw IdentityTransferError.rejected }
    let channel = try IdentityMachChannel(service: service, authenticate: authenticate)
    try channel.announce()
    let result = await withTaskGroup(of: Int32.self) { group in
      group.addTask {
        do {
          // Only the source's first authenticated request can trigger the protocol ready acknowledgement.
          let hello = try await channel.next()
          guard hello.isEmpty else { throw IdentityTransferError.rejected }
          try await channel.send(session.ready())
          while !Task.isCancelled {
            let frame = try await channel.next()
            try await channel.send(session.accept(frame))
            if await session.isClosed { return 0 }
          }
        } catch {}
        return 1
      }
      group.addTask {
        // EOF or extra pipe data retires the session; neither is a transaction decision.
        try? await reader.waitForClosure()
        return 1
      }
      var result = await group.next() ?? 1
      group.cancelAll()
      // A caller may close stdin as soon as it receives the close acknowledgement. Preserve that successful
      // protocol close even if the lifetime watcher reaches this task group first.
      for await completed in group { if completed == 0 { result = 0 } }
      return result
    }
    await session.close()
    return result
  } catch {
    await session.close()
    return 1
  }
}
