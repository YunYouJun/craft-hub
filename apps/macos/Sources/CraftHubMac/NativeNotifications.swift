import AppKit
import CraftHubMacCore
import OSLog
import Observation
import UserNotifications

/// The system notification boundary, injectable so tests never request real OS permissions.
protocol NativeNotificationCenter: AnyObject {
  var delegate: UNUserNotificationCenterDelegate? { get set }
  func setNotificationCategories(_ categories: Set<UNNotificationCategory>)
  func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool
  func add(_ request: UNNotificationRequest) async throws
  func removeAllDeliveredNotifications()
  func removeDeliveredNotifications(withIdentifiers identifiers: [String])
  func removePendingNotificationRequests(withIdentifiers identifiers: [String])
}

extension UNUserNotificationCenter: NativeNotificationCenter {}

/// Optional completion alerts. The only response action opens a project review page.
@MainActor @Observable final class NativeNotifications: NSObject, UNUserNotificationCenterDelegate {
  private(set) var enabled: Bool
  private(set) var requesting = false
  private(set) var statusMessage: String?
  @ObservationIgnored var openProject: ((String) -> Void)?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var request: Task<Void, Never>?
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var tracker = RunCompletionTracker()
  @ObservationIgnored private let center: NativeNotificationCenter
  @ObservationIgnored private let defaults: UserDefaults
  private let category = "craft-hub-project-completed"
  private let openAction = "craft-hub-open-project"
  private static let logger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "dev.craft-hub.macos-prototype", category: "Notifications")

  init(
    center: NativeNotificationCenter = UNUserNotificationCenter.current(),
    defaults: UserDefaults = NativeStorage.defaults
  ) {
    self.center = center
    self.defaults = defaults
    enabled = defaults.bool(forKey: "nativeRunNotifications")
    super.init()
  }

  func start() {
    center.delegate = self
    center.setNotificationCategories([
      UNNotificationCategory(
        identifier: category,
        actions: [
          UNNotificationAction(
            identifier: openAction, title: L10n.text.copy("查看项目", "View Project"), options: [.foreground])
        ],
        intentIdentifiers: [], options: [])
    ])
  }

  /// Called only by the user's settings toggle; launch never prompts for notification permission.
  func setEnabled(_ value: Bool) async {
    guard !requesting else { return }
    requesting = true
    defer { requesting = false }
    statusMessage = nil
    do {
      enabled = value ? try await center.requestAuthorization(options: [.alert, .sound]) : false
      defaults.set(enabled, forKey: "nativeRunNotifications")
      request?.cancel()
      request = nil
      generation = UUID()
      tracker = RunCompletionTracker()
      if value && !enabled {
        statusMessage = permissionMessage
      }
      if enabled { refresh() } else { center.removeAllDeliveredNotifications() }
    } catch {
      let failure = error as NSError
      Self.logger.error("Notification authorization failed: \(failure.domain, privacy: .public) (\(failure.code))")
      statusMessage =
        failure.domain == UNErrorDomain && failure.code == UNError.Code.notificationsNotAllowed.rawValue
        ? permissionMessage
        : L10n.text.copy("无法请求系统通知权限，请稍后重试。", "Unable to request notification permission. Try again later.")
    }
  }

  private var permissionMessage: String {
    L10n.text.copy("请在系统设置的“通知”中允许 Craft Hub。", "Allow Craft Hub in System Settings → Notifications.")
  }

  func connect(_ client: RuntimeAPIClient?) {
    generation = UUID()
    request?.cancel()
    request = nil
    self.client = client
    tracker = RunCompletionTracker()
    refresh()
  }

  func refresh() {
    revision += 1
    guard enabled, let client, request == nil else { return }
    let attempt = generation
    request = Task { [weak self] in
      guard let self else { return }
      defer { if generation == attempt { request = nil } }
      repeat {
        let version = revision
        do {
          let snapshot = try await client.runSummaries()
          guard generation == attempt, !Task.isCancelled, enabled else { return }
          for summary in tracker.consume(snapshot) {
            guard generation == attempt, !Task.isCancelled, enabled else { return }
            await post(summary, generation: attempt)
          }
        } catch { return }
        if revision == version { return }
      } while !Task.isCancelled
    }
  }

  private func post(_ summary: ProjectRunSummary, generation: UUID) async {
    guard !NSApp.isActive, enabled else { return }
    let content = UNMutableNotificationContent()
    content.title = "Craft Hub"
    switch summary.lastStatus {
    case .completed: content.body = L10n.text.copy("项目任务已完成。", "A project task completed.")
    case .failed: content.body = L10n.text.copy("项目任务未成功完成。", "A project task failed.")
    case .cancelled, nil: return
    }
    content.categoryIdentifier = category
    content.userInfo = ["projectId": summary.projectId]
    let identifier = "project-" + UUID().uuidString
    do {
      try await center.add(
        UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
      if self.generation != generation || !enabled || Task.isCancelled {
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
      }
    } catch { statusMessage = L10n.text.copy("系统通知暂时不可用。", "System notifications are unavailable.") }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    guard [UNNotificationDefaultActionIdentifier, "craft-hub-open-project"].contains(response.actionIdentifier),
      response.notification.request.content.categoryIdentifier == "craft-hub-project-completed",
      let project = response.notification.request.content.userInfo["projectId"] as? String,
      !project.isEmpty, project.count <= 1024,
      !project.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
    else { return }
    await MainActor.run { self.openProject?(project) }
  }
}
