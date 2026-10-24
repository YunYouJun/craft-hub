import CoreGraphics
import Foundation
import Testing

@testable import CraftHubMacCore

@Test func restoringToARemovedDisplayKeepsTheWholeWindowAccessible() {
  let display = CGRect(x: 0, y: 30, width: 1440, height: 850)
  let geometry = WindowGeometry(CGRect(x: 2100, y: 50, width: 1600, height: 1000))
  #expect(geometry.restored(on: [display]) == display)
}

@Test func restoringAnExternalDisplayKeepsItsNegativeCoordinateSpaceAndClampsEdges() {
  let main = CGRect(x: 0, y: 30, width: 1440, height: 850)
  let external = CGRect(x: -1920, y: 30, width: 1920, height: 1000)
  let saved = CGRect(x: -1900, y: 100, width: 1200, height: 800)
  #expect(WindowGeometry(saved).restored(on: [main, external]) == saved)
  let frame = WindowGeometry(CGRect(x: -2100, y: 900, width: 1200, height: 800)).restored(on: [main, external])
  #expect(frame == CGRect(x: -1920, y: 230, width: 1200, height: 800))
}

@Test func corruptWindowGeometryIsIgnoredAndSmallDisplaysDoNotProduceOffscreenFrames() {
  let small = CGRect(x: 0, y: 0, width: 800, height: 600)
  #expect(WindowGeometry(CGRect(x: 0, y: 0, width: 100, height: 100)).restored(on: [small]) == small)
  #expect(WindowGeometry(CGRect(x: 0, y: 0, width: 100, height: 100)).restored(on: []) == nil)
  #expect(WindowGeometry(CGRect(x: Double.nan, y: 0, width: 100, height: 100)).restored(on: [small]) == nil)
}
