import AppKit
import CraftHubMacCore
import Observation
import QuartzCore
import SwiftUI

struct WorkSourceBrowserIdentity: Hashable {
  let source: String
  let account: String?
}

/// Keep a small number of source pages alive without diffing their lists on every tab selection.
struct WorkSourceBrowserHost: NSViewRepresentable {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let identity: WorkSourceBrowserIdentity?
  let validIdentities: Set<WorkSourceBrowserIdentity>
  let revision: String
  let browser: TodayWorkBrowser?
  let sourceIcon: String?
  let workItemActions: WorkItemQuickActionsModel
  let openSource: () -> Void
  var capacity = 4

  func makeNSView(context: Context) -> WorkSourceBrowserContainer { WorkSourceBrowserContainer() }

  func updateNSView(_ view: WorkSourceBrowserContainer, context: Context) {
    view.update(
      identity: identity, validIdentities: validIdentities, revision: revision, browser: browser,
      sourceIcon: sourceIcon, workItemActions: workItemActions, openSource: openSource, capacity: capacity,
      reduceMotion: reduceMotion)
  }

  static func dismantleNSView(_ view: WorkSourceBrowserContainer, coordinator: ()) { view.removeAllPages() }
}

@MainActor @Observable private final class WorkSourceBrowserSelectionState {
  var selection = WorkItemsBrowserSelection()
}

@MainActor @Observable private final class WorkSourceBrowserPageModel {
  let identity: WorkSourceBrowserIdentity
  let state: WorkSourceBrowserSelectionState
  var browser: TodayWorkBrowser
  var sourceIcon: String?
  var workItemActions: WorkItemQuickActionsModel
  @ObservationIgnored var revision: String
  @ObservationIgnored var openSource: () -> Void

  init(
    identity: WorkSourceBrowserIdentity, state: WorkSourceBrowserSelectionState, revision: String,
    browser: TodayWorkBrowser, sourceIcon: String?, workItemActions: WorkItemQuickActionsModel,
    openSource: @escaping () -> Void
  ) {
    self.identity = identity
    self.state = state
    self.revision = revision
    self.browser = browser
    self.sourceIcon = sourceIcon
    self.workItemActions = workItemActions
    self.openSource = openSource
  }

  func update(
    revision: String, browser: TodayWorkBrowser, sourceIcon: String?,
    workItemActions: WorkItemQuickActionsModel, openSource: @escaping () -> Void
  ) {
    self.openSource = openSource
    guard
      self.revision != revision || self.browser != browser
        || self.workItemActions !== workItemActions || self.sourceIcon != sourceIcon
    else {
      return
    }
    self.revision = revision
    self.browser = browser
    self.sourceIcon = sourceIcon
    self.workItemActions = workItemActions
  }
}

private struct WorkSourceBrowserPageView: View {
  let model: WorkSourceBrowserPageModel

  var body: some View {
    @Bindable var state = model.state
    WorkItemsBrowserView(
      browser: model.browser, openSource: { model.openSource() },
      sourceIcon: model.sourceIcon, workItemActions: model.workItemActions, selection: $state.selection)
  }
}

/// Native visibility changes leave each retained page's SwiftUI graph and table rows intact.
@MainActor final class WorkSourceBrowserContainer: NSView {
  private static let transitionKey = "source-switch-fade"

  private struct Page {
    let model: WorkSourceBrowserPageModel
    let host: NSHostingView<WorkSourceBrowserPageView>
    var lastUsed: UInt64
  }

  private var pages: [WorkSourceBrowserIdentity: Page] = [:]
  private var states: [WorkSourceBrowserIdentity: WorkSourceBrowserSelectionState] = [:]
  private var useCount: UInt64 = 0
  private(set) var selectedIdentity: WorkSourceBrowserIdentity?
  var cachedIdentities: Set<WorkSourceBrowserIdentity> { Set(pages.keys) }
  var stateIdentities: Set<WorkSourceBrowserIdentity> { Set(states.keys) }
  var activeHostingView: NSView? { selectedIdentity.flatMap { pages[$0]?.host } }

