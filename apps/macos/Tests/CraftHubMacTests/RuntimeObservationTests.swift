import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private func observationConnection(_ port: Int = 49218) throws -> RuntimeConnection {
  let secret = String(repeating: "a", count: 64)
  return try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:\(port)/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
}

@MainActor private final class EventSource {
  var handlers: [RuntimeEventStream.Handler] = []
  func observe(_ connection: RuntimeConnection, _ handler: @escaping RuntimeEventStream.Handler) async {
    handlers.append(handler)
    try? await Task.sleep(for: .seconds(30))
  }
}

@MainActor private final class ObservationDeliveryGate {
  private(set) var waiters: [CheckedContinuation<Void, Never>] = []
  func wait() async { await withCheckedContinuation { waiters.append($0) } }
  func release() {
    let pending = waiters
    waiters.removeAll()
    for waiter in pending { waiter.resume() }
  }
}

@MainActor private func eventually(_ condition: () -> Bool) async throws {
  for _ in 0..<200 {
    if condition() { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(condition())
}

@MainActor @Test func reconnectRefreshesSnapshotsAndOldConnectionsCannotInvalidateTheNewSession() async throws {
  let source = EventSource()
  let delivery = ObservationDeliveryGate()
  defer { delivery.release() }
  let observation = RuntimeObservation(observe: source.observe, waitForDelivery: delivery.wait)
  var batches: [Set<RuntimeChange>] = []
  observation.onInvalidation = { batches.append($0) }
  observation.connect(try observationConnection())
  try await eventually { source.handlers.count == 1 }
  await source.handlers[0](.connected)
  try await eventually { delivery.waiters.count == 1 }
  observation.connect(try observationConnection(49219))
  try await eventually { source.handlers.count == 2 }
  await source.handlers[0](.disconnected)
  await source.handlers[0](.changed(.projects))
  #expect(observation.state == .connecting)
  await source.handlers[1](.connected)
  for _ in 0..<50 { await source.handlers[1](.changed(.softwareSources)) }
  try await eventually { delivery.waiters.count == 2 }
  #expect(batches.isEmpty)
  delivery.release()
  try await eventually { batches.count == 1 }
  #expect(batches == [Set(RuntimeChange.allCases)])
  await source.handlers[1](.disconnected)
  #expect(observation.state == .reconnecting)
  await source.handlers[1](.connected)
  try await eventually { delivery.waiters.count == 1 }
  delivery.release()
  try await eventually { batches.count == 2 }
  #expect(batches[1] == Set(RuntimeChange.allCases))
  observation.connect(nil)
  await source.handlers[1](.connected)
  #expect(observation.state == .stopped)
  #expect(batches.count == 2)
}

private actor SnapshotGate {
  var requests = 0
  var release: CheckedContinuation<Void, Never>?
  func next(_ request: URLRequest) async -> (Data, URLResponse) {
    requests += 1
    let count = requests
    if count == 1 { await withCheckedContinuation { release = $0 } }
    let json =
      "{\"version\":1,\"sources\":[{\"id\":\"\(count)\",\"title\":\"Catalog\",\"canManage\":false,\"items\":[]}]}"
    return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
  func resume() {
    release?.resume()
    release = nil
  }
}

@MainActor @Test func aChangeDuringSoftwareLoadingIsNotLostAndHiddenPagesStayLazy() async throws {
  let gate = SnapshotGate()
  let model = MachineModel(
    client: RuntimeAPIClient(connection: try observationConnection(), transport: { await gate.next($0) }))
  model.search = "editor"
  model.softwareFilter = "not-detected"
  let load = Task { await model.loadSoftware() }
  for _ in 0..<200 {
    if await gate.requests == 1 { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(model.checkingSoftware)
  for _ in 0..<20 { model.invalidate([.softwareSources]) }
  await model.loadSoftware()
  await gate.resume()
  await load.value
  #expect(await gate.requests == 2)
  #expect(model.software?.sources.first?.id == "2")
  #expect(model.search == "editor" && model.softwareFilter == "not-detected")
  await model.loadSoftware()
  #expect(await gate.requests == 2)
  model.invalidate([.projects])
  await model.loadSoftware()
  #expect(await gate.requests == 2)
  model.invalidate([.settings])
  #expect(await gate.requests == 2)
  await model.loadSoftware()
  #expect(await gate.requests == 3)
}
