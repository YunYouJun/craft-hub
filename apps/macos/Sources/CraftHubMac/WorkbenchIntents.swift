import AppIntents

/// Opens the existing project picker. Ambiguous names stay visible for the user to choose.
struct OpenProjectIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Project"
  static let description = IntentDescription("Find a registered project in Craft Hub. Opening never runs its commands.")
  static let openAppWhenRun = true

  @Parameter(title: "Project name or path") var query: String?

  @MainActor func perform() async throws -> some IntentResult {
    try SystemIntentRouter.shared.openProject(query)
    return .result()
  }
}

/// Brings the durable composer forward; creation remains an explicit action inside the app.
struct QuickCaptureIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Quick Capture"
  static let description = IntentDescription("Open the Craft Hub composer and continue your local draft.")
  static let openAppWhenRun = true

  @MainActor func perform() async throws -> some IntentResult {
    SystemIntentRouter.shared.capture()
    return .result()
  }
}

struct WorkbenchShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: OpenProjectIntent(), phrases: ["Open a project in \(.applicationName)"],
      shortTitle: "Open Project", systemImageName: "folder")
    AppShortcut(
      intent: QuickCaptureIntent(), phrases: ["Quick capture in \(.applicationName)"],
      shortTitle: "Quick Capture", systemImageName: "square.and.pencil")
  }
}
