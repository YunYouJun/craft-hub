import Foundation

/// The native host accepts only a dedicated namespace of explicitly supplied backup keys.
/// Variable values remain transient, never part of a configuration request or persisted preference.
public enum BackupKeyEnvironment {
  public static func forwarded(_ inherited: [String: String]) -> [String: String] {
    inherited.filter { name, value in
      name.hasPrefix("CRAFT_HUB_BACKUP_KEY_") && name.count <= 128 && value.utf8.count <= 16_384
        && name.range(of: "^[A-Z][A-Z0-9_]*$", options: .regularExpression) != nil
    }
  }
}
