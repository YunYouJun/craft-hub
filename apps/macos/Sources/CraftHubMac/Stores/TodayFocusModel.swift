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
  @ObservationIgnored private var invalidationGeneration = UUID()
  @ObservationIgnored private var readTask: Task<Void, Never>?
  @ObservationIgnored private var analysisTask: Task<Void, Never>?
  @ObservationIgnored private var loadedAt: Date?
  @ObservationIgnored private var loadedLocale: String?
  @ObservationIgnored private var loadingLocale: String?
  @ObservationIgnored private var workItemsRevision = 0
  @ObservationIgnored private var loadingRevision: Int?
  @ObservationIgnored private let now: () -> Date
  @ObservationIgnored private let currentLocale: @MainActor () -> String
  private var locale: String { currentLocale() }

  init(
    now: @escaping () -> Date = Date.init,
    locale: @escaping @MainActor () -> String = { NativePreferences.shared.language.rawValue }
  ) {
    self.now = now
    currentLocale = locale
  }

  func connect(_ client: RuntimeAPIClient?) {
    invalidate()
    self.client = client
    assistantAvailable = false
  }

  func invalidate() {
    generation = UUID()
    invalidationGeneration = UUID()
    readTask?.cancel()
    readTask = nil
    analysisTask?.cancel()
    analysisTask = nil
    snapshot = nil
    analysis = nil
    loading = false
    analyzing = false
    loadedAt = nil
    loadedLocale = nil
    loadingLocale = nil
    loadingRevision = nil
    workItemsRevision += 1
    error = nil
  }

  func load(force: Bool = false) async {
    guard !Task.isCancelled else { return }
    let language = locale
    // A recreated home view joins its current read. A language change must not wait for or reuse the old locale.
    if force || loadedLocale.map({ $0 != language }) == true || loadingLocale.map({ $0 != language }) == true {
      invalidate()
    }
    let invalidation = invalidationGeneration
    while invalidation == invalidationGeneration, language == locale, !Task.isCancelled {
      let revision: Int
      let pending: Task<Void, Never>
      if let readTask {
        revision = loadingRevision ?? workItemsRevision
        pending = readTask
      } else {
        guard let client else { return }
        if loadedLocale == language, let loadedAt, now().timeIntervalSince(loadedAt) < 60 { return }
        generation = UUID()
        let attempt = generation
        analysisTask?.cancel()
        analysisTask = nil
        analyzing = false
        analysis = nil
        revision = workItemsRevision
        // Preserve displayed rows until a response includes every invalidation received during the read.
        loading = true
        loadingLocale = language
        loadingRevision = revision
        pending = Task {
          defer {
            if attempt == generation {
              loading = false
              loadingLocale = nil
              loadingRevision = nil
              readTask = nil
            }
          }
          do {
            async let assistant = client.assistantStatus()
            let value = try await client.todayFocus(locale: language)
            let availability = (try? await assistant)?.available ?? false
            guard attempt == generation, revision == workItemsRevision, !Task.isCancelled, locale == language else {
              return
            }
            snapshot = value
            assistantAvailable = availability
            analysis = nil
            error = nil
            loadedAt = now()
            loadedLocale = language
          } catch {
            if attempt == generation, revision == workItemsRevision { self.error = error.localizedDescription }
          }
        }
        readTask = pending
      }
      await pending.value
      guard revision != workItemsRevision else { return }
    }
  }

  /// Keep the browser's filters and selection while refreshing a confirmed item receipt.
  func markWorkItemsStale() {
    loadedAt = nil
    workItemsRevision += 1
  }

  func refreshWorkItems() async {
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
