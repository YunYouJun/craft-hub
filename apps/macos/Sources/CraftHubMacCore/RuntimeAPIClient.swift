import Foundation

/// A small native client for public runtime contracts. Trust, discovery and application launch stay in the runtime.
public final class RuntimeAPIClient {
  private struct Failure: Decodable { let error: String }
  public typealias Transport = (URLRequest) async throws -> (Data, URLResponse)
  private let connection: RuntimeConnection
  private let transport: Transport
  private let session: URLSession?

  /// An injectable transport permits deterministic contract tests without a running sidecar.
  public init(connection: RuntimeConnection, transport: Transport? = nil) {
    self.connection = connection
    if let transport {
      session = nil
      self.transport = transport
    } else {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.httpCookieStorage = nil
      configuration.urlCache = nil
      let session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
      self.session = session
      self.transport = { try await session.data(for: $0) }
    }
  }

  deinit { session?.invalidateAndCancel() }

  public func environment() async throws -> EnvironmentSnapshot {
    let result: EnvironmentSnapshot = try await fetch(path: "/api/environment")
    guard result.schemaVersion == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return result
  }

  public func software() async throws -> SoftwareSnapshot {
    let result: SoftwareSnapshot = try await fetch(path: "/api/software")
    guard result.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return result
  }

  /// Selects catalog IDs only; the runtime validates current detection and provider capability again before opening.
  public func openApplication(sourceID: String, softwareID: String) async throws {
    struct Acknowledgement: Decodable { let version: Int; let softwareId: String; let destination: String }
    // Encode one URL segment. Slashes, percent escapes and dot segments can never change the endpoint.
    guard !sourceID.isEmpty, sourceID != ".", sourceID != "..",
          let source = sourceID.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else {
      throw RuntimeAPIError.invalidEndpoint
    }
    let body = try JSONEncoder().encode(["softwareId": softwareID])
    let result: Acknowledgement = try await fetch(path: "/api/software/\(source)/open", body: body)
    guard result.version == 1, result.softwareId == softwareID, result.destination == "application" else {
      throw RuntimeAPIError.invalidResponse
    }
  }

  func fetch<Value: Decodable>(path: String, body: Data? = nil, timeout: TimeInterval = 30, query: [URLQueryItem] = []) async throws -> Value {
    var request = try connection.request(path: path, body: body, query: query)
    request.timeoutInterval = timeout
    let (data, response) = try await transport(request)
    guard let response = response as? HTTPURLResponse, response.url == request.url else {
      throw RuntimeAPIError.invalidResponse
    }
    guard (200..<300).contains(response.statusCode) else {
      let message = (try? JSONDecoder().decode(Failure.self, from: data).error) ?? "Runtime request failed"
      throw RuntimeAPIError.rejected(response.statusCode, String(message.prefix(500)))
    }
    return try JSONDecoder().decode(Value.self, from: data)
  }
}

/// Even a same-origin redirect is unexpected for API endpoints. Never send the bearer credential onward.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}
