import Darwin
import Foundation

/// Only navigation crosses the instance boundary. Project registration still passes through the normal untrusted flow.
public enum NativeOpenRequest: Codable, Equatable, Sendable {
  case activate
  case urls([URL])
  case capture
  case project(String)

  func validate() throws {
    switch self {
    case .activate, .capture: break
    case .project(let query):
      guard query.count <= 1024, query.utf8.count <= 4096,
        !query.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
      else { throw ProfileLockError.invalidRequest }
    case .urls(let urls):
      guard !urls.isEmpty, urls.count <= 100 else { throw ProfileLockError.invalidRequest }
      for url in urls {
        let text = url.absoluteString
        guard ["file", "craft-hub", "craft-hub-native"].contains(url.scheme), text.utf8.count <= 2048,
          !text.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 127 }),
          !url.isFileURL || (url.path.hasPrefix("/") && [nil, "", "localhost"].contains(url.host))
        else { throw ProfileLockError.invalidRequest }
      }
    }
  }
}

private struct InstanceEnvelope: Codable {
  let version: Int
  let id: UUID
  let request: NativeOpenRequest
}
private struct InstanceAcknowledgment: Codable {
  let version: Int
  let id: UUID
  let accepted: Bool
}

/// Profile-scoped primary ownership plus bounded same-user Unix-socket navigation. Independent profiles stay independent.
public final class NativeInstance {
  public let isPrimary: Bool
  private let endpoint: String
  private var listener: DispatchSourceRead?
  private let stateLock = NSLock()
  private var pending: [NativeOpenRequest] = []
  private var recent: [UUID] = []
  private var closed = false
  private var wakeup: (() -> Void)?
  private let connections = DispatchSemaphore(value: 8)

  /// Acquires the native profile lease before callers initialize models, preferences, drafts or Node installers.
  public init(profile: URL) throws {
    let canonical = try ProfileLockLocation.canonical(profile)
    let directory = try ProfileLockLocation.directory()
    let digest = ProfileLockLocation.digest(canonical.path)
    endpoint = directory.appendingPathComponent("i-\(digest.prefix(32)).sock").path
    let ownership = try ProfileLockLocation.openPrivate(directory.appendingPathComponent(digest + ".instance").path)
    guard flock(ownership, LOCK_EX | LOCK_NB) == 0 else {
      let reason = errno
      Darwin.close(ownership)
      guard reason == EWOULDBLOCK else { throw ProfileLockError.unavailable }
      isPrimary = false
      return
    }
    isPrimary = true
    var socketDescriptor: Int32 = -1
    do {
      // A former primary's sidecar can still be draining after a crash. Do not open native state until it releases.
      let stopped = try ProfileLease(paths: [canonical], exclusive: true)
      stopped.release()
      let lease = try ProfileLease(paths: [canonical])
      socketDescriptor = try InstanceSocket.make()
      var info = stat()
      if lstat(endpoint, &info) == 0 {
        guard info.st_mode & S_IFMT == S_IFSOCK, info.st_uid == getuid(), unlink(endpoint) == 0 else {
          throw ProfileLockError.unavailable
        }
      } else if errno != ENOENT {
        throw ProfileLockError.unavailable
      }
      try InstanceSocket.address(endpoint) { address, size in
        guard Darwin.bind(socketDescriptor, address, size) == 0 else { throw ProfileLockError.unavailable }
      }
      guard chmod(endpoint, 0o600) == 0, listen(socketDescriptor, 8) == 0,
        fcntl(socketDescriptor, F_SETFL, O_NONBLOCK) == 0
      else { throw ProfileLockError.unavailable }
      let descriptor = socketDescriptor
      let source = DispatchSource.makeReadSource(
        fileDescriptor: descriptor, queue: DispatchQueue(label: "dev.craft-hub.instance"))
      source.setEventHandler { [weak self] in self?.acceptConnections(descriptor) }
      // Keep both locks until the listener has actually stopped; never unlink the ownership/SQLite lock files.
      source.setCancelHandler {
        Darwin.close(descriptor)
        lease.release()
        Darwin.close(ownership)
      }
      listener = source
      source.resume()
    } catch {
      if socketDescriptor >= 0 { Darwin.close(socketDescriptor) }
      Darwin.close(ownership)
      throw error
    }
  }

  /// The callback only signals queued navigation; callers drain on their UI actor after launch is ready.
  public func observe(_ callback: @escaping () -> Void) {
    stateLock.lock()
    guard !closed else {
      stateLock.unlock()
      return
    }
    wakeup = callback
    let hasPending = !pending.isEmpty
    stateLock.unlock()
    if hasPending { callback() }
  }

  public func drain() -> [NativeOpenRequest] {
    stateLock.lock()
    defer { stateLock.unlock() }
    let result = pending
    pending = []
    return result
  }

