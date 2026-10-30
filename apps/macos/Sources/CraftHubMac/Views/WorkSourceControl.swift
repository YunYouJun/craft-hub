import AppKit
import SwiftUI

/// Measure one native selector instead of asking SwiftUI to lay out an unused menu alternative.
struct WorkSourceControl: NSViewRepresentable {
  struct Item {
    let key: String
    let title: String
    let count: Int
    let image: NSImage?
  }

  let items: [WorkSourceControl.Item]
  @Binding var selection: String
  let title: String
  /// nil adapts to the actual available width; explicit styles are useful for constrained surfaces.
  let segmented: Bool?

  func makeNSView(context: Context) -> WorkSourceControlView { WorkSourceControlView() }

  func updateNSView(_ view: WorkSourceControlView, context: Context) {
    view.onSelection = { selection = $0 }
    view.update(items: items, selection: selection, title: title, segmented: segmented)
  }

  func sizeThatFits(_ proposal: ProposedViewSize, nsView: WorkSourceControlView, context: Context) -> CGSize? {
    nsView.fittingSize(availableWidth: proposal.width)
  }
}

/// The system segmented control stays alive when its compact popup is needed.
@MainActor final class WorkSourceControlView: NSView {
  let strip = SourceTabStripView()
  private(set) var popup: NSPopUpButton?
  private(set) var showsPopup = false
  private var items: [WorkSourceControl.Item] = []
  private var selectedKey = ""
  private var title = ""
  private var segmented: Bool?
  var onSelection: ((String) -> Void)?

  override var intrinsicContentSize: NSSize {
    let stripSize = strip.intrinsicContentSize
    if segmented == false, let popup { return popup.intrinsicContentSize }
    return NSSize(width: stripSize.width, height: max(stripSize.height, popup?.intrinsicContentSize.height ?? 0))
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    setAccessibilityElement(true)
    setAccessibilityRole(.group)
    strip.onSelection = { [weak self] key in self?.choose(key) }
    addSubview(strip)
    strip.setBadgeContainer(self)
  }

  required init?(coder: NSCoder) { nil }

  func update(items: [WorkSourceControl.Item], selection: String, title: String, segmented: Bool?) {
    let metadataChanged =
      self.items.count != items.count
      || zip(self.items, items).contains {
        $0.key != $1.key || $0.title != $1.title || $0.count != $1.count || $0.image !== $1.image
      }
    let presentationChanged = self.segmented != segmented
    let selectionChanged = selectedKey != selection
    let titleChanged = self.title != title
    self.items = items
    selectedKey = selection
    self.title = title
    self.segmented = segmented
    if accessibilityLabel() != title { setAccessibilityLabel(title) }
    strip.update(items: items, selection: selection, title: title)
    if let popup {
      if metadataChanged { updatePopupItems(popup) }
      if titleChanged, popup.accessibilityLabel() != title { popup.setAccessibilityLabel(title) }
      synchronizePopupSelection(popup)
    }
    if segmented == false { _ = ensurePopup() }
    if metadataChanged || presentationChanged || (segmented == false && selectionChanged) {
      invalidateIntrinsicContentSize()
      needsLayout = true
    }
    if metadataChanged { NSAccessibility.post(element: self, notification: .layoutChanged) }
  }

  func fittingSize(availableWidth: CGFloat?) -> NSSize {
    let stripSize = strip.intrinsicContentSize
    if segmented == true { return stripSize }
    let width = availableWidth.map { $0.isFinite ? max(0, $0) : stripSize.width } ?? stripSize.width
    let compact = segmented == false || width < stripSize.width
    if compact, width > 0 {
      let popupSize = ensurePopup().intrinsicContentSize
      return NSSize(
        width: min(width, segmented == false ? popupSize.width : stripSize.width),
        height: max(stripSize.height, popupSize.height))
    }
    return NSSize(width: min(width, stripSize.width), height: intrinsicContentSize.height)
  }

  override func layout() {
    super.layout()
    guard bounds.width > 0 && bounds.height > 0 else { return }
    let compact = segmented == false || (segmented == nil && bounds.width < strip.intrinsicContentSize.width)
    let representationChanged = showsPopup != compact
    let oldControl: NSView
    if showsPopup, let popup { oldControl = popup } else { oldControl = strip }
    let focused =
      (window?.firstResponder as? NSView).map { $0 === oldControl || $0.isDescendant(of: oldControl) } ?? false
    showsPopup = compact
    if strip.isHidden != compact {
      strip.isHidden = compact
    }
    let control: NSControl
    if compact {
      let popup = ensurePopup()
      if popup.isHidden {
        popup.isHidden = false
      }
      control = popup
    } else {
      if let popup, !popup.isHidden {
        popup.isHidden = true
      }
      control = strip
    }
    let height = min(bounds.height, control.intrinsicContentSize.height)
    let width = min(bounds.width, compact ? bounds.width : strip.intrinsicContentSize.width)
    let frame = NSRect(x: bounds.minX, y: bounds.midY - height / 2, width: width, height: height)
    if control.frame != frame { control.frame = frame }
    if focused, oldControl !== control { window?.makeFirstResponder(control) }
    if representationChanged { NSAccessibility.post(element: self, notification: .layoutChanged) }
  }

  override func accessibilityChildren() -> [Any]? {
    if showsPopup { return popup.map { NSAccessibility.unignoredChildrenForOnlyChild(from: $0) } ?? [] }
    return NSAccessibility.unignoredChildrenForOnlyChild(from: strip)
  }

  private func ensurePopup() -> NSPopUpButton {
    if let popup { return popup }
    let popup = NSPopUpButton(frame: .zero, pullsDown: false)
    popup.controlSize = strip.controlSize
    popup.font = strip.font
    popup.target = self
    popup.action = #selector(selectPopup(_:))
    popup.isHidden = true
    popup.setAccessibilityLabel(title)
    self.popup = popup
    updatePopupItems(popup)
    synchronizePopupSelection(popup)
    addSubview(popup)
    return popup
  }

  private func updatePopupItems(_ popup: NSPopUpButton) {
    let menu = popup.menu ?? NSMenu()
    menu.autoenablesItems = false
    menu.removeAllItems()
    for item in items {
      let entry = NSMenuItem(title: "\(item.title) (\(item.count))", action: nil, keyEquivalent: "")
      entry.representedObject = item.key
      entry.image = item.image
      menu.addItem(entry)
    }
    if popup.menu !== menu { popup.menu = menu }
  }

  private func synchronizePopupSelection(_ popup: NSPopUpButton) {
    let index = items.firstIndex { $0.key == selectedKey } ?? -1
    if popup.indexOfSelectedItem != index { popup.selectItem(at: index) }
    let tip = index >= 0 ? "\(items[index].title) (\(items[index].count))" : title
    if popup.toolTip != tip { popup.toolTip = tip }
  }

  private func choose(_ key: String) {
    guard items.contains(where: { $0.key == key }) else { return }
    let selectionChanged = selectedKey != key
    selectedKey = key
    if segmented == false, selectionChanged {
      invalidateIntrinsicContentSize()
      needsLayout = true
    }
    if strip.selectedKey != key { strip.update(items: items, selection: key, title: title) }
    if let popup { synchronizePopupSelection(popup) }
    onSelection?(key)
  }

  @objc private func selectPopup(_ sender: NSPopUpButton) {
    guard let key = sender.selectedItem?.representedObject as? String else { return }
    choose(key)
  }
}
