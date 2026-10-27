import AppKit

/// Decode bounded, provider-supplied image data locally, with the same formats accepted by the web icon view.
@MainActor enum InlineIconArtwork {
  static func image(_ value: String?) -> NSImage? {
    guard let value, value.utf8.count <= 512 * 1024, let separator = value.firstIndex(of: ",") else { return nil }
    let types = ["png", "jpeg", "gif", "webp", "avif", "svg+xml"]
    guard types.contains(where: { value[..<separator] == "data:image/\($0);base64" }),
      let data = Data(base64Encoded: String(value[value.index(after: separator)...])),
      let image = NSImage(data: data), image.isValid
    else { return nil }
    return image
  }
}
