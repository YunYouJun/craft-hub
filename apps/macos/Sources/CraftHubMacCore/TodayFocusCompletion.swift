import Foundation

extension TodayFocusSnapshot {
  /// Apply one verified receipt without reading other sources. Undo restores the original row and its position.
  public func applyingCompletion(
    to target: WorkItemActionTarget, receipt: IntegrationPresentation.Entity, restoringFrom previous: Self? = nil
  ) -> Self {
    guard target.item.sourceRef != nil, target.item.sourceRef == receipt.sourceRef else { return self }
    func matches(_ candidate: WorkItemActionTarget?) -> Bool {
      candidate?.integrationId == target.integrationId && candidate?.projectId == target.projectId
        && candidate?.item.sourceRef == target.item.sourceRef
    }
    func replacement(_ original: WorkItemActionTarget, cached: Bool) -> WorkItemActionTarget {
      WorkItemActionTarget(
        integrationId: original.integrationId, projectId: original.projectId,
        item: original.item.merging(receipt), readOnly: cached,
        accountKey: original.accountKey, connectionCacheKey: original.connectionCacheKey,
        connectionInput: original.connectionInput)
    }
    var delta = 0
    let updatedSources = sources.map { source -> Source in
      guard let browser = source.browser,
        target.accountKey == nil || browser.accountKey == target.accountKey
      else { return source }
      var rows = browser.items
      if receipt.active, !rows.contains(where: { matches($0.actionTarget) }),
        let oldSource = previous?.sources.first(where: {
          $0.key == source.key && $0.browser?.accountKey == browser.accountKey
        }),
        let oldRows = oldSource.browser?.items,
        let index = oldRows.firstIndex(where: { matches($0.actionTarget) })
      {
        rows.insert(oldRows[index], at: min(index, rows.count))
      }
      rows = rows.compactMap { row in
        guard let original = row.actionTarget, matches(original) else { return row }
        guard receipt.active else { return nil }
        return TodayWorkBrowser.Item(
          key: row.key, title: receipt.title, collectionKey: row.collectionKey,
          status: receipt.statusLabel ?? receipt.status, type: row.type, url: row.url, due: row.due,
          actionTarget: replacement(original, cached: source.cached), categories: row.categories)
      }
      let change = rows.count - browser.items.count
      delta += change
      return Source(
        key: source.key, title: source.title, sectionTitle: source.sectionTitle, path: source.path,
        state: source.state, complete: source.complete, cached: source.cached, count: max(0, source.count + change),
        icon: source.icon, accountLabel: source.accountLabel,
        browser: TodayWorkBrowser(
          collections: browser.collections, accountKey: browser.accountKey, projectMode: browser.projectMode,
          fetchedAt: browser.fetchedAt, items: rows))
    }
    var focus = items
    if receipt.active, !focus.contains(where: { matches($0.actionTarget) }),
      let oldItems = previous?.items, let index = oldItems.firstIndex(where: { matches($0.actionTarget) }),
      updatedSources.contains(where: { source in
        source.key == oldItems[index].sourceKey
          && source.browser?.items.contains(where: { matches($0.actionTarget) }) == true
      })
    {
      focus.insert(oldItems[index], at: min(index, focus.count))
    }
    let removed = Set(focus.filter { matches($0.actionTarget) }.map(\.key))
    focus = focus.compactMap { row in
      guard let original = row.actionTarget, matches(original) else { return row }
      guard receipt.active else { return nil }
      let cached = updatedSources.first { $0.key == row.sourceKey }?.cached ?? original.readOnly
      return Item(
        key: row.key, title: receipt.title, sourceTitle: row.sourceTitle, sourceKey: row.sourceKey,
        path: row.path, reasons: row.reasons, status: receipt.statusLabel ?? receipt.status,
        statusCategory: receipt.statusCategory, project: row.project,
        actionTarget: replacement(original, cached: cached))
    }
    var updatedCandidates = candidates.filter { receipt.active || !removed.contains($0.key) }
    if receipt.active, let oldCandidates = previous?.candidates {
      let focusKeys = Set(focus.map(\.key))
      for (index, candidate) in oldCandidates.enumerated()
      where removed.contains(candidate.key) && focusKeys.contains(candidate.key)
        && !updatedCandidates.contains(where: { $0.key == candidate.key })
      {
        updatedCandidates.insert(candidate, at: min(index, updatedCandidates.count))
      }
    }
    return Self(
      version: version, checkedAt: checkedAt, sourceCount: sourceCount, total: max(0, total + delta),
      sources: updatedSources, items: focus, candidates: updatedCandidates)
  }
}
