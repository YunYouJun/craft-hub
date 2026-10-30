import AppKit
import Foundation

// Local build tooling only: request a normal quit so the app retains its task and draft guards.
struct ApplicationIdentity: Codable {
  let pid: Int32
  let executable: String
  let startedAt: Double
}

func identity(_ app: NSRunningApplication) -> ApplicationIdentity? {
  guard let executable = app.executableURL, let started = app.launchDate else { return nil }
  return ApplicationIdentity(
    pid: app.processIdentifier,
    executable: executable.resolvingSymlinksInPath().path,
    startedAt: started.timeIntervalSince1970)
}

func refreshDock(bundle: String, backupDirectory: String) throws {
  let defaults = UserDefaults(suiteName: "com.apple.dock")!
  let original = defaults.array(forKey: "persistent-apps") ?? []
  var changed = false
  let updated = original.map { value -> Any in
    guard var item = value as? [String: Any], var tile = item["tile-data"] as? [String: Any],
      let identifier = tile["bundle-identifier"] as? String,
      ["dev.craft-hub.macos-prototype", "com.yunyoujun.craft-hub"].contains(identifier)
    else { return value }
    changed = true
    let url = URL(fileURLWithPath: bundle, isDirectory: true)
    tile["file-data"] = ["_CFURLString": url.absoluteString, "_CFURLStringType": 15]
    tile["file-label"] = "Craft Hub Prototype"
    tile["bundle-identifier"] = "dev.craft-hub.macos-prototype"
    // A bookmark can follow the old app's inode into the backup directory after a rename.
    tile.removeValue(forKey: "book")
    tile.removeValue(forKey: "file-mod-date")
    tile.removeValue(forKey: "parent-mod-date")
    item["tile-data"] = tile
    return item
  }
  guard changed else { return }
  let backup = try PropertyListSerialization.data(
    fromPropertyList: ["persistent-apps": original], format: .binary, options: 0)
  try backup.write(to: URL(fileURLWithPath: backupDirectory).appendingPathComponent("dock-before.plist"))
  defaults.set(updated, forKey: "persistent-apps")
  guard defaults.synchronize() else { throw NSError(domain: "NativeLocalWorkflow", code: 3) }
  for app in NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock") {
    guard let recorded = identity(app),
      recorded.executable == "/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock",
      let current = NSRunningApplication(processIdentifier: recorded.pid),
      let confirmed = identity(current), confirmed.executable == recorded.executable,
      confirmed.startedAt == recorded.startedAt
    else { continue }
    // Restart only this recorded system Dock process so it reloads the saved entry.
    guard kill(recorded.pid, SIGTERM) == 0 else { throw NSError(domain: "NativeLocalWorkflow", code: 4) }
  }
}

let arguments = Array(CommandLine.arguments.dropFirst())
do {
  if arguments.count == 3, arguments[0] == "dock" {
    try refreshDock(bundle: arguments[1], backupDirectory: arguments[2])
  } else if arguments == ["list"] {
    let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "dev.craft-hub.macos-prototype")
    let data = try JSONEncoder().encode(apps.compactMap(identity))
    print(String(decoding: data, as: UTF8.self))
  } else if arguments.count == 4, arguments[0] == "quit",
    let pid = Int32(arguments[1]), let started = Double(arguments[3]),
    let app = NSRunningApplication(processIdentifier: pid), let current = identity(app),
    current.executable == arguments[2], current.startedAt == started
  {
    guard app.terminate() else { throw NSError(domain: "NativeLocalWorkflow", code: 1) }
  } else {
    throw NSError(domain: "NativeLocalWorkflow", code: 2)
  }
} catch {
  FileHandle.standardError.write(Data("Native lifecycle/Dock operation failed: \(error)\n".utf8))
  exit(1)
}
