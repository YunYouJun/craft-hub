import Foundation

/// Start the actual bundled sidecar in disposable state, then close its parent pipe and require a clean exit.
/// The outer fixed-argv probe owns and reaps the entire process group on timeout or cancellation.
public enum PrivateNodePreflight {
  public static func validate(node: ResolvedNode, backend: URL, temporaryDirectory: URL) throws {
    guard backend.isFileURL, FileManager.default.isReadableFile(atPath: backend.path) else {
      throw PrivateNodeError.startupFailed
    }
    try FileManager.default.createDirectory(
      at: temporaryDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    let script = """
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, [process.argv[1]], { stdio: ['pipe', 'pipe', 'ignore'], env: process.env });
      let received = '', ready = false;
      child.on('error', () => process.exit(1));
      child.stdout.on('data', chunk => {
        if (ready) return;
        received += chunk.toString('utf8');
        if (Buffer.byteLength(received) > 16384) process.exit(1);
        const end = received.indexOf('\\n');
        if (end < 0) return;
        ready = true;
        process.stdout.write(received.slice(0, end));
        child.stdin.end();
      });
      child.on('exit', code => process.exit(ready && code === 0 ? 0 : 1));
      """
    let result = ExecutableProbe.run(
      path: node.path, arguments: ["--eval", script, backend.path], timeout: 35, maximumOutput: 16 * 1024,
      environment: [
        "HOME": temporaryDirectory.path,
        "PATH": URL(fileURLWithPath: node.path).deletingLastPathComponent().path + ":/usr/bin:/bin:/usr/sbin:/sbin",
        "LANG": "C", "CRAFT_HUB_SIDECAR_DIR": temporaryDirectory.appendingPathComponent("profile").path,
      ])
    guard case .success(let handshake) = result, (try? RuntimeConnection(handshake: handshake)) != nil else {
      throw PrivateNodeError.startupFailed
    }
  }
}
