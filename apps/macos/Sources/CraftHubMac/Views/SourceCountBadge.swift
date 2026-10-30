import AppKit

/// Single and double digits form a circle; longer counts grow into a capsule.
@MainActor enum SourceCountBadge {
  private static let font = NSFont.monospacedDigitSystemFont(ofSize: 9, weight: .semibold)
  private static let selectedBackground = NSColor(srgbRed: 0, green: 87.0 / 255, blue: 200.0 / 255, alpha: 1)

  static func size(count: Int) -> NSSize {
    let text = String(count) as NSString
    return NSSize(width: max(17, ceil(text.size(withAttributes: [.font: font]).width) + 4), height: 17)
  }

  static func image(count: Int, selected: Bool) -> NSImage {
    // Own both colors so the badge stays readable over active blue and inactive gray bezels.
    let foreground = selected ? NSColor.white : .secondaryLabelColor
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: foreground]
    let text = String(count) as NSString
    let textSize = text.size(withAttributes: attributes)
    let size = size(count: count)
    return NSImage(size: size, flipped: false) { rect in
      let background = selected ? selectedBackground : NSColor.labelColor.withAlphaComponent(0.1)
      background.setFill()
      NSBezierPath(roundedRect: rect, xRadius: size.height / 2, yRadius: size.height / 2).fill()
      text.draw(
        at: NSPoint(x: (rect.width - textSize.width) / 2, y: (rect.height - textSize.height) / 2),
        withAttributes: attributes)
      return true
    }
  }
}
