import CraftHubMacCore
import Foundation
import Observation

/// App-owned external terminal selection. Runtime IDs, not a client's directory strings, determine what opens.
@MainActor @Observable
final class ProjectTerminalModel {
  struct Context: Equatable, Hashable, Sendable {
    let projectID: String
    var capabilityID: String?
  }
  private(set) var context: Context?
  private(set) var applications: [String] = []
  private(set) var preferredApplication: String
  private(set) var loading = false
  private(set) var stale = true
  private(set) var error: String?
  private(set) var notice: String?
  private(set) var loadIdentity = UUID()
  private var pending: [Context: UUID] = [:]
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var connection = UUID()
  @ObservationIgnored private var contextGeneration = UUID()
  @ObservationIgnored private var catalogRequest = UUID()
  @ObservationIgnored private var catalogTask: Task<Void, Never>?
  @ObservationIgnored private let defaults: UserDefaults
  private static let preferenceKey = "preferredProjectTerminalApplication"

  init(defaults: UserDefaults = NativeStorage.defaults) {
    self.defaults = defaults
    preferredApplication = defaults.string(forKey: Self.preferenceKey) ?? ""
  }

  var opening: Bool { context.map { pending[$0] != nil } ?? false }
  var selectionAvailable: Bool { applications.contains(preferredApplication) }
  var canOpen: Bool { client != nil && context != nil && !loading && !stale && selectionAvailable && !opening }
  var unavailableSelection: Bool { !preferredApplication.isEmpty && !stale && !selectionAvailable }

  func connect(_ client: RuntimeAPIClient?) {
    guard self.client !== client else { return }
    catalogTask?.cancel()
    catalogTask = nil
    connection = UUID()
    loadIdentity = UUID()
    catalogRequest = UUID()
    self.client = client
    applications = []
    pending = [:]
    stale = true
    loading = false
    error = nil
    notice = nil
  }

  func select(projectID: String?, capabilityID: String? = nil) {
    let next = projectID.map { Context(projectID: $0, capabilityID: capabilityID) }
    guard context != next else { return }
    context = next
    contextGeneration = UUID()
    error = nil
    notice = nil
  }

  func chooseApplication(_ application: String) {
    guard applications.contains(application), !loading else { return }
    preferredApplication = application
    defaults.set(application, forKey: Self.preferenceKey)
    if !stale { error = nil }
    notice = nil
  }

  func load(force: Bool = false) async {
    guard let client else { return }
    if let catalogTask {
      await catalogTask.value
      return
    }
    guard force || stale else { return }
    let session = connection
    let generation = contextGeneration
    let request = UUID()
    catalogRequest = request
    loading = true
    catalogTask = Task {
      defer {
        if session == connection, request == catalogRequest {
          loading = false
          catalogTask = nil
        }
      }
      do {
        let result = try await client.projectTerminalApplications()
        guard session == connection, request == catalogRequest, !Task.isCancelled else { return }
        applications = result
        if preferredApplication.isEmpty, let first = result.first {
          preferredApplication = first
          defaults.set(first, forKey: Self.preferenceKey)
        }
        stale = false
        error = nil
      } catch {
        guard session == connection, request == catalogRequest, !Task.isCancelled else { return }
        stale = true
        if generation == contextGeneration { self.error = error.localizedDescription }
      }
    }
    await catalogTask?.value
  }

  /// The click captures its scope and selected application. Late receipts never relabel a different page's action.
  func open(_ target: Context) async {
    guard context == target, canOpen, let client else { return }
    let application = preferredApplication
    let session = connection
    let generation = contextGeneration
    let request = UUID()
    pending[target] = request
    error = nil
    notice = nil
    defer {
      if session == connection, pending[target] == request { pending.removeValue(forKey: target) }
    }
    do {
      _ = try await client.openProjectTerminal(
        projectID: target.projectID, application: application, capabilityID: target.capabilityID)
      guard session == connection, generation == contextGeneration, context == target else { return }
      notice = L10n.text.copy(
        "已请求在 \(Self.displayName(application)) 打开目录。", "Requested the directory in \(Self.displayName(application)).")
    } catch {
      guard session == connection, generation == contextGeneration, context == target else { return }
      if case RuntimeAPIError.rejected = error {
        self.error = error.localizedDescription
        stale = true
      } else {
        self.error = L10n.text.copy(
          "无法确认独立终端是否已打开。请先检查终端窗口，再决定是否重试。",
          "Could not confirm whether the external terminal opened. Check its windows before trying again.")
      }
    }
  }

  static func displayName(_ application: String) -> String { application == "iTerm" ? "iTerm2" : application }
}
