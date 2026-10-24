import Darwin
import Foundation

/// Owns a duplicated nonblocking pipe descriptor. Writes are bounded, serialized and never run on the UI actor.
public actor NativePipeWriter {
  private var descriptor: Int32
  private var pending = 0
  private var last: Task<Void, Error>?

  public init(handle: FileHandle) throws {
    let descriptor = dup(handle.fileDescriptor)
    guard descriptor >= 0 else { throw NativeHostChannelError.closed }
    guard fcntl(descriptor, F_SETFD, FD_CLOEXEC) == 0,
      fcntl(descriptor, F_SETNOSIGPIPE, 1) == 0,
      fcntl(descriptor, F_SETFL, fcntl(descriptor, F_GETFL) | O_NONBLOCK) == 0
    else {
      Darwin.close(descriptor)
      throw NativeHostChannelError.closed
    }
    self.descriptor = descriptor
  }

  deinit { if descriptor >= 0 { Darwin.close(descriptor) } }

  public func send(_ data: Data) async throws {
    guard descriptor >= 0 else { throw NativeHostChannelError.closed }
    guard pending < 8, data.count <= 16 * 1024 + 1 else { throw NativeHostChannelError.busy }
    pending += 1
    let previous = last
    let task = Task {
      if let previous { try await previous.value }
      try await write(data)
    }
    last = task
    defer { pending -= 1 }
    try await task.value
  }

  public func close() async {
    if descriptor >= 0 {
      Darwin.close(descriptor)
      descriptor = -1
    }
    if let last { _ = await last.result }
    last = nil
  }

  private func write(_ data: Data) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    var offset = 0
    while offset < data.count {
      guard descriptor >= 0, ContinuousClock.now < deadline, !Task.isCancelled else {
        throw NativeHostChannelError.closed
      }
      let count = data.withUnsafeBytes { bytes in
        Darwin.write(descriptor, bytes.baseAddress!.advanced(by: offset), data.count - offset)
      }
      if count > 0 {
        offset += count
      } else if count < 0 && errno == EINTR {
        continue
      } else if count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK) {
        try await Task.sleep(for: .milliseconds(10))
      } else {
        throw NativeHostChannelError.closed
      }
    }
  }
}

/// One real sidecar generation. Raw frames stay off the UI actor, logs, URL routes and profile files.
public final class NativeRuntimeChannel: @unchecked Sendable {
  private let lock = NSLock()
  private var decoder = NativeHostOutputDecoder()
  private var closed = false
  private var pending = 0
  private let server: NativeVaultServer
  private let writer: NativePipeWriter
  private let failed: @Sendable () -> Void

  public init(input: FileHandle, vault: KeychainDeviceVault?, failed: @escaping @Sendable () -> Void) throws {
    writer = try NativePipeWriter(handle: input)
    server = NativeVaultServer(vault: vault)
    self.failed = failed
  }

  public func accept(_ data: Data) throws -> RuntimeConnection? {
    let messages = try decode(data)
    var connection: RuntimeConnection?
    for message in messages {
      switch message {
      case .connection(let value): connection = value
      case .vault(let request):
        Task {
          defer { finished() }
          do { try await writer.send(server.reply(to: request)) } catch { if isOpen { failed() } }
        }
      }
    }
    return connection
  }

  public func close() async {
    retire()
    await writer.close()
    // Wait for already-started secure-storage operations before another generation or profile owner starts.
    await server.close()
  }

  private var isOpen: Bool {
    lock.lock()
    defer { lock.unlock() }
    return !closed
  }
  private func retire() {
    lock.lock()
    closed = true
    lock.unlock()
  }
  private func finished() {
    lock.lock()
    pending -= 1
    lock.unlock()
  }
  private func decode(_ data: Data) throws -> [NativeHostOutputDecoder.Message] {
    lock.lock()
    defer { lock.unlock() }
    guard !closed else { throw NativeHostChannelError.closed }
    let messages = try decoder.append(data)
    let incoming = messages.filter {
      if case .vault = $0 { return true }
      return false
    }.count
    guard pending + incoming <= 8 else { throw NativeHostChannelError.busy }
    pending += incoming
    return messages
  }
}
