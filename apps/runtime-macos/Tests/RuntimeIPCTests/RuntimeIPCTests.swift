import Foundation
import RuntimeIPC
import XCTest

final class RuntimeIPCTests: XCTestCase {
  func testOnlyCaptureMethodsCanActivateWorker() {
    XCTAssertTrue(isCaptureMessage("{\"method\":\"hello\",\"protocol\":1}"))
    XCTAssertTrue(isCaptureMessage("{\"method\":\"capture.commit\"}"))
    XCTAssertFalse(isCaptureMessage("{\"method\":\"shell.exec\"}"))
    XCTAssertFalse(isCaptureMessage("[]"))
    XCTAssertFalse(isCaptureMessage(String(repeating: "a", count: 300_001)))
  }

  func testUnpackagedBinariesCannotRegisterBackgroundItems() {
    XCTAssertThrowsError(try RuntimeServiceRegistration.service(plistName: "runtime.plist"))
    XCTAssertThrowsError(try RuntimeServiceRegistration.service(plistName: "../runtime.plist"))
  }
}
