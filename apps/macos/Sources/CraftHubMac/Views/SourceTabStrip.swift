import AppKit

@MainActor final class SourceTabStripView: NSSegmentedControl {
  private let sizingControl = NSSegmentedControl()
  private var badges: [SourceBadgeImageView] = []
  private weak var badgeContainer: NSView?
  private(set) var items: [WorkSourceControl.Item] = []
  var onSelection: ((String) -> Void)?
  var selectedKey: String { items.indices.contains(selectedSegment) ? items[selectedSegment].key : "" }
  override var isEnabled: Bool {
    didSet { refreshBadges() }
  }
  override var isHidden: Bool {
    didSet { for badge in badges { badge.isHidden = isHidden } }
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    // Keep the original cell and draw path so AppKit can choose its modern effects.
    trackingMode = .selectOne
    segmentDistribution = .fit
    target = self
    action = #selector(selectSource(_:))
    sizingControl.segmentCount = 1
    sizingControl.segmentDistribution = .fit
  }

  required init?(coder: NSCoder) { nil }

  func setBadgeContainer(_ container: NSView) {
    badgeContainer = container
    for badge in badges { container.addSubview(badge) }
    needsLayout = true
  }

  override func setEnabled(_ enabled: Bool, forSegment segment: Int) {
    super.setEnabled(enabled, forSegment: segment)
    refreshBadges()
  }

  func update(items: [WorkSourceControl.Item], selection: String, title: String) {
    let changedStructure = self.items.map(\.key) != items.map(\.key)
    let changedSize =
      changedStructure || self.items.map(\.title) != items.map(\.title)
      || self.items.map(\.count) != items.map(\.count)
      || self.items.map { $0.image != nil } != items.map { $0.image != nil }
    self.items = items
    if segmentCount != items.count { segmentCount = items.count }
    if accessibilityLabel() != title { setAccessibilityLabel(title) }
    if changedStructure {
      for badge in badges { badge.removeFromSuperview() }
      badges = items.map { item in
        let badge = SourceBadgeImageView()
        badge.identifier = NSUserInterfaceItemIdentifier("source-count-" + item.key)
        badge.imageScaling = .scaleNone
        badge.setAccessibilityElement(false)
        badge.setAccessibilityHidden(true)
        badge.isHidden = isHidden
        badgeContainer?.addSubview(badge)
        return badge
      }
    }
    if changedSize {
      sizingControl.font = font
      sizingControl.controlSize = controlSize
      sizingControl.segmentStyle = segmentStyle
    }
    for (index, item) in items.enumerated() {
      if label(forSegment: index) != item.title { setLabel(item.title, forSegment: index) }
      if image(forSegment: index) !== item.image { setImage(item.image, forSegment: index) }
      if imageScaling(forSegment: index) != .scaleProportionallyDown {
        setImageScaling(.scaleProportionallyDown, forSegment: index)
      }
      let alignment: NSTextAlignment = userInterfaceLayoutDirection == .rightToLeft ? .right : .left
      if self.alignment(forSegment: index) != alignment { setAlignment(alignment, forSegment: index) }
      let tip = "\(item.title) (\(item.count))"
      if toolTip(forSegment: index) != tip { setToolTip(tip, forSegment: index) }
      if changedSize {
        sizingControl.setLabel(item.title, forSegment: 0)
        sizingControl.setImage(item.image, forSegment: 0)
        sizingControl.setImageScaling(.scaleProportionallyDown, forSegment: 0)
        setWidth(
          ceil(sizingControl.intrinsicContentSize.width) + SourceCountBadge.size(count: item.count).width + 14,
          forSegment: index)
      }
    }
    let selected = items.firstIndex { $0.key == selection } ?? -1
    if selectedSegment != selected { selectedSegment = selected }
    if changedSize { invalidateIntrinsicContentSize() }
    refreshBadges()
    if changedSize { needsLayout = true }
  }

  /// Exercise the same target/action path as a native segment activation.
  func activateSegment(at index: Int) {
    guard isEnabled, items.indices.contains(index), isEnabled(forSegment: index) else { return }
    selectedSegment = index
    sendAction(action, to: target)
  }

  @objc private func selectSource(_ sender: NSSegmentedControl) {
    guard items.indices.contains(sender.selectedSegment) else { return }
    refreshBadges()
    onSelection?(items[sender.selectedSegment].key)
  }

  override func layout() {
    super.layout()
    guard !items.isEmpty else { return }
    let widths = items.indices.map { width(forSegment: $0) }
    let gap = items.count > 1 ? max(0, intrinsicContentSize.width - widths.reduce(0, +)) / CGFloat(items.count - 1) : 0
    var x = bounds.minX
    for (index, item) in items.enumerated() {
      let size = SourceCountBadge.size(count: item.count)
      let frame = NSRect(
        x: userInterfaceLayoutDirection == .rightToLeft ? x + 4 : x + widths[index] - size.width - 4,
        y: bounds.midY - size.height / 2, width: size.width, height: size.height)
      let converted = badgeContainer.map { convert(frame, to: $0) } ?? frame
      if badges[index].frame != converted { badges[index].frame = converted }
      x += widths[index] + gap
    }
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    refreshBadges()
  }

  private func refreshBadges() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      for (index, item) in items.enumerated() where badges.indices.contains(index) {
        badges[index].update(
          count: item.count, selected: isSelected(forSegment: index), appearance: effectiveAppearance.name)
        let alpha: CGFloat = isEnabled && isEnabled(forSegment: index) ? 1 : 0.5
        if badges[index].alphaValue != alpha { badges[index].alphaValue = alpha }
      }
    }
  }

}

/// Artwork overlays never intercept input or replace the native cell's rendering and accessibility.
@MainActor private final class SourceBadgeImageView: NSImageView {
  private struct Content: Equatable {
    let count: Int
    let selected: Bool
    let appearance: NSAppearance.Name
  }
  private var content: Content?

  func update(count: Int, selected: Bool, appearance: NSAppearance.Name) {
    let next = Content(count: count, selected: selected, appearance: appearance)
    guard next != content else { return }
    content = next
    image = SourceCountBadge.image(count: count, selected: selected)
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
