# Native resource collections and browser imports

Trusted resource adapters may return an optional `collection` on a `ResourcePage`. The shared contract in `packages/craft-hub/src/resource-pages.ts` contains inert columns, stable row IDs, display cells, copy values and navigation inputs. The host renders the same collection in native and browser clients. Business validation, filtering, ordering, persistence and write confirmation remain in the runtime adapter.

Collections name the resource filter form and selection input. Filtering and selection invoke only the declared resource read action; batch writes still cross the existing one-use form prepare/execute protocol. Hidden form/document IDs suppress duplicate legacy presentation in capable hosts. Keep entity/document/form fallbacks so older clients remain usable.

An optional `browserImport` describes an HTTPS account page, a small exact-origin login allowlist, a same-origin POST request and a bounded JSON projection. It cannot supply JavaScript. The native host executes its own bundled request script in a separate `WKWebView` without any desktop bridge. A dedicated persistent website data store is scoped to the native profile and account-page identity. User interface actions open the page, refresh a preview and explicitly import the batch.

The host rejects unexpected navigation, an account change during a request, malformed declarations, duplicate credential identities and oversized batches. Closing the window invalidates in-flight results. A preview cannot be adopted after the page navigates. Import metadata uses the same reviewed resource form protocol; credentials are separated before any runtime request or form plan is created.

Passwords are stored only in `ResourceCredentialVault`, using the macOS Keychain and a service scoped by profile, integration, source ID and origin. Ordinary resource responses contain only opaque references. Listing uses metadata-only lookups, without reading secret bytes or prompting for Keychain access. Only explicit show/copy actions read credentials. Displayed values are cleared after 30 seconds, on disappearance and when the app becomes inactive; copy marks the pasteboard as concealed. There is no plaintext storage fallback or password export API.

The regular browser renderer presents the collection and management actions. It directs source login and local credential actions to the native desktop client. It never receives native passwords through the runtime or browser bridge.

`scripts/native-resource-import.test.ts` executes the exact bundled request body with controlled browser dependencies, covering normal operators, control characters, request scope, authentication failure and identity changes. `ResourceBrowserImportTests` covers declaration validation, secret-free metadata, batch limits, real isolated Keychain access, profile/source isolation and removal.
