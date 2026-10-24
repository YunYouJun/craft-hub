import Foundation
import Security

/// SecItem's per-query authentication flags do not suppress file-keychain UI (FB16959400).
/// Serialize our Security calls while temporarily suppressing interaction, and restore the host's policy.
/// The synchronous closure must not suspend or call another subsystem that accesses Keychain.
enum FileKeychainAccess {
  private static let lock = NSLock()

  static func copyMatching(
    _ query: [String: Any], interactive: Bool, result: inout CFTypeRef?
  ) throws -> OSStatus {
    try perform(interactive: interactive) {
      var readQuery = query
      if !interactive {
        // Resolve metadata first. A locked file keychain can retain interactive credentials even after
        // the process policy changes; never request its secret bytes in an automatic read.
        var referenceQuery = query
        referenceQuery.removeValue(forKey: kSecReturnData as String)
        referenceQuery[kSecReturnRef as String] = true
        var reference: CFTypeRef?
        let status = SecItemCopyMatching(referenceQuery as CFDictionary, &reference)
        guard status == errSecSuccess else { return status }
        guard let reference, CFGetTypeID(reference) == SecKeychainItemGetTypeID() else {
          throw DeviceVaultError.unavailable
        }
        var keychain: SecKeychain?
        guard SecKeychainItemCopyKeychain(reference as! SecKeychainItem, &keychain) == errSecSuccess,
          let keychain
        else { throw DeviceVaultError.unavailable }
        var state: SecKeychainStatus = 0
        guard SecKeychainGetStatus(keychain, &state) == errSecSuccess,
          state & kSecUnlockStateStatus != 0
        else { throw DeviceVaultError.unavailable }
        readQuery[kSecMatchItemList as String] = [reference]
      }
      return SecItemCopyMatching(readQuery as CFDictionary, &result)
    }
  }

  static func perform<T>(interactive: Bool, _ operation: () throws -> T) throws -> T {
    lock.lock()
    defer { lock.unlock() }
    // An explicit action respects an already disabled host policy; it never enables interaction itself.
    if interactive { return try operation() }
    var previous: DarwinBoolean = false
    guard SecKeychainGetUserInteractionAllowed(&previous) == errSecSuccess,
      SecKeychainSetUserInteractionAllowed(false) == errSecSuccess
    else { throw DeviceVaultError.unavailable }
    let result = Result { try operation() }
    guard SecKeychainSetUserInteractionAllowed(previous.boolValue) == errSecSuccess else {
      throw DeviceVaultError.unavailable
    }
    return try result.get()
  }
}
