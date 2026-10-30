import AppKit
import Testing

@testable import CraftHubMac

@Suite(.serialized) @MainActor struct SourceBadgeContrastTests {
  private func luminance(_ color: NSColor) throws -> CGFloat {
    let rgb = try #require(color.usingColorSpace(.deviceRGB))
    func linear(_ value: CGFloat) -> CGFloat {
      value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * linear(rgb.redComponent) + 0.7152 * linear(rgb.greenComponent) + 0.0722 * linear(rgb.blueComponent)
  }

  private func composite(_ foreground: NSColor, over background: NSColor) throws -> NSColor {
    let f = try #require(foreground.usingColorSpace(.deviceRGB))
    let b = try #require(background.usingColorSpace(.deviceRGB))
    let a = f.alphaComponent
    return NSColor(
      deviceRed: f.redComponent * a + b.redComponent * (1 - a),
      green: f.greenComponent * a + b.greenComponent * (1 - a),
      blue: f.blueComponent * a + b.blueComponent * (1 - a), alpha: 1)
  }

  @Test func selectedBadgeRemainsReadableOverActiveBlueAndInactiveBezels() throws {
    for name in [NSAppearance.Name.aqua, .darkAqua] {
      let appearance = try #require(NSAppearance(named: name))
      var result: Result<Void, Error>?
      appearance.performAsCurrentDrawingAppearance {
        result = Result {
          let selector = WorkSourceControlView()
          selector.appearance = appearance
          selector.update(
            items: [.init(key: "first", title: "Personal Tasks", count: 320, image: nil)],
            selection: "first", title: "Work Source", segmented: true)
          let badge = try #require(
            selector.subviews.compactMap { $0 as? NSImageView }.first {
              $0.identifier?.rawValue == "source-count-first"
            })
          let bitmap = try #require(badge.image?.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:)))
          let fill = try #require(bitmap.colorAt(x: 2, y: bitmap.pixelsHigh / 2))
          var ink: NSColor?
          var brightest: CGFloat = -1
          for y in 0..<bitmap.pixelsHigh {
            for x in 0..<bitmap.pixelsWide {
              if let pixel = bitmap.colorAt(x: x, y: y), pixel.alphaComponent >= 0.99 {
                let value = try luminance(pixel)
                if value > brightest {
                  brightest = value
                  ink = pixel
                }
              }
            }
          }
          let text = try #require(ink)
          for bezel in [
            NSColor(deviceRed: 0, green: 0.478, blue: 1, alpha: 1),
            NSColor(white: 0.8, alpha: 1), NSColor(white: 0.25, alpha: 1), NSColor.white,
          ] {
            let foreground = try luminance(composite(text, over: bezel))
            let background = try luminance(composite(fill, over: bezel))
            let contrast = (max(foreground, background) + 0.05) / (min(foreground, background) + 0.05)
            #expect(contrast >= 4.5, "Selected badge contrast in \(name.rawValue): \(contrast)")
          }
        }
      }
      try #require(result).get()
    }
  }
}
