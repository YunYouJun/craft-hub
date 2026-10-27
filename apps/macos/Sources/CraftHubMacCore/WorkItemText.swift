import Foundation

/// Render provider descriptions as inert text without invoking a web view or fetching embedded resources.
public enum WorkItemText {
  public static func plainDescription(_ html: String) -> String {
    var text = replacing(html, #"(?s)<!--.*?(?:-->|\z)"#, with: "")
    text = replacing(
      text, #"(?is)<(script|style|template|noscript|iframe|object|svg)\b[^>]*>(?:.*?</\1\s*>|.*\z)"#, with: "")
    text = replacing(text, #"(?i)<(?:br\s*/?|/(?:p|div|li|h[1-6]|tr|section))\s*>"#, with: "\n")
    text = replacing(text, #"(?s)<(?:"[^"]*"|'[^']*'|[^'">])*>"#, with: "")
    let entities = [
      "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ",
      "ndash": "–", "mdash": "—", "hellip": "…", "bull": "•", "copy": "©", "reg": "®",
    ]
    if let regex = try? NSRegularExpression(pattern: #"&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|[A-Za-z]+);"#) {
      for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
        guard let whole = Range(match.range, in: text), let nameRange = Range(match.range(at: 1), in: text) else {
          continue
        }
        let name = String(text[nameRange])
        let replacement: String?
        if name.hasPrefix("#") {
          let hex = name.lowercased().hasPrefix("#x")
          let number = UInt32(name.dropFirst(hex ? 2 : 1), radix: hex ? 16 : 10)
          replacement = number.flatMap(Unicode.Scalar.init).map(String.init)
        } else {
          replacement = entities[name]
        }
        if let replacement { text.replaceSubrange(whole, with: replacement) }
      }
    }
    text = replacing(text, #"[\t \u00a0]+\n"#, with: "\n")
    text = replacing(text, #"\n{3,}"#, with: "\n\n")
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func replacing(_ text: String, _ pattern: String, with replacement: String) -> String {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
    return regex.stringByReplacingMatches(
      in: text, range: NSRange(text.startIndex..., in: text), withTemplate: replacement)
  }
}
