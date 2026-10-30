import Foundation
import Testing

private actor ResponseRelease {
  var released = false
  func release() { released = true }
}

@Test func missingHeldResponseFailsAndReleasesTheFixtureWithoutLeavingASignalWaiter() async throws {
  let (requests, signal) = AsyncStream<Void>.makeStream()
  defer { signal.finish() }
  let fixture = ResponseRelease()
  await #expect(throws: HeldResponseTimeout.self) {
    try await requireHeldResponse(requests, timeout: .milliseconds(10)) { await fixture.release() }
  }
  #expect(await fixture.released)
  var iterator = requests.makeAsyncIterator()
  #expect(await iterator.next() == nil)
}
