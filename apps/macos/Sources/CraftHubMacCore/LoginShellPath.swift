import Darwin
import Foundation

public enum LoginShellPathError: LocalizedError {
  case unsupportedShell, invalidHome, invalidOutput, noCompatibleNode
  public var errorDescription: String? {
    switch self {
    case .unsupportedShell: "Login PATH supports /bin/zsh and /bin/bash. Choose a Node executable for other shells."
    case .invalidHome: "The home directory is invalid."
    case .invalidOutput: "The login shell did not return a usable PATH."
    case .noCompatibleNode: "No compatible Node was found in the login PATH. Choose its executable directly."
    }
  }
}

/// Explicit bootstrap action only. Never invoke from launch discovery or a scheduled background task.
public enum LoginShellPath {
  public static var userShell: String {
    guard let user = getpwuid(getuid()), let shell = user.pointee.pw_shell else { return "" }
    return String(cString: shell)
  }

  /// Runs noninteractive login startup files once, with a five-second process-group deadline and 64 KiB output cap.
  public static func read(shell: String, home: String = NSHomeDirectory()) throws -> String {
    guard ["/bin/zsh", "/bin/bash"].contains(shell) else { throw LoginShellPathError.unsupportedShell }
    guard home.hasPrefix("/"), !home.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else {
      throw LoginShellPathError.invalidHome
    }
    let marker = "CRAFT_HUB_PATH_" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
    let script = "printf '\\0\(marker)\\0%s\\0' \"$PATH\""
    var environment = ["HOME": home, "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "SHELL": shell, "LANG": "C"]
    if shell == "/bin/zsh" { environment["ZDOTDIR"] = home }
    let data = try ExecutableProbe.run(
      path: shell, arguments: ["-l", "-c", script], timeout: 5, maximumOutput: 64 * 1024, environment: environment
    ).get()
    return try decode(data, marker: marker)
  }

  static func decode(_ data: Data, marker: String) throws -> String {
    let prefix = Data(("\0" + marker + "\0").utf8)
    guard let range = data.range(of: prefix), let end = data[range.upperBound...].firstIndex(of: 0),
      let raw = String(data: data[range.upperBound..<end], encoding: .utf8), raw.utf8.count <= 32 * 1024
    else {
      throw LoginShellPathError.invalidOutput
    }
    var seen = Set<String>()
    let directories = raw.split(separator: ":").map(String.init).filter {
      $0.hasPrefix("/") && !$0.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
        && seen.insert($0).inserted
    }
    guard !directories.isEmpty, directories.count <= 256 else { throw LoginShellPathError.invalidOutput }
    return directories.joined(separator: ":")
  }

  /// Apply the ordinary version/architecture checks, with an additional total search budget after reading PATH.
  public static func resolveNode(shell: String, home: String = NSHomeDirectory()) throws -> ResolvedNode {
    let path = try read(shell: shell, home: home)
    let deadline = ProcessInfo.processInfo.systemUptime + 10
    let locator = NodeLocator(
      home: home, environment: ["PATH": path],
      inspect: { executable in
        let remaining = deadline - ProcessInfo.processInfo.systemUptime
        guard remaining > 0, !Task.isCancelled else { return .failure(.timedOut) }
        return NodeRuntimeInfo.inspect(executable, timeout: min(3, remaining))
      })
    guard let node = locator.resolve(explicitPath: nil) else { throw LoginShellPathError.noCompatibleNode }
    return node
  }
}
