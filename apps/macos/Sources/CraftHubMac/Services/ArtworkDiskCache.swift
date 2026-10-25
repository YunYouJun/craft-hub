import CryptoKit
import Foundation

/// Disposable rendering data, isolated with the native profile; never a source of user configuration.
actor ArtworkDiskCache {
  struct Record: Codable, Sendable {
    let data: Data
    let fetchedAt: Date
  }
  private let directory: URL?
  private let capacity: Int

  init(directory: URL?, capacity: Int = 64 * 1024 * 1024) {
    self.directory = directory
    self.capacity = capacity
  }

  func read(_ url: URL) -> Record? {
    guard let file = file(for: url),
      let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
      size <= 12 * 1024 * 1024,
      let data = try? Data(contentsOf: file)
    else { return nil }
    return try? JSONDecoder().decode(Record.self, from: data)
  }

  func write(_ record: Record, for url: URL) {
    guard let directory, let file = file(for: url), let data = try? JSONEncoder().encode(record),
      data.count <= capacity
    else { return }
    do {
      try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      try data.write(to: file, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
      prune()
    } catch {
      // Artwork remains usable in memory when the cache directory is unavailable.
    }
  }

  private func file(for url: URL) -> URL? {
    let key = SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
    return directory?.appendingPathComponent(key + ".icon")
  }

  private func prune() {
    guard let directory,
      let files = try? FileManager.default.contentsOfDirectory(
        at: directory, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])
    else { return }
    let entries = files.filter { $0.pathExtension == "icon" }.compactMap { file -> (URL, Int, Date)? in
      guard let values = try? file.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey]) else {
        return nil
      }
      return (file, values.fileSize ?? 0, values.contentModificationDate ?? .distantPast)
    }.sorted { $0.2 < $1.2 }
    var total = entries.reduce(0) { $0 + $1.1 }
    for (file, size, _) in entries where total > capacity {
      if (try? FileManager.default.removeItem(at: file)) != nil { total -= size }
    }
  }
}
