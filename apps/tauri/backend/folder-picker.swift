import AppKit
import Foundation

final class FolderPickerDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        let panel = NSOpenPanel()
        panel.title = "Craft Hub Tauri Trial"
        panel.message = "Choose a local project for the isolated Craft Hub trial"
        panel.prompt = "Choose project"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = false
        panel.allowsMultipleSelection = CommandLine.arguments.contains("--multiple")
        if let index = CommandLine.arguments.firstIndex(of: "--directory"), index + 1 < CommandLine.arguments.count {
            panel.directoryURL = URL(fileURLWithPath: CommandLine.arguments[index + 1], isDirectory: true)
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
        let paths = panel.runModal() == .OK ? panel.urls.map(\.path) : []
        if let data = try? JSONEncoder().encode(paths) {
            FileHandle.standardOutput.write(data)
        }
        NSApplication.shared.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = FolderPickerDelegate()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
