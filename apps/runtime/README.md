# On-demand runtime (P0/P1)

This private host is an **explicit fixture-only acceptance entrypoint**. It starts independently of Electron, uses `craft-hub/shared-runtime`, and loads only the local fake capture provider. It does not load the desktop host composition, real cloud plugins, project watchers, terminals, account login or user credentials. The Electron workbench still uses its existing host until P2.

`src/worker.ts` receives bounded JSON lines from its parent broker. GUI connections are not its parent; losing a GUI does not close the pipe. The worker holds an exclusive profile lease, writes a durable attempt journal before dispatch, and exits after 30 seconds without leases by default. Broker EOF aborts in-flight transports, preserves uncertainty and starts bounded shutdown. The host enforces a five-second final shutdown deadline.

The core owns request validation, review binding, leases and durable receipt recovery. The fake provider owns only local fixture writes and explicit slow/hang/lost-reply targets. It is a test adapter, not a second plugin installation or login system; P2 must adapt the existing host plugin composition. It never supplies a cloud capability. `RuntimeAvailability.acquire('session')` is the host seam for a future workbench session; starting and releasing the actual workbench scope belongs to P2.

Build this host and its dependencies with `pnpm --filter @craft-hub/runtime... build`. Run the isolated macOS acceptance with `pnpm test:shared-runtime`; see [the macOS broker](../runtime-macos/README.md) and [the design/status](../../docs/plans/on-demand-shared-runtime.md).
