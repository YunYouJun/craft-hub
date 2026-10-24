import Foundation

/// A fixture peer must not block the cooperative executor that services its pipe replies.
func readFixturePipe(_ handle: FileHandle) async -> Data {
  await withCheckedContinuation { continuation in
    DispatchQueue.global().async {
      continuation.resume(returning: handle.availableData)
    }
  }
}

func waitForFixtureProcess(_ process: Process) async throws {
  while process.isRunning { try await Task.sleep(for: .milliseconds(5)) }
}
