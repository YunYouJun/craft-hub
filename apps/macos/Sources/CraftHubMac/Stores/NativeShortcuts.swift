import AppKit
import CraftHubMacCore
import Observation
import SwiftUI

/// Adapts the web recorder's portable notation to macOS menu equivalents, without a keyboard monitor.
enum NativeShortcut {
  static let paletteID = "workbench.showCommandPalette"
  static let defaultPalette = "Mod+K"

  static func parse(_ value: String) -> KeyboardShortcut? {
    guard value.utf8.count <= 100 else { return nil }
    let parts = value.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
    guard let last = parts.last, !last.isEmpty else { return nil }
    var modifiers: EventModifiers = []
    var seen = Set<String>()
    for part in parts.dropLast() {
      guard seen.insert(part).inserted else { return nil }
      switch part {
      case "Mod": modifiers.insert(.command)
      case "Control": modifiers.insert(.control)
      case "Alt": modifiers.insert(.option)
      case "Shift": modifiers.insert(.shift)
      default: return nil
      }
    }
    let named: [String: KeyEquivalent] = [
      "Space": .space, "Enter": .return, "Escape": .escape, "Tab": .tab,
      "Backspace": .delete, "Delete": .deleteForward, "ArrowUp": .upArrow,
      "ArrowDown": .downArrow, "ArrowLeft": .leftArrow, "ArrowRight": .rightArrow,
      "Home": .home, "End": .end, "PageUp": .pageUp, "PageDown": .pageDown,
    ]
    let key: KeyEquivalent
    if last.hasPrefix("F"), let number = Int(last.dropFirst()), (1...35).contains(number), last == "F\(number)" {
      key = KeyEquivalent(Character(UnicodeScalar(Int(NSF1FunctionKey) + number - 1)!))
    } else {
      // Bare characters and navigation keys must not steal ordinary text editing.
      guard !modifiers.isEmpty else { return nil }
      if let special = named[last] {
        key = special
      } else {
        guard last.unicodeScalars.count == 1, let scalar = last.unicodeScalars.first,
          !CharacterSet.controlCharacters.union(.whitespacesAndNewlines).contains(scalar),
          last.lowercased().count == 1
        else { return nil }
        key = KeyEquivalent(Character(last.lowercased()))
      }
    }
    return KeyboardShortcut(key, modifiers: modifiers)
  }

  static func capability(_ id: String) -> (project: String, capability: String)? {
    let prefix = "capability:"
    guard id.hasPrefix(prefix) else { return nil }
    let value = id.dropFirst(prefix.count)
    guard let separator = value.firstIndex(of: ":") else { return nil }
    let project = String(value[..<separator])
    let capability = String(value[value.index(after: separator)...])
    guard !project.isEmpty, !capability.isEmpty else { return nil }
    return (project, capability)
  }
}

/// Resolves shortcuts through read-only discovery. Invoking one only navigates to the existing review flow.
@MainActor @Observable
final class NativeShortcuts {
  struct Entry: Identifiable {
    let id: String
    let project: String
    let capability: String
    let title: String
    let shortcut: KeyboardShortcut
  }
  private(set) var palette: KeyboardShortcut?
  private(set) var entries: [Entry] = []
  private(set) var isLoading = false
  @ObservationIgnored var openProject: (String, String) -> Void = { _, _ in }
  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var request: Task<Void, Never>?
  @ObservationIgnored private var generation = UUID()

  init(defaults: UserDefaults = NativeStorage.defaults) {
    self.defaults = defaults
    palette = NativeShortcut.parse(defaults.string(forKey: "nativePaletteShortcut") ?? NativeShortcut.defaultPalette)
  }

  func connect(_ client: RuntimeAPIClient?) {
    self.client = client
    refresh()
  }

  func refresh() {
    request?.cancel()
    generation = UUID()
    entries = []
    isLoading = false
    guard let client else { return }
    isLoading = true
    let attempt = generation
    request = Task { [weak self] in
      guard let self else { return }
      defer { if generation == attempt { isLoading = false } }
      guard let settings = try? await client.shortcuts(), !Task.isCancelled, generation == attempt else { return }
      let paletteValue = settings[NativeShortcut.paletteID] ?? NativeShortcut.defaultPalette
      palette = NativeShortcut.parse(paletteValue)
      defaults.set(paletteValue, forKey: "nativePaletteShortcut")
      let configured = settings.compactMap { id, value -> (String, String, String, KeyboardShortcut)? in
        guard let target = NativeShortcut.capability(id), let shortcut = NativeShortcut.parse(value),
          shortcut != self.palette
        else { return nil }
        return (id, target.project, target.capability, shortcut)
      }
      guard !configured.isEmpty, let projects = try? await client.projects(), !Task.isCancelled,
        generation == attempt
      else { return }
      let counts = Dictionary(grouping: configured, by: { $0.3 }).mapValues(\.count)
      var resolved: [Entry] = []
      for project in projects where configured.contains(where: { $0.1 == project.id && counts[$0.3] == 1 }) {
        let capabilities = (try? await client.capabilities(projectID: project.id)) ?? []
        guard !Task.isCancelled, generation == attempt else { return }
        for (id, projectID, capability, shortcut) in configured where projectID == project.id {
          guard counts[shortcut] == 1, let found = capabilities.first(where: { $0.id == capability }) else { continue }
          resolved.append(
            Entry(
              id: id, project: project.id, capability: capability,
              title: "\(found.name) — \(project.name)", shortcut: shortcut))
        }
      }
      entries = resolved.sorted { $0.id < $1.id }
    }
  }

  @discardableResult func perform(_ id: String) -> Bool {
    guard client != nil, let entry = entries.first(where: { $0.id == id }) else { return false }
    openProject(entry.project, entry.capability)
    return true
  }
}
