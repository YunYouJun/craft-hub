import Foundation

/// Versioned credentials received only through the sidecar's parent pipe. Never persist or log this value.
public struct RuntimeConnection: Equatable, Sendable {
  public let bootstrapURL: URL
  public let origin: URL
  private let token: String

  /// Rejects unsupported handshakes and any address outside the sidecar's IPv4 loopback origin.
  public init(handshake: Data) throws {
    struct Handshake: Decodable {
      let version: Int
      let url: URL
      let nativeApiToken: String
    }
    let value = try JSONDecoder().decode(Handshake.self, from: handshake)
    let url = value.url
    let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
    guard value.version == 1, url.scheme == "http", url.host == "127.0.0.1",
          let port = url.port, (1...65535).contains(port), url.user == nil, url.password == nil,
          url.path == "/__craft_hub_host/bootstrap", url.fragment == nil,
          parts?.queryItems?.count == 1, parts?.queryItems?.first?.name == "token",
          Self.isSecret(parts?.queryItems?.first?.value ?? ""), Self.isSecret(value.nativeApiToken) else {
      throw RuntimeAPIError.invalidHandshake
    }
    bootstrapURL = url
    origin = URL(string: "http://127.0.0.1:\(port)")!
    token = value.nativeApiToken
  }

  private static func isSecret(_ value: String) -> Bool {
    value.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
  }

  /// Builds only same-origin API requests; credentials cannot be forwarded to a web page or host route.
  func request(path: String, body: Data? = nil, query: [URLQueryItem] = []) throws -> URLRequest {
    guard path.hasPrefix("/api/"), !path.contains("?"), !path.contains("#"),
          let url = URL(string: origin.absoluteString + path), url.host == origin.host,
          url.port == origin.port, url.standardized.path.hasPrefix("/api/") else {
      throw RuntimeAPIError.invalidEndpoint
    }
    var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
    if !query.isEmpty { components.queryItems = query }
    var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(origin.absoluteString, forHTTPHeaderField: "Origin")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let body {
      request.httpMethod = "POST"
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    return request
  }
}

/// Safe protocol failures, without URLs or credentials in their descriptions.
public enum RuntimeAPIError: LocalizedError {
  case invalidHandshake, invalidEndpoint, invalidResponse, incompatibleVersion, rejected(Int, String)

  public var errorDescription: String? {
    switch self {
    case .invalidHandshake: "The runtime returned an unsupported connection handshake."
    case .invalidEndpoint: "The requested runtime endpoint is invalid."
    case .invalidResponse: "The runtime returned an invalid response."
    case .incompatibleVersion: "This runtime response version is not supported."
    case .rejected(let status, let message): "\(message) (\(status))"
    }
  }
}
