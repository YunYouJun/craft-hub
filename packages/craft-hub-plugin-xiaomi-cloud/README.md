# Xiaomi Cloud notes for Craft Hub

Trusted Host Plugin `@craft-hub/craft-hub-plugin-xiaomi-cloud` adds a global **Xiaomi Cloud / 小米云** page. This first version connects your own Xiaomi Cloud account and manually backs up standard note text to the current host. It uses the private web API, not an officially supported notes API. No cloud writes are exposed.

## Use

1. Build Craft Hub from this checkout. In plugin management, enable the optional **Xiaomi Cloud** Host Plugin and restart the host. It is disabled by default and discovery never contacts Xiaomi or reads credentials.
2. Open **Xiaomi Cloud** and follow **Open Xiaomi Cloud notes**. Sign in yourself and enable notes cloud sync on your device.
3. In the native macOS app, choose **Sign in and connect Xiaomi Cloud / 登录并连接小米云**. Complete Xiaomi sign-in in the isolated window; the host automatically validates and saves the cloud session. Passwords and account-wide login cookies are not sent to the plugin. This window uses an ephemeral browser partition and does not read another application's or browser's login state. On other hosts, expand the manual form: in the browser's developer tools, open Network and refresh the notes list, copy the `Cookie` request header from a `/note/` request, and submit it through the plugin's password field with the matching cloud origin. Do not put cookies in chat, project configuration or a repository.
4. Choose **Sync notes to this device** and confirm the local backup. The page shows progress. After completion, search text, filter by folder, select a note, preview or download its Markdown, or download its original note data as JSON.

Accepted origins are `https://i.mi.com`, `https://us.i.mi.com`, `https://sg.i.mi.com` and `https://de.i.mi.com`. The origin must match the signed-in region. Regional account behavior requires real-account validation. The plugin never follows credential-bearing redirects, so a redirected session must be renewed at its matching regional website.

The connection retains only `userId`, `serviceToken` and `i.mi.com_serviceToken`; account-wide `passToken` and unrelated cookies are discarded. Credentials live in the operating system's Keychain, Credential Manager or Secret Service through `keytar`, under a service isolated by the absolute Craft Hub data directory. A locked or unavailable credential store fails without a plaintext fallback. Password fields and provider failures never return credentials to the page. Sign-in expiry requires opening the sign-in window again (or refreshing the manual cloud session on other hosts); silent credential renewal is not attempted.

**Disconnect** removes saved credentials, cancels and joins any active sync, and keeps local backups. Reconnecting the same account restores access to its backup; changing account or cloud region selects separate storage. Hosted workbenches cannot access this integration's local vault or notes. These credentials are not part of Craft Hub account sync.

## Backup behavior

Backups live under the operating system Craft Hub data directory:

```text
integrations/xiaomi-cloud/backups/<account-and-region-hash>/
  current.json
  snapshot-<uuid>/
    snapshot.json
    notes/<note-id-hash>.md
```

The page displays the exact current snapshot directory. `snapshot.json` includes folder metadata, note IDs, timestamps, original text markup, derived Markdown and attachment references. It contains no authentication cookies. Files use mode `0600` and created directories use `0700` on POSIX hosts. Backups are local plaintext documents protected by the local user account; the system vault protects credentials separately.

Every confirmed sync enumerates the full inventory, reuses unchanged note bodies and fetches new or modified full text. It processes requests sequentially with a 500 ms pause and stops on rate limiting, network errors, invalid responses or non-advancing cursors. It publishes a new snapshot only after the whole inventory and every required detail have succeeded. An interrupted or failed sync leaves the previous pointer untouched. Earlier generations remain available, including cloud-deleted notes; history cleanup is manual in this version. Local Markdown edits are never uploaded or overwritten in an earlier generation, and are not merged into subsequent snapshots.

Limits are 10,000 standard notes, 64 MB of original plus derived text, 8 MB per API response, 30 seconds per request and 100 rows per page. A limit failure preserves the previous backup. The UI supports an asynchronous sync with read-only progress polling; hosts cancel and join it on shutdown.

## Artwork

The integration uses Xiaomi's original orange logo, bundled unchanged from the [official Xiaomi CDN](https://cdn.cnbj1.fds.api.mi-img.com/mi.com-assets/shop/img/logo-mi2.png) for offline source identification. The artwork and trademark belong to Xiaomi. The public [Xiaomi Cloud desktop download page](https://i.mi.com/static2?filename=MicloudWebStatic/res/home/mi-lab.htm&locale=zh_CN) is suitable for a personal software shortcut's download link.

## Scope and limitations

- Ordinary note text, titles, folders and common checklist formatting are supported. Conversion to Markdown is intentionally lossy; original markup is retained in JSON.
- Images, recordings and other attachment files are **not downloaded**. References and visible placeholders are retained. This is a text backup, not a complete media backup.
- Private notes, to-dos, mind maps and unsupported note types are skipped. The snapshot discloses the count of unsupported records returned by the inventory; hidden records cannot be counted.
- Sync is manual and one-way. There is no scheduled background sync, cloud editing, deletion, task import or upload of Craft Hub's own configuration to Xiaomi.
- Private endpoints can change without notice. Offline fixture tests validate the adapter contract; successful live sign-in and real-account data fidelity remain separate acceptance work.

For a browser-only local runtime, build this package and explicitly load the trusted entry with `craft-hub ui --host-plugin /absolute/path/to/craft-hub-plugin-xiaomi-cloud/dist/index.mjs`. An embedding host can call `createXiaomiCloudPlugin({ dataDir, credentialStore, transport })`; it must call the returned plugin's `close()` on shutdown.

Protocol references were checked against the upstream [mi-note-export API implementation](https://github.com/idootop/mi-note-export/blob/7b40c61e291fbb835f9475c2f790c8c52983c8a9/apps/node/src/api.ts) and [response types](https://github.com/idootop/mi-note-export/blob/7b40c61e291fbb835f9475c2f790c8c52983c8a9/apps/node/src/typing.ts). The implementation here is independent and does not run the upstream export tool. Xiaomi's public [OAuth scope list](https://dev.mi.com/docs/passport/scopes/) does not list notes access; [CloudKit](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2017) synchronizes participating applications' own data.
