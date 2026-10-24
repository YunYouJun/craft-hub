import Foundation
import Testing
import UserNotifications

@testable import CraftHubMac

private final class NotificationCenterFixture: NativeNotificationCenter {
  weak var delegate: UNUserNotificationCenterDelegate?
  var categories: Set<UNNotificationCategory> = []
  var authorizationRequests: [UNAuthorizationOptions] = []
  var authorization: (UNAuthorizationOptions) async throws -> Bool = { _ in false }
  var clearedDelivered = 0

  func setNotificationCategories(_ categories: Set<UNNotificationCategory>) { self.categories = categories }
  func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
    authorizationRequests.append(options)
    return try await authorization(options)
  }
  func add(_ request: UNNotificationRequest) async throws {
    Issue.record("An authorization test must not post notifications")
  }
  func removeAllDeliveredNotifications() { clearedDelivered += 1 }
  func removeDeliveredNotifications(withIdentifiers identifiers: [String]) {}
  func removePendingNotificationRequests(withIdentifiers identifiers: [String]) {}
}

@MainActor @Test func notificationAuthorizationDenialCanBeRetriedAndOnlyGrantedPreferencePersists() async throws {
  let suite = "craft-hub-notifications-test-\(UUID())"
  let defaults = try #require(UserDefaults(suiteName: suite))
  defer { defaults.removePersistentDomain(forName: suite) }
  let center = NotificationCenterFixture()
  let notifications = NativeNotifications(center: center, defaults: defaults)
  notifications.start()
  #expect(center.authorizationRequests.isEmpty)
  #expect(!notifications.enabled)
  #expect(center.delegate === notifications)
  #expect(center.categories.map(\.identifier) == ["craft-hub-project-completed"])

  await notifications.setEnabled(true)
  #expect(!notifications.enabled && !notifications.requesting)
  #expect(!defaults.bool(forKey: "nativeRunNotifications"))
  let denialMessage = try #require(notifications.statusMessage)
  #expect(!denialMessage.isEmpty)

  center.authorization = { _ in
    throw NSError(domain: UNErrorDomain, code: UNError.Code.notificationsNotAllowed.rawValue)
  }
  await notifications.setEnabled(true)
  #expect(notifications.statusMessage == denialMessage)
  #expect(!notifications.enabled && !notifications.requesting)
  #expect(!defaults.bool(forKey: "nativeRunNotifications"))

  center.authorization = { _ in true }
  await notifications.setEnabled(true)
  #expect(notifications.enabled && !notifications.requesting)
  #expect(notifications.statusMessage == nil)
  #expect(defaults.bool(forKey: "nativeRunNotifications"))
  #expect(center.authorizationRequests.allSatisfy { $0 == [.alert, .sound] })

  let nextCenter = NotificationCenterFixture()
  let restored = NativeNotifications(center: nextCenter, defaults: defaults)
  restored.start()
  #expect(restored.enabled && nextCenter.authorizationRequests.isEmpty)
  await restored.setEnabled(false)
  #expect(!restored.enabled && !defaults.bool(forKey: "nativeRunNotifications"))
  #expect(nextCenter.authorizationRequests.isEmpty && nextCenter.clearedDelivered == 1)
}

@MainActor @Test func notificationAuthorizationCoalescesRepeatedClicksUntilTheSystemResponds() async throws {
  let suite = "craft-hub-notifications-test-\(UUID())"
  let defaults = try #require(UserDefaults(suiteName: suite))
  defer { defaults.removePersistentDomain(forName: suite) }
  let center = NotificationCenterFixture()
  var answer: CheckedContinuation<Bool, Never>?
  center.authorization = { _ in await withCheckedContinuation { answer = $0 } }
  let notifications = NativeNotifications(center: center, defaults: defaults)
  let pending = Task { await notifications.setEnabled(true) }
  for _ in 0..<100 {
    if answer != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  let continuation = try #require(answer)
  #expect(notifications.requesting && !notifications.enabled)
  #expect(defaults.object(forKey: "nativeRunNotifications") == nil)
  await notifications.setEnabled(true)
  #expect(center.authorizationRequests.count == 1)
  continuation.resume(returning: false)
  await pending.value
  #expect(!notifications.requesting && !notifications.enabled)
  center.authorization = { _ in true }
  await notifications.setEnabled(true)
  #expect(center.authorizationRequests.count == 2 && notifications.enabled)
}

@MainActor @Test func notificationAuthorizationTransportFailurePreservesPreferenceAndExplainsRetry() async throws {
  let suite = "craft-hub-notifications-test-\(UUID())"
  let defaults = try #require(UserDefaults(suiteName: suite))
  defer { defaults.removePersistentDomain(forName: suite) }
  defaults.set(true, forKey: "nativeRunNotifications")
  let center = NotificationCenterFixture()
  center.authorization = { _ in throw NSError(domain: NSCocoaErrorDomain, code: 4097) }
  let notifications = NativeNotifications(center: center, defaults: defaults)
  await notifications.setEnabled(true)
  #expect(notifications.enabled && !notifications.requesting)
  #expect(defaults.bool(forKey: "nativeRunNotifications"))
  let message = try #require(notifications.statusMessage)
  #expect(!message.contains("4097") && !message.contains(NSCocoaErrorDomain))
  #expect(!message.isEmpty)
  center.authorization = { _ in false }
  await notifications.setEnabled(true)
  #expect(!notifications.enabled && !defaults.bool(forKey: "nativeRunNotifications"))
  #expect(notifications.statusMessage != message)
}
