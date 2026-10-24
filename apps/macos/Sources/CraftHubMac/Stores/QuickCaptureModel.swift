import AppKit
import CraftHubMacCore
import Observation

@MainActor @Observable
final class QuickCaptureModel {
  var document: CaptureDocument { didSet { persist() } }
  private(set) var connection: CaptureConnection?
  private(set) var lists: [CaptureList] = []
  private(set) var loading = false
  private(set) var saving = false
  private(set) var analyzing = false
  private(set) var previewing = false
  private(set) var aiAvailable = false
  var error: String?
  private(set) var persistenceError: String?
  private(set) var recoveryRequired = false
  var shortcutNotice: String?
  var focus = UUID()
  var isOpen = false
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private let store: CaptureDraftStore
  @ObservationIgnored private var previewTask: Task<Void, Never>?
  @ObservationIgnored private var pollTask: Task<Void, Never>?
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var parsedDraft: CaptureDraft?
  @ObservationIgnored private var connectionRevision = 0
  private var text: L10n { L10n.text }
  private var locale: String { text.chinese ? "zh-CN" : "en" }
  var busy: Bool { saving || analyzing }
  var writable: Bool { connection?.connected == true && connection?.capabilities?.create == true }
  var canSave: Bool {
    !busy && !loading && !previewing && client != nil && writable && connection?.accountLabel?.isEmpty == false
      && !document.draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && lists.contains { $0.id == document.draft.listId } && persistenceError == nil
  }
  init(store: CaptureDraftStore? = nil) {
    let url = NativeStorage.directory.appendingPathComponent("native/capture-draft.json")
    self.store = store ?? CaptureDraftStore(url: url)
    do { document = try self.store.load() } catch {
      document = CaptureDocument()
      persistenceError = error.localizedDescription
      recoveryRequired = true
    }
  }
  func connect(_ client: RuntimeAPIClient?) {
    self.client = client
    connectionRevision += 1
    revision += 1
    previewing = false
    previewTask?.cancel()
    pollTask?.cancel()
    connection = nil
    lists = []
    loading = false
    aiAvailable = false
    if isOpen { Task { await load() } }
  }
  func opened() {
    isOpen = true
    focus = UUID()
    Task { await load() }
  }
  func closed() {
    isOpen = false
    pollTask?.cancel()
    pollTask = nil
  }
  func persist() {
    guard !recoveryRequired else { return }
    do {
      try store.save(document)
      persistenceError = nil
    } catch { persistenceError = error.localizedDescription }
  }
  func recoverDraft() {
    do {
      let backup = store.url.deletingPathExtension().appendingPathExtension("recovery-\(UUID().uuidString).json")
      try FileManager.default.copyItem(at: store.url, to: backup)
      recoveryRequired = false
      persist()
    } catch { persistenceError = error.localizedDescription }
  }
  /// AppKit can commit the same field value again when focus changes; that is not a new draft.
  func updateText(_ value: String) {
    let bounded = String(value.prefix(10000))
    guard bounded != document.text else { return }
    document.text = bounded
    editedText()
  }
  func editedText() {
    revision += 1
    document.receipt = nil
    error = nil
    previewTask?.cancel()
    // Always leave a useful local draft even while the runtime is unavailable.
    document.draft.title = document.text.trimmingCharacters(in: .whitespacesAndNewlines)
    document.draft.dueLocal = nil
    document.draft.remind = false
    document.draft.important = false
    document.draft.notes = ""
    document.draft.warnings = []
    parsedDraft = document.draft
    let version = revision
    previewing = client != nil && !document.text.isEmpty
    previewTask = Task {
      try? await Task.sleep(for: .milliseconds(180))
      guard !Task.isCancelled, version == revision else { return }
      await preview(ai: false, version: version)
    }
  }
  func editedDraft() {
    revision += 1
    previewing = false
    previewTask?.cancel()
    document.receipt = nil
  }
  func analyze() async {
    revision += 1
    await preview(ai: true, version: revision)
  }
  private func preview(ai: Bool, version: Int) async {
    guard let client, !document.text.isEmpty else { return }
    if ai { analyzing = true }
    defer {
      if ai { analyzing = false }
      if version == revision { previewing = false }
    }
    do {
      var result = try await client.previewCapture(text: document.text, lists: lists, ai: ai, locale: locale)
      guard version == revision, self.client === client else { return }
      result.listId = result.listId ?? document.draft.listId
      document.draft = result
      parsedDraft = result
    } catch {
      guard version == revision, self.client === client, !Task.isCancelled else { return }
      self.error = error.localizedDescription
    }
  }
  func load(authorize: Bool = false) async {
    guard let client, !busy else { return }
    connectionRevision += 1
    let version = connectionRevision
    loading = true
    error = nil
    pollTask?.cancel()
    defer { if version == connectionRevision { loading = false } }
    do {
      let status = try await client.captureConnection(authorize: authorize, locale: locale)
      guard version == connectionRevision, self.client === client else { return }
      connection = status
      lists = []
      if status.connected {
        let loaded = try await client.captureLists(locale: locale)
        guard version == connectionRevision, self.client === client else { return }
        lists = loaded
        // Resolve newly available #list tags without overwriting any fields the user has reviewed.
        if let previous = parsedDraft, !document.text.isEmpty {
          let previewRevision = revision
          let parsed = try await client.previewCapture(text: document.text, lists: lists, locale: locale)
          guard version == connectionRevision, self.client === client else { return }
          if previewRevision == revision, let listID = parsed.listId {
            if document.draft.title == previous.title { document.draft.title = parsed.title }
            if document.draft.listId == previous.listId { document.draft.listId = listID }
            parsedDraft = document.draft
          }
        }
        if !lists.contains(where: { $0.id == document.draft.listId }) {
          document.draft.listId =
            lists.first { $0.id == document.preferredLists[status.accountLabel ?? ""] }?.id
            ?? lists.first { ["Tasks", "任务", "Inbox", "收件箱"].contains($0.title) }?.id ?? lists.first?.id
        }
      }
      let available = (try? await client.assistantStatus().available) ?? false
      guard version == connectionRevision, self.client === client else { return }
      aiAvailable = available
      if status.deviceAuthorization != nil && isOpen {
        pollTask = Task {
          try? await Task.sleep(for: .seconds(4))
          guard !Task.isCancelled, isOpen else { return }
          await load()
        }
      }
    } catch {
      guard version == connectionRevision, self.client === client else { return }
      self.error = error.localizedDescription
    }
  }
  func save() async {
    guard canSave, let client, let account = connection?.accountLabel, let listID = document.draft.listId else {
      return
    }
    previewTask?.cancel()
    revision += 1
    saving = true
    error = nil
    defer { saving = false }
    do {
      let draft = document.draft
      var payload = [
        "accountId": account, "listId": listID, "title": draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
        "notes": draft.notes,
      ]
      if let due = draft.dueLocal, !due.isEmpty {
        let instant = try CaptureDates.instant(due)
        payload["dueDate"] = String(due.prefix(10))
        if draft.remind { payload["reminderAt"] = instant }
      }
      guard payload["title"]!.count <= 500, draft.notes.count <= 10000 else {
        throw RuntimeAPIError.rejected(
          400, text.copy("标题限 500 字，备注限 10000 字。", "Title is limited to 500 characters and notes to 10000."))
      }
      let requestID = try document.prepareAttempt(payload: payload, important: draft.important)
      try store.save(document)
      let item = try await client.saveCapture(payload: payload, important: draft.important, requestID: requestID)
      var cleared = CaptureDocument()
      cleared.preferredLists = document.preferredLists
      cleared.preferredLists[account] = listID
      cleared.draft.listId = listID
      cleared.receipt = text.copy("已保存到 Microsoft To Do：", "Saved to Microsoft To Do: ") + item.title
      // If this write fails, retain the old request ID and draft so a retry can recover the receipt safely.
      try store.save(cleared)
      document = cleared
      focus = UUID()
    } catch {
      self.error =
        text.copy("保存未确认，草稿已保留。可核对 To Do 后重试：", "Save unconfirmed. Draft retained; check To Do and retry: ")
        + error.localizedDescription
    }
  }
}
