import Foundation

/// One bounded HTTPS transfer. Download URLs are release-owned; redirects and non-200 responses are rejected.
final class PrivateNodeDownload: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
  private let destination: URL
  private let source: URL
  private let limit: Int64
  private let progress: @Sendable (Int64, Int64?) -> Void
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Void, Error>?
  private var task: URLSessionDownloadTask?
  private var session: URLSession?
  private var cancelled = false
  private var failure: Error?
  private var copied = false

  init(source: URL, destination: URL, limit: Int64, progress: @escaping @Sendable (Int64, Int64?) -> Void) {
    self.source = source
    self.destination = destination
    self.limit = limit
    self.progress = progress
  }
  func run() async throws {
    try Task.checkCancellation()
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        lock.lock()
        if cancelled {
          lock.unlock()
          continuation.resume(throwing: CancellationError())
          return
        }
        self.continuation = continuation
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 180
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        self.session = session
        let task = session.downloadTask(with: source)
        self.task = task
        lock.unlock()
        task.resume()
      }
    } onCancel: {
      self.cancel()
    }
  }
  private func cancel() {
    lock.lock()
    cancelled = true
    let task = task
    lock.unlock()
    task?.cancel()
  }
  func urlSession(
    _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    if totalBytesWritten > limit || totalBytesExpectedToWrite > limit {
      failure = PrivateNodeError.downloadTooLarge
      downloadTask.cancel()
      return
    }
    progress(totalBytesWritten, totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : nil)
  }
  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    guard failure == nil else { return }
    guard let response = downloadTask.response as? HTTPURLResponse, response.statusCode == 200, response.url == source
    else {
      failure = PrivateNodeError.downloadFailed
      return
    }
    do {
      let size = try location.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
      guard size > 0, size <= limit else { throw PrivateNodeError.downloadTooLarge }
      try FileManager.default.copyItem(at: location, to: destination)
      copied = true
    } catch { failure = error }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    lock.lock()
    let continuation = continuation
    self.continuation = nil
    self.task = nil
    self.session = nil
    let wasCancelled = cancelled
    lock.unlock()
    session.finishTasksAndInvalidate()
    if wasCancelled {
      continuation?.resume(throwing: CancellationError())
    } else if let error = failure ?? error {
      continuation?.resume(throwing: error)
    } else if copied {
      continuation?.resume()
    } else {
      continuation?.resume(throwing: PrivateNodeError.downloadFailed)
    }
  }
}
