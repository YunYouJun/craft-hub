import CryptoKit
import Foundation

/// One native profile for runtime state and drafts. An explicit override supports isolated local acceptance runs.
enum NativeStorage {
  static let directory: URL = {
    if let path = ProcessInfo.processInfo.environment["CRAFT_HUB_NATIVE_DATA_DIR"], path.hasPrefix("/") {
      return URL(fileURLWithPath: path, isDirectory: true)
    }
    return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Craft Hub Prototype", isDirectory: true)
  }()

  /// An isolated profile also gets isolated preferences, including the chosen Node and last destination.
  static let defaults: UserDefaults = {
    guard ProcessInfo.processInfo.environment["CRAFT_HUB_NATIVE_DATA_DIR"]?.hasPrefix("/") == true else {
      return .standard
    }
    let digest = SHA256.hash(data: Data(directory.path.utf8)).map { String(format: "%02x", $0) }.joined()
    return UserDefaults(suiteName: "dev.craft-hub.macos-prototype.profile.\(digest)")!
  }()
}