  override var isFlipped: Bool { true }
  override var intrinsicContentSize: NSSize {
    NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric)
  }

  func update(
    identity: WorkSourceBrowserIdentity?, validIdentities: Set<WorkSourceBrowserIdentity>, revision: String,
    browser: TodayWorkBrowser?, sourceIcon: String?, workItemActions: WorkItemQuickActionsModel,
    openSource: @escaping () -> Void, capacity: Int, reduceMotion: Bool = false
  ) {
    for removed in Set(pages.keys).subtracting(validIdentities) { removePage(removed) }
    states = states.filter { validIdentities.contains($0.key) }
    guard let identity, let browser, validIdentities.contains(identity) else {
      hideActivePage()
      selectedIdentity = nil
      return
    }

    let switchingSource = selectedIdentity != nil && selectedIdentity != identity
    useCount &+= 1
    if var page = pages[identity] {
      page.lastUsed = useCount
      pages[identity] = page
      page.model.update(
        revision: revision, browser: browser, sourceIcon: sourceIcon, workItemActions: workItemActions,
        openSource: openSource)
    } else {
      let state = states[identity] ?? WorkSourceBrowserSelectionState()
      states[identity] = state
      let model = WorkSourceBrowserPageModel(
        identity: identity, state: state, revision: revision, browser: browser, sourceIcon: sourceIcon,
        workItemActions: workItemActions, openSource: openSource)
      let host = NSHostingView(rootView: WorkSourceBrowserPageView(model: model))
      host.sizingOptions = []
      host.wantsLayer = true
      host.translatesAutoresizingMaskIntoConstraints = true
      host.autoresizingMask = []
      host.isHidden = true
      if bounds.width > 0 && bounds.height > 0 { host.frame = bounds }
      pages[identity] = Page(model: model, host: host, lastUsed: useCount)
      addSubview(host)
    }

    if selectedIdentity != identity {
      hideActivePage()
      selectedIdentity = identity
    }
    if let host = pages[identity]?.host {
      if bounds.width > 0 && bounds.height > 0 && host.frame != bounds { host.frame = bounds }
      host.isHidden = false
      host.setAccessibilityHidden(false)
      if reduceMotion {
        host.layer?.removeAnimation(forKey: Self.transitionKey)
      } else if switchingSource {
        // Animate the retained page's composite without animating or rebuilding its table rows.
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0
        fade.toValue = 1
        fade.duration = 0.16
        fade.timingFunction = CAMediaTimingFunction(name: .easeOut)
        host.layer?.add(fade, forKey: Self.transitionKey)
      }
    }
    let limit = min(6, max(1, capacity))
    while pages.count > limit,
      let victim = pages.filter({ $0.key != identity }).min(by: { $0.value.lastUsed < $1.value.lastUsed })?.key
    {
      removePage(victim)
    }
  }

  override func layout() {
    super.layout()
    guard bounds.width > 0 && bounds.height > 0, let host = activeHostingView, host.frame != bounds else { return }
    host.frame = bounds
  }

  func removeAllPages() {
    hideActivePage()
    for identity in Array(pages.keys) { removePage(identity) }
    states = [:]
    selectedIdentity = nil
  }

  private func hideActivePage() {
    guard let host = activeHostingView else { return }
    host.layer?.removeAnimation(forKey: Self.transitionKey)
    if let responder = window?.firstResponder as? NSView, responder.isDescendant(of: host) {
      window?.makeFirstResponder(nil)
    }
    host.isHidden = true
    host.setAccessibilityHidden(true)
  }

  private func removePage(_ identity: WorkSourceBrowserIdentity) {
    if selectedIdentity == identity {
      hideActivePage()
      selectedIdentity = nil
    }
    pages.removeValue(forKey: identity)?.host.removeFromSuperview()
  }
}
