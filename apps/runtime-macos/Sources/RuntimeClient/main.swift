import Darwin
import Foundation
import RuntimeIPC
import ServiceManagement

func output(_ value: String) {
  FileHandle.standardOutput.write(Data((value + "\n").utf8))
}

let args = Array(CommandLine.arguments.dropFirst())
if args.count == 2, ["register", "unregister", "status"].contains(args[0]) {
  do {
    let service = try RuntimeServiceRegistration.service(plistName: args[1])
    if args[0] == "register" { try service.register() }
    if args[0] == "unregister" {
      let group = DispatchGroup()
      var unregisterError: Error?
      group.enter()
      Task {
        do { try await service.unregister() } catch { unregisterError = error }
        group.leave()
      }
      group.wait()
      if let unregisterError { throw unregisterError }
    }
    output("{\"status\":\(service.status.rawValue)}")
  } catch {
    output(runtimeFailure("Packaged service registration unavailable"))
    exit(1)
  }
  exit(0)
}

guard args.count == 4, args[0] == "call", args[1].hasPrefix("dev.craft-hub.fixture."), isCaptureMessage(args[3]) else {
  output(runtimeFailure("Expected call, fixture service, server signing requirement and capture JSON"))
  exit(1)
}
let connection = NSXPCConnection(machServiceName: args[1])
connection.setCodeSigningRequirement(args[2])
connection.remoteObjectInterface = NSXPCInterface(with: RuntimeBrokerProtocol.self)
let completed = DispatchSemaphore(value: 0)
let lock = NSLock()
var response: String?
func finish(_ value: String) {
  lock.lock()
  defer { lock.unlock() }
  if response == nil {
    response = value
    completed.signal()
  }
}
connection.invalidationHandler = { finish(runtimeFailure("XPC connection unavailable or peer rejected")) }
connection.resume()
let proxy =
  connection.remoteObjectProxyWithErrorHandler { _ in
    finish(runtimeFailure("XPC connection unavailable or peer rejected"))
  } as? RuntimeBrokerProtocol
proxy?.request(args[3]) { finish($0) }
let timedOut = completed.wait(timeout: .now() + 40) == .timedOut
lock.lock()
let result = response ?? runtimeFailure("XPC request deadline exceeded; delivery may be uncertain")
lock.unlock()
output(result)
connection.invalidate()
exit(timedOut ? 2 : 0)
