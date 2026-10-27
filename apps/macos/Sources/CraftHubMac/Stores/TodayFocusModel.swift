import CraftHubMacCore
import Foundation
import Observation

@MainActor @Observable
final class TodayFocusModel {
  private(set) var snapshot: TodayFocusSnapshot?
  private(set) var loading = false
  private(set) var analyzing = false
  private(set) var assistantAvailable = false
  private(set) var analysis: TodayFocusAnalysis?
  private(set) var error: String?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var readTask: Task<Void, Never>?
  @ObservationIgnored private var analysisTask: Task<Void, Never>?
  @ObservationIgnored private var loadedAt: Date?
  @ObservationIgnored private var loadedLocale: String?
  @ObservationIgnored private let now: () -> Date
  private var locale: String { NativePreferences.shared.language.rawValue }

  init(now: @escaping () -> Date = Date.init) { self.now = now }

  func connect(_ client: RuntimeAPIClient?) {
    invalidate()
    self.client = client
    assistantAvailable = false
  }

  func invalidate() {
    generation = UUID()
    readTask?.cancel()
    readTask = nil
    analysisTask?.cancel()
    analysisTask = nil
    snapshot = nil
    analysis = nil
    loading = false
    analyzing = false
    loadedAt = nil
    error = nil
  }

  func load(force: Bool = false) async {
    if force { invalidate() }
    if let readTask {
      await readTask.value
      return
    }
    guard let client else { return }
    if loadedLocale == locale, let loadedAt, now().timeIntervalSince(loadedAt) < 60 { return }
    generation = UUID()
    analysisTask?.cancel()
    analysisTask = nil
    analyzing = false
    analysis = nil
    // Keep the browser's selection and search stable during the periodic read. Explicit invalidation still clears accounts.
    let attempt = generation
    let language = locale
    loading = true
    readTask = Task {
      defer {
        if attempt == generation {
          loading = false
          readTask = nil
        }
      }
      do {
        async let assistant = client.assistantStatus()
        let value = try await client.todayFocus(locale: language)
        let availability = (try? await assistant)?.available ?? false
        guard attempt == generation, !Task.isCancelled, locale == language else { return }
        snapshot = value
        assistantAvailable = availability
        analysis = nil
        error = nil
        loadedAt = now()
        loadedLocale = language
      } catch {
        if attempt == generation { self.error = error.localizedDescription }
      }
    }
    await readTask?.value
  }

  /// Keep the browser's filters and selection while refreshing a confirmed item receipt.
  func markWorkItemsStale() { loadedAt = nil }

  func refreshWorkItems() async {
    if let readTask { await readTask.value }
    markWorkItemsStale()
    await load()
  }

  func analyze() async {
    guard let client, let snapshot, !snapshot.candidates.isEmpty, assistantAvailable, !analyzing, !loading else {
      return
    }
    let attempt = generation
    let language = locale
    analyzing = true
    error = nil
    analysisTask = Task {
      defer {
        if attempt == generation {
          analyzing = false
          analysisTask = nil
        }
      }
      do {
        let result = try await client.analyzeTodayFocus(snapshot, locale: language)
        guard attempt == generation, !Task.isCancelled, locale == language else { return }
        analysis = result
      } catch {
        if attempt == generation {
          self.error = L10n.text.copy(
            "AI 分析暂不可用，已保留日期和优先级排序。", "AI is unavailable; deadline and priority ordering remains available.")
        }
      }
    }
    await analysisTask?.value
  }
}
