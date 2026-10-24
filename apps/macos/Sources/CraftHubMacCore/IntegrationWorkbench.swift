import Foundation

/// Inert declaration inputs. Native clients never turn these values into executable code.
public enum IntegrationValue: Codable, Sendable, Equatable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  public init(from decoder: Decoder) throws {
    let value = try decoder.singleValueContainer()
    if value.decodeNil() {
      self = .null
    } else if let bool = try? value.decode(Bool.self) {
      self = .bool(bool)
    } else if let number = try? value.decode(Double.self) {
      self = .number(number)
    } else {
      self = .string(try value.decode(String.self))
    }
  }
  public func encode(to encoder: Encoder) throws {
    var value = encoder.singleValueContainer()
    switch self {
    case .string(let text): try value.encode(text)
    case .number(let number): try value.encode(number)
    case .bool(let flag): try value.encode(flag)
    case .null: try value.encodeNil()
    }
  }
}

/// Optional, versioned runtime presentation of existing integration action results.
public struct IntegrationPresentation: Decodable, Sendable {
  public let version: Int
  public let kind: String
  public let connection: Connection?
  public let page: Page?
  public let entity: Entity?
  public let resources: IntegrationResourcePage?
  public var entityPage: Page? {
    if let page { return page }
    guard let entity else { return nil }
    return Page(items: [entity], nextCursor: nil, coverage: nil, fetchedAt: nil, cache: nil, currentUser: nil)
  }
  public struct Connection: Decodable, Sendable {
    public let connected: Bool
    public let accountLabel: String?
    public let message: String?
    public let session: Session?
    public let reviewRevision: String?
    public let forms: [Form]?
    public let links: [Link]?
    public let authorizationUrl: String?
    public let deviceAuthorization: DeviceAuthorization?
    public let capabilities: Capabilities?
    public struct Capabilities: Decodable, Sendable { public let create: Bool? }
    public struct Link: Decodable, Sendable {
      public let title: String
      public let url: String
    }
    public struct DeviceAuthorization: Decodable, Sendable {
      public let verificationUrl: String
      public let userCode: String
      public let expiresAt: String
    }
    public struct Form: Decodable, Identifiable, Sendable {
      public let id: String
      public let title: String
      public let description: String?
      public let submitLabel: String
      public let fields: [Field]
      public struct Field: Decodable, Identifiable, Sendable {
        public let id: String
        public let label: String
        public let type: String
        public let required: Bool?
        public let value: String?
        public let placeholder: String?
      }
    }
    public struct Session: Decodable, Sendable {
      public let cacheKey: String?
      public let cacheReads: Bool?
      public let expiresAt: String?
      public let renewal: String?
    }
  }
  public struct Page: Decodable, Sendable {
    public var items: [Entity]
    public var nextCursor: String?
    public var coverage: String?
    public let fetchedAt: String?
    public let cache: Cache?
    public let currentUser: User?
    public struct Cache: Decodable, Sendable {
      public let reason: String
      public let readOnly: Bool
    }
    public struct User: Decodable, Sendable { public let id: String }
  }
  public struct Entity: Decodable, Identifiable, Sendable {
    public let key: String
    public let id: String
    public let title: String
    public let active: Bool
    public let personal: Bool
    public let url: String?
    public let description: String?
    public let status: String?
    public let statusLabel: String?
    public let details: [Detail]?
    public let configurationToggle: ConfigurationToggle?
    public struct Detail: Decodable, Sendable {
      public let label: String
      public let value: String
    }
    public struct ConfigurationToggle: Decodable, Sendable {
      public let enabled: Bool
      public let inherited: Bool
      public let revision: String
      public let scope: String
    }
  }
}

extension RuntimeAPIClient {
  /// Keep the runtime's project resolution, confirmation and trust checks on every read/write.
  public func integrationPresentation(
    integration: String, action: String, project: String? = nil,
    input: [String: IntegrationValue] = [:], confirmed: Bool = false, reviewedAction: [String: String]? = nil,
    reviewedConnection: String? = nil
  ) async throws -> IntegrationPresentation {
    struct Body: Encodable {
      let input: [String: IntegrationValue]
      let confirmed: Bool
      let reviewedAction: [String: String]?
      let reviewedConnection: String?
    }
    let prefix = try project.map { "/api/projects/\(try Self.segment($0))" } ?? "/api"
    let result: IntegrationPresentation = try await fetch(
      path: "\(prefix)/integrations/\(try Self.segment(integration))/actions/\(try Self.segment(action))",
      body: JSONEncoder().encode(
        Body(input: input, confirmed: confirmed, reviewedAction: reviewedAction, reviewedConnection: reviewedConnection)
      ),
      query: [.init(name: "presentation", value: "workbench-v1")])
    guard result.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return result
  }
}
