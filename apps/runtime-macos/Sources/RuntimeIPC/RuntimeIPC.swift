import Foundation
import ServiceManagement

/// Only bounded capture JSON crosses XPC. The broker supplies authenticated client identity.
@objc public protocol RuntimeBrokerProtocol {
  func request(_ json: String, withReply reply: @escaping (String) -> Void)
}

/// Registration belongs to the containing app; standalone developer binaries cannot install services.
@available(macOS 13.0, *)
public enum RuntimeServiceRegistration {
  public static func service(plistName: String) throws -> SMAppService {
    guard Bundle.main.bundleURL.pathExtension == "app",
      plistName.hasSuffix(".plist"), !plistName.contains("/"), !plistName.contains("..")
    else {
      throw NSError(
        domain: "CraftHubRuntime", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "A packaged app and bundled agent plist are required"])
    }
    return SMAppService.agent(plistName: plistName)
  }
}

/// Shared diagnostic framing, deliberately excluding credentials and provider exception text.
public func runtimeFailure(_ message: String) -> String {
  let data = try! JSONSerialization.data(withJSONObject: ["ok": false, "error": message], options: [.sortedKeys])
  return String(decoding: data, as: UTF8.self)
}

/// Reject oversized or unrelated messages before activating Node.
public func isCaptureMessage(_ json: String) -> Bool {
  guard json.utf8.count <= 300_000, let data = json.data(using: .utf8),
    let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
    let method = request["method"] as? String
  else { return false }
  return ["hello", "doctor", "capture.targets", "capture.prepare", "capture.commit", "capture.receipt"].contains(method)
}
