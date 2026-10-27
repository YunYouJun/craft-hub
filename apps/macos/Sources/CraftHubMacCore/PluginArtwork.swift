import Foundation

/// Identifies a declared package icon without exposing its local filesystem path.
public struct PluginIconReference: Hashable, Sendable {
  public let sourceID: String
  public let package: String
  public let version: String?

  public init(sourceID: String, package: String, version: String? = nil) {
    self.sourceID = sourceID
    self.package = package
    self.version = version
  }
}

/// Display-only artwork shared by plugin rows and contribution sources. The runtime owns package resolution.
public struct PluginArtwork: Hashable, Sendable {
  public enum Source: Hashable, Sendable {
    case inline(String)
    case remote(URL)
    case package(PluginIconReference)
  }
  public let source: Source?

  public init(icon: String?, sourceID: String? = nil, package: String? = nil, version: String? = nil) {
    guard let icon, !icon.isEmpty else {
      source = nil
      return
    }
    if icon.hasPrefix("data:image/") {
      source = icon.utf8.count <= 512 * 1024 ? .inline(icon) : nil
    } else if let remote = SoftwareArtwork(website: "", iconURL: icon).sources.first {
      source = .remote(remote.url)
    } else if !icon.contains(":"), !icon.hasPrefix("/"), !icon.hasPrefix("\\"),
      !icon.split(whereSeparator: { $0 == "/" || $0 == "\\" }).contains(".."),
      let sourceID, !sourceID.isEmpty, let package, !package.isEmpty
    {
      source = .package(.init(sourceID: sourceID, package: package, version: version))
    } else {
      source = nil
    }
  }
}
