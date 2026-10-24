# Native public-link handover

The ordinary candidate continues to declare only `craft-hub-native:`. Native Settings now shows the current `craft-hub:` application and a read-only explanation while public-link handover is disabled. Neither startup, deep links nor the web bridge can change the default application. The updated macOS Electron host also stops calling its default-protocol setter on startup; its existing packaged protocol declaration remains. Older Electron versions may still reclaim the scheme and must be upgraded before acceptance.

## Release eligibility

`CRAFT_HUB_NATIVE_PUBLIC_LINKS=true` is a separate, build-time opt-in. It requires `CRAFT_HUB_NATIVE_RELEASE=true` and its validated signing/update configuration. Local ad hoc builds reject the opt-in. The build then embeds `CraftHubPublicLinksEnabled=true` and declares both schemes in the signed Info.plist. No mutable preference or environment variable at application launch enables the UI.

The release workflow deliberately leaves this flag unset. Declaring the public scheme makes a bundle eligible for macOS handler selection, so enabling it is part of an explicitly authorized rollout, after migration and signed-pair acceptance. An ordinary candidate or signed alpha without the flag remains ineligible. No installed application, public scheme, real profile or account was switched during implementation.

## Review and rollback

In an eligible release, **Settings → Public Links → Use This Native App…** reviews the exact current and proposed application paths. Complete data-migration acceptance and pending browser device connections first. This action does not copy data, authorize an account or execute a project command. New native device connections continue using `craft-hub-native://cloud/connect`; old Electron authentication callbacks are not adopted by the native profile.

The native sheet requires an explicit button click. Escape cancels; Return does not submit the change. After approval, the service acquires an account-wide exclusive lease and rechecks the handler, application metadata and recovery record. Changed or missing applications require a fresh review. With no existing handler, the service refuses to offer a switch without a rollback target.

Before calling the system setter, it atomically writes a private recovery record to the OS account's `Library/Application Support/Craft Hub Migration/links/handover.json`. It records one previous application, the requested application, bundle IDs and metadata revisions, never a callback URL, credential or profile content. The directory is private and the file is mode `0600`; linked, malformed or oversized records are rejected. The location is shared by candidate profiles and is independent of caller HOME/TMPDIR overrides.

The service uses Apple's [NSWorkspace default-application API](https://developer.apple.com/documentation/appkit/nsworkspace/setdefaultapplication(at:toopenurlswithscheme:completion:)), which may present system consent. It rereads the actual default after completion. An error or different result retains the recovery record and reports uncertainty; it never reports success just because the setter returned. macOS does not provide a compare-and-set transaction for other applications' changes, so the lease coordinates Craft Hub participants only.

**Restore Previous App…** reviews the saved application again and checks that the current handler is still this native bundle, or is already the saved previous app. A later choice of a third application is preserved. Repeated adoption or rollback is idempotent; a crash before or after the system setter can be recovered from the same record and the actual system selection. A legitimate update to the previous app requires a new metadata review. Missing apps, changed bundle identities, or a moved native bundle fail closed; retain the applications at their reviewed paths until acceptance is complete. A later explicit handover from a newly reviewed handler replaces the single rollback record.

## Verification

Core and UI-model tests cover cancellation, disabled candidates, late confirmation, concurrent writers, changed handlers/binaries/receipts, repeated actions, setter refusal, failure after mutation, missing applications and retained rollback. Packaging tests keep ordinary builds free of the public declaration and reject local-build opt-in.

Run the real Launch Services rehearsal separately:

```sh
CRAFT_HUB_TEST_LINK_HANDOVER=1 swift test --package-path apps/macos --filter privateSchemeSystemHandoverAndRollback
```

This creates two small, uniquely identified ad hoc applications under `apps/macos/build/` and registers only a random `craft-hub-test-…` scheme. It exercises the production NSWorkspace adapter, reviewed handover and rollback, checks the real public handler before and after, then unregisters and deletes its fixture bundles. Launch Services marks bundles in temporary directories as launch-disabled, so those directories are unsuitable for this rehearsal. The test neither opens public links nor changes the public handler.

Signed eligible-release consent, public-link delivery after switching, restart persistence, old-Electron behavior, minimum-system execution and real-user rollback remain separate acceptance items. The isolated scheme rehearsal is not a public-host switch.

On 2026-10-23, the unlocked macOS 26.6.2 host displayed the ordinary candidate's native Settings in an isolated application copy. Accessibility state and a screenshot confirmed the current public handler's name/path, the disabled-release explanation and a Refresh button, with no adoption or rollback action. No public handler was changed. This checks the ordinary candidate's read-only UI; it does not validate an eligible signed release's consent flow.
