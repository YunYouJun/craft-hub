import Foundation
import Testing

@testable import CraftHubMacCore

struct ConnectionBrowserAuthorizationTests {
  func policy(_ patch: [String: Any] = [:]) throws -> ConnectionBrowserAuthorization {
    var data: [String: Any] = [
      "title": "Sign in", "url": "https://cloud.example.com/note/h5", "cookieOrigin": "https://cloud.example.com",
      "allowedOrigins": ["https://cloud.example.com", "https://login.example.com"],
      "cookieNames": ["userId", "serviceToken", "cloud_serviceToken"],
      "requiredCookieGroups": [["userId"], ["serviceToken", "cloud_serviceToken"]],
      "cookieField": "cookie", "originField": "origin",
    ]
    data.merge(patch) { _, next in next }
    return try JSONDecoder().decode(
      ConnectionBrowserAuthorization.self, from: JSONSerialization.data(withJSONObject: data))
  }

  func cookie(
    _ name: String, _ value: String, domain: String = ".example.com", path: String = "/", expires: Date? = nil
  ) -> HTTPCookie {
    var fields: [HTTPCookiePropertyKey: Any] = [
      .name: name, .value: value, .domain: domain, .path: path, .secure: "TRUE",
    ]
    if let expires { fields[.expires] = expires }
    return HTTPCookie(properties: fields)!
  }

  @Test func confinesNavigationAndCookieDeliveryToReviewedHTTPSOrigins() throws {
    let source = try policy()
    try source.validate()
    #expect(source.allows(URL(string: "https://login.example.com/auth")!))
    for value in [
      "http://cloud.example.com", "https://cloud.example.com.evil.test", "https://user@cloud.example.com",
      "https://cloud.example.com:8443",
    ] {
      #expect(!source.allows(URL(string: value)!))
    }
    for patch: [String: Any] in [
      ["url": "https://other.example.com"], ["cookieOrigin": "https://other.example.com"],
      ["allowedOrigins": ["https://cloud.example.com/path"]], ["cookieField": "method"],
      ["requiredCookieGroups": [["unlistedSecret"]]], ["cookieNames": ["userId", "userId"]],
    ] {
      #expect(throws: ConnectionBrowserError.self) { try policy(patch).validate() }
    }
  }

  @Test func filtersAccountWideExpiredUnrelatedAndWrongPathCookiesAndRequiresTheCloudPage() throws {
    let source = try policy()
    let cookies = [
      cookie("userId", "1001"), cookie("serviceToken", "cloud-session"), cookie("passToken", "account-wide-secret"),
      cookie("serviceToken", "other-site", domain: ".evil.example"),
      cookie("serviceToken", "wrong-path", domain: "cloud.example.com", path: "/account"),
      cookie("cloud_serviceToken", "expired", expires: Date(timeIntervalSince1970: 1)),
    ]
    let cloud = URL(string: source.url)!
    #expect(source.cookieHeader(cookies, at: cloud) == "userId=1001; serviceToken=cloud-session")
    #expect(source.cookieHeader(cookies, at: URL(string: "https://login.example.com")!) == nil)
    #expect(source.cookieHeader([cookie("userId", "1001")], at: cloud) == nil)
    #expect(
      source.cookieHeader([cookie("userId", "1001"), cookie("cloud_serviceToken", "alternate")], at: cloud)
        == "userId=1001; cloud_serviceToken=alternate")
    let names = ["one", "two", "three", "four", "five"]
    let bounded = try policy(["cookieNames": ["userId", "serviceToken", "cloud_serviceToken"] + names])
    let oversized = cookies + names.map { cookie($0, String(repeating: "a", count: 3500)) }
    #expect(bounded.cookieHeader(oversized, at: cloud) == nil)
  }

  @Test func usesTheMostSpecificCookieScope() throws {
    let source = try policy()
    let cookies = [
      cookie("userId", "1001"), cookie("serviceToken", "root"),
      cookie("serviceToken", "specific", domain: "cloud.example.com", path: "/note"),
    ]
    #expect(source.cookieHeader(cookies, at: URL(string: source.url)!) == "userId=1001; serviceToken=specific")
  }
}
