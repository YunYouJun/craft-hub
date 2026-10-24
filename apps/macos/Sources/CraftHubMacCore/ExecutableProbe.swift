import Darwin
import Foundation

/// Failure to inspect a local tool. Probe output is never included in errors or logs.
public enum ExecutableProbeError: Error, Equatable, Sendable {
  case cancelled
  case invalidInput
  case launchFailed(Int32)
  case timedOut
  case outputLimit
  case unsuccessfulExit
  case invalidResponse
}

/// Runs a fixed argv command with bounded output and a monotonic deadline, without shell interpolation.
/// The child has a dedicated process group. Keep its PID reserved until group cleanup and reaping finish.
enum ExecutableProbe {
  static func run(
    path: String, arguments: [String], timeout: TimeInterval = 3,
    maximumOutput: Int = 4096, environment: [String: String] = ["PATH": "/usr/bin:/bin", "LANG": "C"]
  ) -> Result<Data, ExecutableProbeError> {
    guard path.hasPrefix("/"), !path.contains("\0"), arguments.allSatisfy({ !$0.contains("\0") }),
      timeout.isFinite, timeout > 0, maximumOutput > 0,
      environment.allSatisfy({
        !$0.key.isEmpty && !$0.key.contains("=") && !$0.key.contains("\0") && !$0.value.contains("\0")
      })
    else { return .failure(.invalidInput) }
    var descriptors: [Int32] = [0, 0]
    guard pipe(&descriptors) == 0 else { return .failure(.launchFailed(errno)) }
    let reader = descriptors[0]
    var writer = descriptors[1]
    defer {
      close(reader)
      if writer >= 0 { close(writer) }
    }
    guard fcntl(reader, F_SETFL, O_NONBLOCK) == 0 else { return .failure(.launchFailed(errno)) }
    var actions: posix_spawn_file_actions_t?
    var attributes: posix_spawnattr_t?
    let actionStatus = posix_spawn_file_actions_init(&actions)
    guard actionStatus == 0 else { return .failure(.launchFailed(actionStatus)) }
    defer { posix_spawn_file_actions_destroy(&actions) }
    let attributeStatus = posix_spawnattr_init(&attributes)
    guard attributeStatus == 0 else { return .failure(.launchFailed(attributeStatus)) }
    defer { posix_spawnattr_destroy(&attributes) }
    let setup = [
      posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0),
      posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0),
      posix_spawn_file_actions_adddup2(&actions, writer, STDOUT_FILENO),
      posix_spawn_file_actions_addclose(&actions, reader),
      posix_spawn_file_actions_addclose(&actions, writer),
      posix_spawnattr_setpgroup(&attributes, 0),
      posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT)),
    ]
    if let error = setup.first(where: { $0 != 0 }) { return .failure(.launchFailed(error)) }
    var pid: pid_t = 0
    let status = withStrings([path] + arguments) { argv in
      // Callers explicitly choose this environment. Node probing retains only PATH and LANG.
      withStrings(environment.keys.sorted().map { "\($0)=\(environment[$0]!)" }) { environment in
        posix_spawn(&pid, path, &actions, &attributes, argv, environment)
      }
    }
    guard status == 0 else { return .failure(.launchFailed(status)) }
    close(writer)
    writer = -1
    defer {
      // WNOWAIT below preserves ownership of the group ID, preventing PID reuse before this cleanup.
      kill(-pid, SIGKILL)
      var status: Int32 = 0
      while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
    }
    let deadline = ProcessInfo.processInfo.systemUptime + timeout
    var data = Data()
    var bytes = [UInt8](repeating: 0, count: min(maximumOutput + 1, 4096))
    var exited = false
    var succeeded = false
    while true {
      if Task.isCancelled { return .failure(.cancelled) }
      let count = read(reader, &bytes, bytes.count)
      if count > 0 {
        guard data.count + count <= maximumOutput else { return .failure(.outputLimit) }
        data.append(contentsOf: bytes.prefix(count))
        continue
      }
      if count < 0 && errno != EAGAIN && errno != EINTR { return .failure(.invalidResponse) }
      if exited { return succeeded ? .success(data) : .failure(.unsuccessfulExit) }
      var info = siginfo_t()
      let result = waitid(P_PID, id_t(pid), &info, WEXITED | WNOHANG | WNOWAIT)
      if result < 0 && errno != EINTR { return .failure(.unsuccessfulExit) }
      if info.si_pid == pid {
        exited = true
        succeeded = info.si_code == CLD_EXITED && info.si_status == 0
        continue  // Drain bytes already written without waiting for inherited pipe handles to close.
      }
      if ProcessInfo.processInfo.systemUptime >= deadline {
        kill(-pid, SIGTERM)
        // Give a cooperative probe a short grace period, then the defer kills and reaps the owned group.
        let grace = ProcessInfo.processInfo.systemUptime + 0.2
        repeat {
          var info = siginfo_t()
          _ = waitid(P_PID, id_t(pid), &info, WEXITED | WNOHANG | WNOWAIT)
          if info.si_pid == pid { break }
          usleep(10_000)
        } while ProcessInfo.processInfo.systemUptime < grace
        return .failure(.timedOut)
      }
      usleep(10_000)
    }
  }

  private static func withStrings<T>(
    _ strings: [String], _ body: (UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> T
  ) -> T {
    var pointers = strings.map { strdup($0) } + [nil]
    defer { for pointer in pointers { free(pointer) } }
    return pointers.withUnsafeMutableBufferPointer { body($0.baseAddress!) }
  }
}
