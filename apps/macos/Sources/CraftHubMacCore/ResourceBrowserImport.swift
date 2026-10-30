import CoreFoundation
import Foundation

/// A private native import batch. Only metadataJSON may be submitted to the runtime or a form plan.
public struct ResourceBrowserImportBatch {
  public let metadataJSON: String
  public let count: Int
  public let credentials: [String: String]
}

extension IntegrationResourcePage.BrowserImport {
  public func validate() throws {
    guard let url = URL(string: url), Self.origin(url) != nil, allows(url), allowedOrigins.count <= 12,
      allowedOrigins.allSatisfy({ value in URL(string: value).flatMap(Self.origin) == value }),
      request.path.hasPrefix("/"), !request.path.hasPrefix("//"),
      request.path.range(of: #"^/[A-Za-z0-9_/-]+$"#, options: .regularExpression) != nil,
      ([
        request.operatorGlobal, request.operatorParameter, response.successField, credentials.keyField,
        credentials.secretField, credentials.availableField,
      ] + response.recordsPath + credentials.publicFields)
      .allSatisfy({
        $0.range(of: #"^[A-Za-z_][A-Za-z0-9_]{0,79}$"#, options: .regularExpression) != nil
          && !["__proto__", "prototype", "constructor"].contains($0)
      }),
      !response.recordsPath.isEmpty, response.recordsPath.count <= 8,
      !credentials.publicFields.contains(credentials.secretField), credentials.publicFields.count <= 16,
      Set(credentials.publicFields).count == credentials.publicFields.count,
      credentials.publicFields.contains(credentials.keyField),
      credentials.publicFields.contains(credentials.availableField)
    else { throw ResourceCredentialError.invalid }
  }

  public func allows(_ candidate: URL) -> Bool {
    guard let origin = Self.origin(candidate) else { return false }
    return allowedOrigins.contains(origin)
  }

  public func isAccountPage(_ candidate: URL) -> Bool {
    guard let target = URL(string: url) else { return false }
    return Self.origin(candidate) == Self.origin(target) && candidate.path == target.path
  }

  /// Separate credentials before creating any runtime input. Reject the whole batch on malformed data.
  public func prepare(_ rows: Any) throws -> ResourceBrowserImportBatch {
    try validate()
    guard let rows = rows as? [[String: Any]], rows.count <= 500 else { throw ResourceCredentialError.invalid }
    var keys = Set<String>()
    var secrets: [String: String] = [:]
    var metadata: [[String: Any]] = []
    for row in rows {
      guard let key = row[credentials.keyField] as? String, !key.isEmpty, key.utf8.count <= 512,
        !key.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
        keys.insert(key.lowercased()).inserted,
        let available = row[credentials.availableField] as? NSNumber,
        CFGetTypeID(available) != CFBooleanGetTypeID(), available.doubleValue == Double(available.intValue)
      else { throw ResourceCredentialError.invalid }
      if let raw = row[credentials.secretField], !(raw is NSNull) {
        guard let password = raw as? String, password.utf8.count <= 4096,
          !password.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw ResourceCredentialError.invalid }
        if available.intValue != 0 && !password.isEmpty { secrets[key] = password }
      }
      metadata.append(
        Dictionary(
          uniqueKeysWithValues: credentials.publicFields.compactMap { field in
            row[field].map { (field, $0) }
          }))
    }
    let data = try JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys])
    guard data.count <= 512 * 1024, let json = String(data: data, encoding: .utf8) else {
      throw ResourceCredentialError.invalid
    }
    return ResourceBrowserImportBatch(metadataJSON: json, count: rows.count, credentials: secrets)
  }

  public static func origin(_ url: URL) -> String? {
    guard url.scheme == "https", let host = url.host, url.user == nil, url.password == nil, url.port == nil else {
      return nil
    }
    return "https://" + host.lowercased()
  }
}
