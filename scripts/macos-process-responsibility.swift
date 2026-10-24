import Darwin
import Foundation

// Read-only benchmark helper, never shipped in either application. This optional macOS SPI is also used by
// Chromium's process_info_mac.mm. Absence or rejection produces unknown attribution, never a guessed owner.
typealias ResponsiblePID = @convention(c) (pid_t) -> pid_t
struct ProcessOwner: Codable {
  let pid: Int32
  let responsiblePID: Int32?
}
struct Report: Codable {
  let available: Bool
  let processes: [ProcessOwner]
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count <= 256,
  arguments.allSatisfy({ value in Int32(value).map { $0 > 0 } ?? false })
else { exit(64) }
let handle = dlopen(nil, RTLD_LAZY)
defer { if let handle { dlclose(handle) } }
let symbol = handle.flatMap { dlsym($0, "responsibility_get_pid_responsible_for_pid") }
let resolve = symbol.map { unsafeBitCast($0, to: ResponsiblePID.self) }
let report = Report(
  available: resolve != nil,
  processes: arguments.compactMap { value in
    guard let pid = Int32(value) else { return nil }
    let owner = resolve?(pid)
    return ProcessOwner(pid: pid, responsiblePID: owner.flatMap { $0 > 0 ? $0 : nil })
  })
FileHandle.standardOutput.write(try JSONEncoder().encode(report))
