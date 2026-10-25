import AppKit
import SwiftUI

/// Offline artwork from the web client's SVG Logos collection (CC0), with native symbols for unbranded tools.
struct EnvironmentToolIconView: View {
  let toolID: String
  var size: CGFloat = 32

  private static let images: [String: NSImage] = {
    let names = ["git", "node", "npm", "pnpm", "homebrew"]
    return Dictionary(
      uniqueKeysWithValues: names.compactMap { name in
        guard let url = Bundle.module.url(forResource: name, withExtension: "svg", subdirectory: "EnvironmentTools"),
          let image = NSImage(contentsOf: url), image.isValid
        else { return nil }
        return (name, image)
      })
  }()

  private var symbol: String {
    switch toolID {
    case "fnm": "terminal"
    case "workstation": "square.grid.2x2"
    default: "wrench.and.screwdriver"
    }
  }

  var body: some View {
    ZStack {
      if let image = Self.images[toolID] {
        Image(nsImage: image).renderingMode(.original).resizable().scaledToFit()
          .padding(size * 0.08)
      } else {
        RoundedRectangle(cornerRadius: size * 0.22).fill(.quaternary)
        Image(systemName: symbol).font(.system(size: size * 0.52))
          .foregroundStyle(toolID == "fnm" ? Color.indigo : Color.accentColor)
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}
