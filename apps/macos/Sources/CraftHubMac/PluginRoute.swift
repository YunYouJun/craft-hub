import Foundation

/// A local workbench detail route. Decode each segment separately so scoped package names stay intact.
struct PluginRoute: Equatable {
  let source: String
  let package: String

  init?(path: String) {
    let parts = path.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 5, parts[0].isEmpty, parts[1] == "marketplace", parts[2] == "plugins",
      !path.contains("?"), !path.contains("#"),
      let source = String(parts[3]).removingPercentEncoding,
      let package = String(parts[4]).removingPercentEncoding,
      !source.contains("/"),
      [source, package].allSatisfy({
        !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains("\\")
          && $0.rangeOfCharacter(from: .controlCharacters) == nil
      })
    else { return nil }
    self.source = source
    self.package = package
  }
}
