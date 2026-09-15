# Remote task delivery

The runtime exports a host-neutral delivery ledger and an opt-in local receiver. A broker owns authenticated accounts, project authorization, external work-item resolution and operation adapters. The local host owns registered project paths, trust and its agent provider. A cloud configuration account does not become a local executor.

## Connect a device

Create a local JSON object mapping broker project IDs to registered local project IDs. Trust each project through the local workbench before enabling the receiver.

```sh
craft-hub device:pair --url https://broker.example.com --name MyDevice --bindings ./bindings.json --credential-file ./device-credential.local.json
```

The broker must mount `createDeliveryHttpHandler` and implement browser approval at `/bot?pairing=...`. Pairing requires both the locally retained verifier and an authenticated browser approval. The credential file is written with mode `0600`; keep it outside shared configuration and source control.

Start a local host with an `AgentTaskProvider` and set `CRAFT_HUB_DEVICE_CONFIG` to the credential file's absolute path. The receiver polls outbound every three seconds. An offline or busy device leaves a draft; reconnecting does not execute drafts automatically. Revoke the device through the broker to invalidate its credential.

## Host contracts

- `DeliveryCoordinator` requires an authorization callback; hosts must check current source permissions as well as their own project policy. Browser identity and device Bearer credentials are separate.
- A `DeliveryWorkItemRef` includes provider, container, item kind and item ID. External state remains separate from execution status.
- Individual links are private unless explicitly shared. Group HTTP lists project titles and execution status only. Transport hosts must apply equivalent projections to their own channel replies.
- New requests use a deterministic local task identity and an isolated Git worktree by default. Checkout mode must be explicitly selected.
- A continuation requires a finished original attempt, the same executor, device, mode and workspace, and an agent provider declaring `supportsResume`. It retains the original external thread. Unknown or detached tasks require inspection in the original client.
- Stops request cancellation from the original provider; they do not roll back produced files or external effects.
- Operation adapters must enforce the confirmed revision atomically at the destination. A preceding GET is insufficient. Thrown write errors become `unknown` until a separate reconciliation proves the outcome.

## Persistence and limits

`DeliveryStore` uses built-in Node SQLite with full synchronous transactions, WAL, private filesystem permissions and synchronous mutations. Use a persistent local disk and Node 22.18+ or 24.11+. Do not place the ledger in a portable configuration repository or network filesystem. Broker and receiver ledgers are independent.

The receiver journals its claim before starting. After ambiguous failure it reconciles the deterministic local task; it never silently starts the request again. One active request per device is the initial dispatch policy. This does not serialize unrelated operations started manually in another client.

`pruneContent()` clears terminal request prompts and short summaries after 30 days by default. Hosts must schedule it and implement any additional retention or deletion policy. Whole agent transcripts remain local. Authentication pages, source OAuth and transport-specific notifications belong to the host integration.
