import CraftHubIdentityIPC
import Darwin
import Foundation
import Testing

@testable import CraftHubMacCore

private final class MachFixturePort {
  let port: UInt32
  let service: String
  init() throws {
    var name = [CChar](repeating: 0, count: Int(CH_IDENTITY_SERVICE_CAPACITY))
    port = ch_identity_port_create(&name, name.count)
    service = String(cString: name)
    try #require(port != 0)
  }
  deinit { ch_identity_port_destroy(port) }
}
private final class MachFixtureFrame {
  let message: ch_identity_message
  let data: Data
  init(message: ch_identity_message, data: Data) {
    self.message = message
    self.data = data
  }
  deinit { ch_identity_port_release(message.reply_port) }
}
private func machFrame(_ port: UInt32) async throws -> MachFixtureFrame {
  let deadline = ContinuousClock.now.advanced(by: .seconds(3))
  var bytes = [UInt8](repeating: 0, count: Int(CH_IDENTITY_FRAME_LIMIT))
  while ContinuousClock.now < deadline {
    var message = ch_identity_message()
    let result = ch_identity_receive(port, &bytes, bytes.count, &message, 0)
    if result == 1 { return MachFixtureFrame(message: message, data: Data(bytes.prefix(message.count))) }
    #expect(result == 0)
    try await Task.sleep(for: .milliseconds(5))
  }
  throw IdentityTransferError.rejected
}
private func machSend(_ data: Data, to port: UInt32) throws {
  try #require(data.withUnsafeBytes { ch_identity_send(port, 0, $0.baseAddress, $0.count, 0) } == 0)
}
private func machBootstrap(_ port: MachFixturePort, input: Pipe) throws {
  try input.fileHandleForWriting.write(
    contentsOf:
      JSONSerialization.data(withJSONObject: ["version": 1, "service": port.service]) + Data([10]))
}

@Test func identityMachMaintenanceAuthenticatesReadyAndEveryTransactionBeforeDispatch() async throws {
  let port = try MachFixturePort()
  let input = Pipe()
  defer {
    try? input.fileHandleForReading.close()
    try? input.fileHandleForWriting.close()
  }
  try machBootstrap(port, input: input)
  var authentications = 0
  let session = IdentityMaintenanceSession(authenticate: {})
  let task = Task {
    await runIdentityMachMaintenance(session: session, input: input.fileHandleForReading) { token in
      try #require(token.withUnsafeBytes { ch_identity_audit_pid($0.baseAddress, $0.count) } == getpid())
      authentications += 1
    }
  }
  let hello = try await machFrame(port.port)
  #expect(String(decoding: hello.data, as: UTF8.self).contains("identity-recipient-channel-ready"))
  #expect(authentications == 0 && hello.message.reply_port != 0)
  try machSend(Data(), to: hello.message.reply_port)
  let ready = try await machFrame(port.port)
  #expect(String(decoding: ready.data, as: UTF8.self).contains("identity-recipient-ready"))
  try machSend(Data(#"{"version":1,"id":1,"operation":"close"}"#.utf8), to: hello.message.reply_port)
  let closed = try await machFrame(port.port)
  #expect(String(decoding: closed.data, as: UTF8.self).contains("closed"))
  try input.fileHandleForWriting.close()
  #expect(await task.value == 0 && authentications == 2)
  #expect(await session.isClosed)
}

@Test(arguments: [false, true])
func identityMachMaintenanceRejectsUnauthenticatedMessagesWithoutReturningKeys(afterReady: Bool) async throws {
  let port = try MachFixturePort()
  let input = Pipe()
  defer {
    try? input.fileHandleForReading.close()
    try? input.fileHandleForWriting.close()
  }
  try machBootstrap(port, input: input)
  var authentications = 0
  var vaults = 0
  let session = IdentityMaintenanceSession(
    authenticate: {},
    makeVault: { _, _, _ in
      vaults += 1
      throw IdentityTransferError.rejected
    })
  let task = Task {
    await runIdentityMachMaintenance(session: session, input: input.fileHandleForReading) { _ in
      authentications += 1
      if !afterReady || authentications > 1 { throw IdentityTransferError.rejected }
    }
  }
  let hello = try await machFrame(port.port)
  try machSend(Data(), to: hello.message.reply_port)
  if afterReady {
    _ = try await machFrame(port.port)
    try machSend(Data(#"{"version":1,"id":1,"operation":"prepare"}"#.utf8), to: hello.message.reply_port)
  }
  #expect(await task.value == 1 && vaults == 0)
  #expect(await session.isClosed)
  var bytes = [UInt8](repeating: 0, count: 128)
  var message = ch_identity_message()
  #expect(ch_identity_receive(port.port, &bytes, bytes.count, &message, 0) == 0)
}

@Test(arguments: [false, true])
func identityMachMaintenanceClosesOnParentEOFOrUnexpectedPipeData(extraData: Bool) async throws {
  let port = try MachFixturePort()
  let input = Pipe()
  defer {
    try? input.fileHandleForReading.close()
    try? input.fileHandleForWriting.close()
  }
  try machBootstrap(port, input: input)
  let session = IdentityMaintenanceSession(authenticate: {})
  let task = Task {
    await runIdentityMachMaintenance(session: session, input: input.fileHandleForReading, authenticate: { _ in })
  }
  _ = try await machFrame(port.port)
  if extraData {
    try input.fileHandleForWriting.write(contentsOf: Data("unexpected".utf8))
  } else {
    try input.fileHandleForWriting.close()
  }
  #expect(await task.value == 1)
  #expect(await session.isClosed)
}
