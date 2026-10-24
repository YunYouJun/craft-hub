import Foundation

/// Only normalized public origins cross into the child environment. Account credentials never belong here.
public struct NativeCloudConfiguration: Equatable, Sendable {
  public let endpoint: URL
  public let webOrigin: URL
  public static func resolve(_ environment: [String: String]) throws -> Self? {
    let endpoint = environment["CRAFT_HUB_CLOUD_ENDPOINT"] ?? ""
    let origin = environment["CRAFT_HUB_CLOUD_ORIGIN"] ?? ""
    if endpoint.isEmpty && origin.isEmpty { return nil }
    func parse(_ value: String) throws -> URL {
      guard value.range(of: #"^https?://[^/?#\\\s]+/?$"#, options: .regularExpression) != nil,
        let url = URL(string: value), let canonical = URL(string: try KeychainDeviceVault.origin(url))
      else { throw DeviceVaultError.invalidScope }
      return canonical
    }
    return try Self(endpoint: parse(endpoint), webOrigin: parse(origin))
  }
}