  /// Retry the same in-memory request identity if acknowledgment is lost; never persist callback URLs.
  public func forward(_ request: NativeOpenRequest, id: UUID = UUID(), timeout: TimeInterval = 3) throws {
    guard !isPrimary else { throw ProfileLockError.invalidRequest }
    try request.validate()
    let data = try JSONEncoder().encode(InstanceEnvelope(version: 1, id: id, request: request))
    guard data.count < InstanceSocket.maximumBytes else { throw ProfileLockError.invalidRequest }
    let deadline = Date().addingTimeInterval(min(max(timeout, 0.1), 5))
    repeat {
      do {
        let descriptor = try InstanceSocket.make()
        defer { Darwin.close(descriptor) }
        try InstanceSocket.address(endpoint) { address, size in
          guard Darwin.connect(descriptor, address, size) == 0 else { throw ProfileLockError.handoffFailed }
        }
        try InstanceSocket.requireSameUser(descriptor)
        try InstanceSocket.write(data, to: descriptor)
        let ack = try JSONDecoder().decode(
          InstanceAcknowledgment.self, from: InstanceSocket.read(descriptor, maximum: 256))
        guard ack.version == 1, ack.id == id, ack.accepted else { throw ProfileLockError.handoffFailed }
        return
      } catch {
        if Date() >= deadline { throw ProfileLockError.handoffFailed }
        Thread.sleep(forTimeInterval: 0.05)
      }
    } while Date() < deadline
    throw ProfileLockError.handoffFailed
  }

  /// Stops accepting navigation. Production holds the instance until app termination, across all sidecar restarts.
  public func close() {
    stateLock.lock()
    closed = true
    pending = []
    wakeup = nil
    stateLock.unlock()
    listener?.cancel()
    listener = nil
  }
  deinit { close() }

  private func acceptConnections(_ descriptor: Int32) {
    while true {
      let client = Darwin.accept(descriptor, nil, nil)
      guard client >= 0 else { return }
      guard connections.wait(timeout: .now()) == .success else {
        Darwin.close(client)
        continue
      }
      DispatchQueue.global(qos: .userInitiated).async { [weak self, connections] in
        defer {
          Darwin.close(client)
          connections.signal()
        }
        do {
          try InstanceSocket.configure(client)
          try InstanceSocket.requireSameUser(client)
          let envelope = try JSONDecoder().decode(
            InstanceEnvelope.self, from: InstanceSocket.read(client, maximum: InstanceSocket.maximumBytes))
          guard envelope.version == 1 else { return }
          try envelope.request.validate()
          let accepted = self?.enqueue(envelope) ?? false
          try InstanceSocket.write(
            JSONEncoder().encode(InstanceAcknowledgment(version: 1, id: envelope.id, accepted: accepted)), to: client)
        } catch {
          // Malformed, oversized and timed-out local requests get no navigation authority.
        }
      }
    }
  }

  private func enqueue(_ envelope: InstanceEnvelope) -> Bool {
    stateLock.lock()
    guard !closed else {
      stateLock.unlock()
      return false
    }
    if recent.contains(envelope.id) {
      stateLock.unlock()
      return true
    }
    guard pending.count < 64 else {
      stateLock.unlock()
      return false
    }
    pending.append(envelope.request)
    recent.append(envelope.id)
    if recent.count > 256 { recent.removeFirst(recent.count - 256) }
    let callback = wakeup
    stateLock.unlock()
    callback?()
    return true
  }
}

private enum InstanceSocket {
  static let maximumBytes = 16 * 1024

  static func make() throws -> Int32 {
    let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else { throw ProfileLockError.unavailable }
    do { try configure(descriptor) } catch {
      Darwin.close(descriptor)
      throw error
    }
    return descriptor
  }

  static func configure(_ descriptor: Int32) throws {
    var yes: Int32 = 1
    var timeout = timeval(tv_sec: 1, tv_usec: 0)
    guard fcntl(descriptor, F_SETFD, FD_CLOEXEC) == 0, fcntl(descriptor, F_SETFL, 0) == 0,
      setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout.size(ofValue: yes))) == 0,
      setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout))) == 0,
      setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout))) == 0
    else { throw ProfileLockError.unavailable }
  }

  static func address<T>(_ path: String, body: (UnsafePointer<sockaddr>, socklen_t) throws -> T) throws -> T {
    var address = sockaddr_un()
    let bytes = Array(path.utf8) + [0]
    guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw ProfileLockError.unavailable }
    address.sun_family = sa_family_t(AF_UNIX)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes) }
    return try withUnsafePointer(to: &address) {
      try $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        try body($0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
  }

  static func requireSameUser(_ descriptor: Int32) throws {
    var uid: uid_t = 0
    var gid: gid_t = 0
    guard getpeereid(descriptor, &uid, &gid) == 0, uid == getuid() else { throw ProfileLockError.handoffFailed }
  }

  static func read(_ descriptor: Int32, maximum: Int) throws -> Data {
    var result = Data()
    var buffer = [UInt8](repeating: 0, count: 1024)
    let deadline = Date().addingTimeInterval(2)
    while result.count <= maximum, Date() < deadline {
      let count = recv(descriptor, &buffer, buffer.count, 0)
      guard count > 0 else { throw ProfileLockError.handoffFailed }
      result.append(contentsOf: buffer.prefix(count))
      guard result.count <= maximum else { throw ProfileLockError.invalidRequest }
      if let newline = result.firstIndex(of: 10) {
        guard newline == result.count - 1 else { throw ProfileLockError.invalidRequest }
        return result.prefix(upTo: newline)
      }
    }
    throw ProfileLockError.invalidRequest
  }

  static func write(_ data: Data, to descriptor: Int32) throws {
    let bytes = data + Data([10])
    try bytes.withUnsafeBytes { buffer in
      var sent = 0
      while sent < buffer.count {
        let count = send(descriptor, buffer.baseAddress!.advanced(by: sent), buffer.count - sent, 0)
        guard count > 0 else { throw ProfileLockError.handoffFailed }
        sent += count
      }
    }
  }
}
