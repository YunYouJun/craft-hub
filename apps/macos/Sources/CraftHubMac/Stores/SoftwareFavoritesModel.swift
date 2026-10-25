import CraftHubMacCore
import Foundation
import Observation

@MainActor @Observable final class SoftwareFavoritesModel {
  private(set) var snapshot: SoftwareFavoritesSnapshot?
  private(set) var busy = false
  private(set) var uncertain = false
  private(set) var stale = true
  private(set) var error: String?
  private(set) var notice: String?
  private(set) var opening: String?
  private(set) var loading = false
  var editing = false
  var selectedDraftID: String?
  var draft: [SoftwareFavoritesSnapshot.Tool] = []
  private(set) var draftRevision: String?
  private(set) var editorError: String?
  private(set) var readVersion = UUID()
  private var catalogArtwork: [String: SoftwareSnapshot.Item] = [:]
  @ObservationIgnored var changed: (() -> Void)?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var session = UUID()
  init(client: RuntimeAPIClient) { self.client = client }
  var canChange: Bool { client != nil && snapshot?.version == 1 && !busy && !loading && !uncertain && !stale }
  var canSave: Bool { canChange && draftRevision == snapshot?.revision }
  func invalidate() {
    stale = true
    readVersion = UUID()
  }
  func disconnect() {
    session = UUID()
    readVersion = UUID()
    client = nil
    snapshot = nil
    catalogArtwork = [:]
    busy = false
    opening = nil
    loading = false
    stale = true
  }
  /// Favorites read cached catalog metadata only, without invoking discovery providers.
  func load(force: Bool = false) async {
    if force { invalidate() }
    guard let client, !loading, !busy, stale || snapshot == nil else { return }
    let request = session
    loading = true
    error = nil
    defer { if session == request { loading = false } }
    repeat {
      let version = readVersion
      do {
        let result = try await client.software(localDiscovery: false)
        guard session == request, !Task.isCancelled else { return }
        receiveCatalog(result, version: version)
        if version == readVersion, snapshot == nil { throw RuntimeAPIError.incompatibleVersion }
      } catch {
        guard session == request, !Task.isCancelled else { return }
        if version == readVersion { self.error = error.localizedDescription }
      }
      if version == readVersion || Task.isCancelled || busy { return }
    } while true
  }
  func receiveCatalog(_ catalog: SoftwareSnapshot, version: UUID) {
    guard client != nil, !busy, version == readVersion else { return }
    catalogArtwork = [:]
    for item in catalog.sources.flatMap(\.items) {
      guard item.iconUrl != nil || item.macosIconUrl != nil else { continue }
      let key = websiteIdentity(item.url)
      if catalogArtwork[key] == nil { catalogArtwork[key] = item }
    }
    receive(catalog.favorites, version: version)
  }
  /// Enrich display only: custom artwork wins and cached images never become fields in the editor draft.
  func artwork(_ tool: SoftwareFavoritesSnapshot.Tool) -> SoftwareArtwork {
    guard let catalog = catalogArtwork[websiteIdentity(tool.url)] else { return tool.artwork }
    let matches = tool.iconUrl == nil || tool.iconUrl == catalog.iconUrl || tool.iconUrl == catalog.macosIconUrl
    let icon = tool.iconUrl ?? catalog.iconUrl
    let macosIcon = tool.macosIconUrl ?? (matches ? catalog.macosIconUrl : nil)
    return SoftwareArtwork(
      website: tool.url, iconURL: icon, macosIconURL: macosIcon,
      style: tool.iconStyle ?? (matches ? catalog.iconStyle : nil),
      scale: tool.iconScale
        ?? ((macosIcon ?? icon) == (catalog.macosIconUrl ?? catalog.iconUrl) ? catalog.iconScale : nil))
  }
  private func websiteIdentity(_ value: String) -> String {
    guard var url = URLComponents(string: value) else { return value }
    url.fragment = nil
    while url.path.hasSuffix("/") { url.path.removeLast() }
    return url.string ?? value
  }
  func beginEditing(select id: String? = nil) {
    guard canChange, let snapshot else { return }
    draft = snapshot.tools
    selectedDraftID = id ?? draft.first?.id
    draftRevision = snapshot.revision
    editorError = nil
    editing = true
  }
  func appendTool() {
    guard !busy, draft.count < 100 else { return }
    draft.append(.init(group: "AI Tools"))
    selectedDraftID = draft.last?.id
  }
  func saveDraft() async {
    guard canSave, let client, let revision = draftRevision else { return }
    let request = session
    readVersion = UUID()
    let mutationVersion = readVersion
    busy = true
    editorError = nil
    error = nil
    notice = nil
    defer {
      if session == request {
        readVersion = UUID()
        busy = false
        changed?()
      }
    }
    do {
      let result = try await client.replaceFavorites(draft, revision: revision)
      guard session == request else { return }
      snapshot = result
      stale = readVersion != mutationVersion
      editing = false
      draftRevision = nil
      notice = L10n.text.copy("常用工具已保存。", "Favorites saved.")
    } catch {
      guard session == request else { return }
      if case RuntimeAPIError.rejected(400, _) = error {
        editorError = L10n.text.copy(
          "请填写名称、分组及不含账号密码的 HTTPS 链接；Raycast 命令须为不带参数的 raycast://extensions/作者/扩展/命令。",
          "Enter a name, group and HTTPS URLs without credentials. Raycast commands require raycast://extensions/owner/extension/command without parameters."
        )
      } else {
        editorError = L10n.text.copy(
          "保存未确认，草稿已保留。请重新读取，再载入已保存版本后编辑。",
          "Save was not confirmed. Your draft is retained. Reload, then use the saved version before editing again.")
        self.error = error.localizedDescription
        uncertain = true
        stale = true
      }
    }
  }
  func receive(_ value: SoftwareFavoritesSnapshot?, version: UUID) {
    guard client != nil, !busy, version == readVersion else { return }
    snapshot = value?.version == 1 ? value : nil
    stale = snapshot == nil
    if uncertain, snapshot != nil {
      uncertain = false
      error = nil
      notice = L10n.text.copy("已重新读取收藏，请核对后再操作。", "Favorites reloaded. Review the current state before continuing.")
    }
  }
  func favorite(source: String, item: String) -> Bool {
    snapshot?.matches.contains { $0.sourceId == source && $0.softwareId == item } == true
  }
  func add(source: String, item: String) async {
    guard canChange, !favorite(source: source, item: item), let snapshot, snapshot.tools.count < 100 else { return }
    await change([
      "action": "add", "sourceId": source, "softwareId": item, "revision": snapshot.revision,
      "locale": L10n.text.chinese ? "zh-CN" : "en",
    ])
  }
  func remove(_ id: String, revision: String) async {
    guard canChange, revision == snapshot?.revision, snapshot?.tools.contains(where: { $0.id == id }) == true else {
      return
    }
    await change(["action": "remove", "toolId": id, "revision": revision])
  }
  private func change(_ input: [String: String]) async {
    guard let client else { return }
    let request = session
    readVersion = UUID()
    let mutationVersion = readVersion
    busy = true
    error = nil
    notice = nil
    defer {
      if session == request {
        readVersion = UUID()
        busy = false
        changed?()
      }
    }
    do {
      let result = try await client.updateFavorite(input)
      guard session == request else { return }
      snapshot = result
      stale = readVersion != mutationVersion
      notice = L10n.text.copy("常用工具已保存。", "Favorites saved.")
    } catch {
      guard session == request else { return }
      self.error = error.localizedDescription
      uncertain = true
      stale = true
    }
  }
  func open(_ id: String) async {
    guard let client, opening == nil, snapshot?.tools.contains(where: { $0.id == id }) == true else { return }
    let request = session
    opening = id
    error = nil
    defer { if session == request { opening = nil } }
    do {
      let destination = try await client.openFavorite(id)
      guard session == request else { return }
      notice =
        destination == "application"
        ? L10n.text.copy("已请求打开应用。", "Requested to open the application.")
        : L10n.text.copy("已打开工具网站。", "Opened the tool website.")
    } catch { if session == request { self.error = error.localizedDescription } }
  }
}
