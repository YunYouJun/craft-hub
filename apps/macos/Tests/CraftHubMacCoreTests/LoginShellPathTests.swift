import Foundation
import Testing

@testable import CraftHubMacCore

@Test func loginPathIgnoresStartupChatterAndRelativeEntries() throws {
  let data = Data("startup chatter\n\0MARKER\0/first:relative::/with spaces:/first:/last\0trailing text".utf8)
  #expect(try LoginShellPath.decode(data, marker: "MARKER") == "/first:/with spaces:/last")
  for data in [Data("/usr/bin".utf8), Data("\0MARKER\0relative\0".utf8), Data("\0MARKER\0/usr/bin".utf8)] {
    #expect(throws: LoginShellPathError.self) { try LoginShellPath.decode(data, marker: "MARKER") }
  }
}

@Test func loginPathRunsOnlySupportedNoninteractiveLoginFilesInTheChosenHome() throws {
  let home = FileManager.default.temporaryDirectory.appendingPathComponent("craft-hub-login-path-\(UUID())")
  try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: home) }
  let startup = """
    case "$-" in *i*) exit 12;; esac
    [ -z "$NODE_OPTIONS$NODE_PATH" ] || exit 13
    printf 'startup chatter\\n'
    export PATH='/fixture/node bin:/usr/bin:/bin'
    """
  for name in [".zprofile", ".bash_profile"] { try Data(startup.utf8).write(to: home.appendingPathComponent(name)) }
  try Data("exit 99".utf8).write(to: home.appendingPathComponent(".zshrc"))
  for shell in ["/bin/zsh", "/bin/bash"] {
    #expect(try LoginShellPath.read(shell: shell, home: home.path) == "/fixture/node bin:/usr/bin:/bin")
  }
  #expect(throws: LoginShellPathError.self) { try LoginShellPath.read(shell: "/bin/fish", home: home.path) }
  #expect(throws: LoginShellPathError.self) { try LoginShellPath.read(shell: "/bin/zsh", home: "relative") }
}
