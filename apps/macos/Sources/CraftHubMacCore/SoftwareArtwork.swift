import Foundation

/// Display-only artwork from the public catalog contract, followed by the website's own favicon.
public struct SoftwareArtwork: Hashable, Sendable {
  public struct Source: Hashable, Sendable {
    public let url: URL
    public let rounded: Bool
    public let scale: Double
  }
  public let sources: [Source]

  public init(
    website: String, iconURL: String? = nil, macosIconURL: String? = nil, style: String? = nil, scale: Double? = nil
  ) {
    let scale = scale.flatMap { $0.isFinite && (0.5...1.5).contains($0) ? $0 : nil } ?? 1
    var sources: [Source] = []
    if let url = Self.imageURL(macosIconURL) {
      sources.append(Source(url: url, rounded: false, scale: scale))
    }
    if let url = Self.imageURL(iconURL), !sources.contains(where: { $0.url == url }) {
      sources.append(Source(url: url, rounded: style == "rounded", scale: scale))
    }
    if let url = Self.imageURL(website), var origin = URLComponents(url: url, resolvingAgainstBaseURL: false) {
      origin.path = "/favicon.ico"
      origin.query = nil
      origin.fragment = nil
      if let favicon = origin.url, !sources.contains(where: { $0.url == favicon }) {
        sources.append(Source(url: favicon, rounded: false, scale: 1))
      }
    }
    self.sources = sources
  }

  private static func imageURL(_ value: String?) -> URL? {
    guard let value,
      !value.unicodeScalars.contains(where: {
        CharacterSet.whitespacesAndNewlines.contains($0) || CharacterSet.controlCharacters.contains($0)
      }),
      let url = URL(string: value), url.scheme?.lowercased() == "https", url.host?.isEmpty == false,
      url.user == nil, url.password == nil
    else { return nil }
    return url
  }
}
