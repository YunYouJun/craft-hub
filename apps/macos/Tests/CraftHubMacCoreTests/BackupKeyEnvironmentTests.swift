import CraftHubMacCore
import Testing

@Test func backupKeysOnlyCrossTheDedicatedNativeHostNamespace() {
  let safe = "CRAFT_HUB_BACKUP_KEY_FIXTURE"
  let inherited = [
    safe: "disposable-fixture-value", "NODE_OPTIONS": "--require=unexpected", "DYLD_INSERT_LIBRARIES": "unexpected",
    "WORKSTATION_BACKUP_PASSPHRASE": "not-opted-in", "CRAFT_HUB_BACKUP_KEY_bad": "invalid-name",
    "CRAFT_HUB_BACKUP_KEY_LARGE": String(repeating: "x", count: 16_385),
  ]
  #expect(BackupKeyEnvironment.forwarded(inherited) == [safe: "disposable-fixture-value"])
}
