import CoreGraphics
import Foundation

/// Profile-local normal window geometry. Display IDs are intentionally absent because displays may disappear.
public struct WindowGeometry: Codable, Equatable, Sendable {
  public let x: Double
  public let y: Double
  public let width: Double
  public let height: Double
  public init(_ frame: CGRect) {
    x = frame.minX
    y = frame.minY
    width = frame.width
    height = frame.height
  }
  public var frame: CGRect { CGRect(x: x, y: y, width: width, height: height) }

  /// Keep the restored window on a current visible display, including negative origins and smaller replacements.
  public func restored(on screens: [CGRect], minimum: CGSize = CGSize(width: 900, height: 620)) -> CGRect? {
    guard [x, y, width, height].allSatisfy(\.isFinite), width > 0, height > 0 else { return nil }
    let screens = screens.filter { !$0.isEmpty && [$0.minX, $0.minY, $0.width, $0.height].allSatisfy(\.isFinite) }
    guard let fallback = screens.first else { return nil }
    let overlapping = screens.filter { frame.intersects($0) }.max { left, right in
      let a = frame.intersection(left)
      let b = frame.intersection(right)
      return a.width * a.height < b.width * b.height
    }
    let display = overlapping ?? fallback
    let size = CGSize(
      width: min(max(width, minimum.width), display.width), height: min(max(height, minimum.height), display.height))
    let origin =
      overlapping == nil
      ? CGPoint(x: display.midX - size.width / 2, y: display.midY - size.height / 2)
      : CGPoint(
        x: min(max(x, display.minX), display.maxX - size.width),
        y: min(max(y, display.minY), display.maxY - size.height))
    return CGRect(origin: origin, size: size)
  }
}
