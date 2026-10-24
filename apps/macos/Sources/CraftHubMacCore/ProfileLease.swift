import CryptoKit
import Darwin
import Foundation
import SQLite3

/// Matches the runtime's profile-lease contract before Node exists. Never stores profile data in the lock database.
public final class ProfileLease {
  private var databases: [OpaquePointer] = []

  /// Canonical roots share SQLite read transactions; an offline migration needs exclusive transactions.
  public init(paths: [URL], exclusive: Bool = false) throws {
    let roots = try Set(paths.map { try ProfileLockLocation.canonical($0).path }).sorted()
    let directory = try ProfileLockLocation.directory()
    let guardDirectory = try ProfileLockLocation.guardDirectory()
    do {
      for root in roots {
        let path = directory.appendingPathComponent(ProfileLockLocation.digest(root) + ".sqlite").path
        let before = try ProfileLockLocation.prepareDatabase(path)
        var database: OpaquePointer?
        let result = sqlite3_open_v2(path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil)
        guard result == SQLITE_OK, let database else {
          if let database { sqlite3_close(database) }
          throw ProfileLockError.unavailable
        }
        databases.append(database)
        var after = stat()
        guard lstat(path, &after) == 0, before.st_dev == after.st_dev, before.st_ino == after.st_ino else {
          throw ProfileLockError.unavailable
        }
        for statement in [
          "CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY)",
          exclusive ? "BEGIN EXCLUSIVE" : "BEGIN",
          "SELECT id FROM lease",
        ] {
          guard sqlite3_exec(database, statement, nil, nil, nil) == SQLITE_OK else {
            throw ProfileLockError.inUse
          }
        }
        // A crashed identity coordinator can outlive its kernel lease. Do not initialize native state
        // until its persistent interlock has been reconciled by the matching maintenance transaction.
        // Read the durable OS-account marker and the legacy temporary-directory mirror.
        for location in [guardDirectory, directory] {
          let marker = location.appendingPathComponent(ProfileLockLocation.digest(root) + ".migration.json").path
          var migration = stat()
          if lstat(marker, &migration) == 0 {
            guard migration.st_mode & S_IFMT == S_IFREG, migration.st_uid == getuid(),
              migration.st_nlink == 1, migration.st_mode & 0o077 == 0
            else { throw ProfileLockError.unavailable }
            throw ProfileLockError.migrationPending
          } else if errno != ENOENT {
            throw ProfileLockError.unavailable
          }
        }
      }
    } catch {
      release()
      throw error
    }
  }

  /// Release only after every writer has stopped; the application normally holds its lease until process exit.
  public func release() {
    for database in databases.reversed() { sqlite3_close(database) }
    databases = []
  }
  deinit { release() }
}

public enum ProfileLockError: Error, LocalizedError {
  case inUse, unavailable, invalidRequest, handoffFailed, migrationPending
  public var errorDescription: String? {
    switch self {
    case .inUse: return "This profile is busy or being migrated. Close its clients and try again."
    case .unavailable: return "The private profile lock is unavailable. No profile was opened."
    case .invalidRequest: return "The navigation request is invalid or too large."
    case .handoffFailed: return "The existing app did not accept the navigation request. Try opening it again."
    case .migrationPending:
      return
        "This profile has a pending or retained identity migration. Use its reviewed migration recovery before opening it."
    }
  }
}

/// Stable across temporary-directory environments and profile renames; shared with profile-lease.ts.
enum ProfileLockLocation {
  static func canonical(_ url: URL) throws -> URL {
    guard url.isFileURL, url.path.hasPrefix("/") else { throw ProfileLockError.unavailable }
    let path = url.standardizedFileURL.path
    if let resolved = realpath(path, nil) {
      defer { free(resolved) }
      return URL(fileURLWithPath: String(cString: resolved), isDirectory: true)
    }
    guard errno == ENOENT, path != "/" else { throw ProfileLockError.unavailable }
    return try canonical(URL(fileURLWithPath: path).deletingLastPathComponent())
      .appendingPathComponent(URL(fileURLWithPath: path).lastPathComponent, isDirectory: true)
  }

  static func digest(_ path: String) -> String {
    SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  static func directory() throws -> URL {
    let directory = try canonical(URL(fileURLWithPath: "/tmp"))
      .appendingPathComponent("craft-hub-profile-leases-\(getuid())", isDirectory: true)
    if mkdir(directory.path, 0o700) != 0, errno != EEXIST { throw ProfileLockError.unavailable }
    var info = stat()
    guard lstat(directory.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
      info.st_uid == getuid(), info.st_mode & 0o077 == 0
    else { throw ProfileLockError.unavailable }
    return directory
  }

  /// Matches node:os userInfo().homedir, so caller HOME/TMPDIR overrides cannot redirect durable guards.
  static func guardDirectory() throws -> URL {
    guard let user = getpwuid(getuid()), let home = user.pointee.pw_dir else { throw ProfileLockError.unavailable }
    let accountHome = String(cString: home)
    guard accountHome.hasPrefix("/") else { throw ProfileLockError.unavailable }
    let directory = try canonical(
      URL(fileURLWithPath: accountHome, isDirectory: true)
        .appendingPathComponent("Library/Application Support/Craft Hub Migration/guards", isDirectory: true))
    var info = stat()
    if lstat(directory.path, &info) == 0 {
      guard info.st_mode & S_IFMT == S_IFDIR, info.st_uid == getuid(), info.st_mode & 0o077 == 0 else {
        throw ProfileLockError.unavailable
      }
    } else if errno != ENOENT {
      throw ProfileLockError.unavailable
    }
    return directory
  }

  static func openPrivate(_ path: String) throws -> Int32 {
    let descriptor = Darwin.open(path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard descriptor >= 0 else { throw ProfileLockError.unavailable }
    var info = stat()
    guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1,
      info.st_uid == getuid(), fchmod(descriptor, 0o600) == 0
    else {
      Darwin.close(descriptor)
      throw ProfileLockError.unavailable
    }
    return descriptor
  }

  static func prepareDatabase(_ path: String) throws -> stat {
    // Never open/close an existing SQLite file outside SQLite: that would discard its process-wide POSIX locks.
    let descriptor = Darwin.open(path, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
    if descriptor >= 0 {
      Darwin.close(descriptor)
    } else if errno != EEXIST {
      throw ProfileLockError.unavailable
    }
    var info = stat()
    guard lstat(path, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1,
      info.st_uid == getuid(), chmod(path, 0o600) == 0
    else { throw ProfileLockError.unavailable }
    return info
  }
}
