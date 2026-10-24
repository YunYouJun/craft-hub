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
  private(set) var readVersion = UUID()
  @ObservationIgnored var changed: (() -> Void)?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var session = UUID()
  init(client: RuntimeAPIClient) { self.client = client }
  var canChange: Bool { client != nil && snapshot?.version == 1 && !busy && !uncertain && !stale }
  func invalidate() { stale = true }
  func disconnect() {
    session = UUID()
    readVersion = UUID()
    client = nil
    snapshot = nil
    busy = false
    opening = nil
    stale = true
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
      stale = false
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
