import Foundation

/// Inert login policy resolved from a trusted connection form. Cookies never enter the workbench browser.
public struct ConnectionBrowserAuthorization: Codable, Equatable, Sendable {
  public let title: String
  public let url: String
  public let allowedOrigins: [String]
  public let cookieOrigin: String
  public let cookieNames: [String]
  public let requiredCookieGroups: [[String]]
  public let cookieField: String
  public let originField: String

  public func validate() throws {
    guard !title.isEmpty, title.count <= 200, url.count <= 2048,
      let page = URL(string: url), Self.origin(page) == cookieOrigin, page.fragment == nil,
      !allowedOrigins.isEmpty, allowedOrigins.count <= 8, allowedOrigins.contains(cookieOrigin),
      allowedOrigins.allSatisfy({ value in URL(string: value).flatMap(Self.origin) == value }),
      !cookieNames.isEmpty, cookieNames.count <= 16, Set(cookieNames).count == cookieNames.count,
      cookieNames.allSatisfy({ $0.range(of: "^[\\w.-]{1,100}$", options: .regularExpression) != nil }),
      !requiredCookieGroups.isEmpty, requiredCookieGroups.count <= 16,
      requiredCookieGroups.allSatisfy({ !$0.isEmpty && $0.count <= 16 && $0.allSatisfy(cookieNames.contains) }),
      cookieField != originField,
      [cookieField, originField].allSatisfy({
        $0.range(of: "^[a-zA-Z]\\w{0,99}$", options: .regularExpression) != nil
          && !["method", "locale", "constructor", "prototype", "__proto__"].contains($0)
      })
    else { throw ConnectionBrowserError.invalid }
  }

  public static func origin(_ url: URL) -> String? {
    guard url.scheme == "https", let host = url.host?.lowercased(), !host.isEmpty,
      url.user == nil, url.password == nil
    else { return nil }
    return "https://" + host + (url.port.map { $0 == 443 ? "" : ":\($0)" } ?? "")
  }

  public func allows(_ page: URL) -> Bool {
    Self.origin(page).map(allowedOrigins.contains) ?? false
  }

  /// Select only scoped, unexpired cookies after the cloud page itself has loaded; account-login cookies stay private.
  public func cookieHeader(_ cookies: [HTTPCookie], at page: URL, now: Date = Date()) -> String? {
    guard (try? validate()) != nil, Self.origin(page) == cookieOrigin,
      let target = URL(string: url), let host = target.host
    else { return nil }
    var selected: [String: HTTPCookie] = [:]
    for cookie in cookies where cookieNames.contains(cookie.name) {
      let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
      let path = cookie.path
      guard !domain.isEmpty, host == domain || host.hasSuffix("." + domain),
        cookie.expiresDate.map({ $0 > now }) ?? true,
        target.path == path || target.path.hasPrefix(path.hasSuffix("/") ? path : path + "/"),
        !cookie.value.isEmpty, cookie.value.utf8.allSatisfy({ $0 > 32 && $0 != 127 && $0 != 59 })
      else { continue }
      if let old = selected[cookie.name],
        old.path.count * 1000 + old.domain.count >= path.count * 1000 + cookie.domain.count
      {
        continue
      }
      selected[cookie.name] = cookie
    }
    guard requiredCookieGroups.allSatisfy({ group in group.contains(where: { selected[$0] != nil }) }) else {
      return nil
    }
    let header = cookieNames.compactMap { name in selected[name].map { name + "=" + $0.value } }.joined(separator: "; ")
    return header.utf8.count <= 16384 ? header : nil
  }
}

public enum ConnectionBrowserError: Error { case invalid, unavailable }
