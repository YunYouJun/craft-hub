import CraftHubMacCore
import Foundation

/// Read a small, inert HTML head when a website does not serve the conventional favicon path.
enum WebsiteIconMetadata {
  static func candidates(in data: Data, baseURL: URL) -> [URL] {
    var html = String(decoding: data.prefix(256 * 1024), as: UTF8.self)
    for pattern in [#"(?is)<!--.*?-->"#, #"(?is)<script\b.*?</script\s*>"#, #"(?is)<style\b.*?</style\s*>"#] {
      html = html.replacingOccurrences(of: pattern, with: "", options: [.regularExpression, .caseInsensitive])
    }
    if let end = html.range(of: "</head>", options: .caseInsensitive) { html = String(html[..<end.lowerBound]) }
    guard let tags = try? NSRegularExpression(pattern: #"(?is)<link\b[^>]*>"#),
      let attributes = try? NSRegularExpression(
        pattern: #"(?is)([a-z_:][-a-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))"#)
    else { return [] }
    var result: [URL] = []
    for match in tags.matches(in: html, range: NSRange(html.startIndex..., in: html)) {
      guard let range = Range(match.range, in: html) else { continue }
      let tag = String(html[range])
      var values: [String: String] = [:]
      for attribute in attributes.matches(in: tag, range: NSRange(tag.startIndex..., in: tag)) {
        guard let key = Range(attribute.range(at: 1), in: tag),
          let value = (2...4).compactMap({ Range(attribute.range(at: $0), in: tag) }).first
        else { continue }
        values[String(tag[key]).lowercased()] = String(tag[value])
      }
      let relations = (values["rel"] ?? "").lowercased().split(whereSeparator: \.isWhitespace)
      guard relations.contains("icon") || relations.contains("apple-touch-icon"),
        let href = values["href"], href.utf8.count <= 2048,
        let url = URL(string: href.replacingOccurrences(of: "&amp;", with: "&"), relativeTo: baseURL)?.absoluteURL,
        !SoftwareArtwork(website: "", iconURL: url.absoluteString).sources.isEmpty,
        !result.contains(url)
      else { continue }
      result.append(url)
      if result.count == 3 { break }
    }
    return result
  }
}
