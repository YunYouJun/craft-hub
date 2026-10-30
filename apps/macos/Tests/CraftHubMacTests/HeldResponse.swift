import Foundation

struct HeldResponseTimeout: Error {}

/// Observe the fixture's suspension event rather than spending a polling budget while MainActor is busy.
func requireHeldResponse(
  _ requests: AsyncStream<Void>, timeout: Duration = .seconds(5),
  releaseOnTimeout: @Sendable () async -> Void
) async throws {
  let held = await withTaskGroup(of: Bool.self) { group in
    group.addTask {
      var iterator = requests.makeAsyncIterator()
      return await iterator.next() != nil
    }
    group.addTask {
      try? await Task.sleep(for: timeout)
      return false
    }
    let observed = await group.next() ?? false
    group.cancelAll()
    return observed
  }
  guard held else {
    await releaseOnTimeout()
    throw HeldResponseTimeout()
  }
}
