import AppKit
import SwiftUI

/// A narrow responder bridge: arrow/return shortcuts defer to the input method while text is marked.
struct PaletteSearchField: NSViewRepresentable {
  @Binding var text: String
  let placeholder: String
  let focus: UUID
  let move: (Int) -> Void
  let submit: () -> Void
  let dismiss: () -> Void

  func makeCoordinator() -> Coordinator { Coordinator(self) }
  func makeNSView(context: Context) -> NSTextField {
    let field = NSTextField()
    field.delegate = context.coordinator
    field.font = .systemFont(ofSize: 20)
    field.isBezeled = false
    field.isBordered = false
    field.drawsBackground = false
    field.usesSingleLineMode = true
    field.cell?.isScrollable = true
    field.focusRingType = .none
    field.setAccessibilityIdentifier("palette.search")
    field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    return field
  }
  func updateNSView(_ field: NSTextField, context: Context) {
    let coordinator = context.coordinator
    coordinator.parent = self
    field.placeholderAttributedString = NSAttributedString(
      string: placeholder,
      attributes: [
        .font: NSFont.systemFont(ofSize: 20), .foregroundColor: NSColor.placeholderTextColor,
      ])
    field.setAccessibilityLabel(placeholder)
    if field.stringValue != text, (field.currentEditor() as? NSTextView)?.hasMarkedText() != true {
      field.stringValue = text
    }
    if coordinator.lastFocus != focus {
      coordinator.lastFocus = focus
      DispatchQueue.main.async { [weak field, weak coordinator] in
        guard let field, coordinator?.lastFocus == focus else { return }
        field.window?.makeFirstResponder(field)
      }
    }
  }
  @MainActor final class Coordinator: NSObject, NSTextFieldDelegate {
    var parent: PaletteSearchField
    var lastFocus: UUID?
    init(_ parent: PaletteSearchField) { self.parent = parent }
    func controlTextDidChange(_ notification: Notification) {
      if let field = notification.object as? NSTextField { parent.text = field.stringValue }
    }
    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
      guard !textView.hasMarkedText() else { return false }
      switch NSStringFromSelector(selector) {
      case "moveDown:": parent.move(1)
      case "moveUp:": parent.move(-1)
      case "insertNewline:": parent.submit()
      case "cancelOperation:": parent.dismiss()
      default: return false
      }
      return true
    }
  }
}
