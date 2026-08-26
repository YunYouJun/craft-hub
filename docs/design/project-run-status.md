# Project trust and run status

The project rail communicates two independent kinds of state. Trust is a durable security decision; command execution is transient runtime activity. They must not share the same dot, color, or data source.

## Visual model

| State | Indicator | Lifetime | Meaning |
| --- | --- | --- | --- |
| Trusted | Green shield beside the project name | Persistent | Commands from this project may be executed |
| Untrusted | Amber shield beside the project name | Persistent | Discovery is allowed, execution is blocked |
| Starting | Blue spinner at the end of the row | Until the run stream starts | The client is waiting for the runtime to create the command |
| Running | Blue terminal indicator, pulsing dot, and count when greater than one | While one or more PTYs are active | Commands are executing for this project |
| Completed | Green check | About 2.4 seconds | The latest command exited successfully |
| Failed | Red warning | About 2.4 seconds | The latest command exited with a non-zero code |
| Cancelled | Neutral stop icon | About 2.4 seconds | The user stopped the latest command |

Color is supplementary. Every indicator has an accessible label and tooltip, and the icons remain distinct without color.

## State ownership

`CraftHubRuntime` owns active run handles and exposes a `ProjectRunSummary` for each affected project. A summary contains the active count and the latest finished result. The local server exposes the initial snapshot at `GET /api/runs/summary` and publishes later changes as `run-change` server-sent events.

The web client owns only the short `starting` phase because it begins before a run ID exists. Receiving a runtime summary or the streamed run record clears that phase. Finished results are retained by the runtime for reconnects, but the client displays them only for the remaining part of the 2.4-second feedback window.

The global request `busy` flag is deliberately not used as project status: it describes one browser action, not the runtime state of the project, and would miss commands started by another client.

## Transitions

```text
idle -> starting -> running -> completed -> idle
                           \-> failed ----> idle
                           \-> cancelled --> idle
```

Several commands may run concurrently. In that case the project stays `running` until the active count reaches zero. The most recent completion result is shown only after all active commands for that project have finished.

## Execution semantics

Commands remain structured as `command` plus `args`, run with the project working directory, and never opt into a raw shell. The PTY changes terminal behavior, not the trust boundary. Exit code `0` is `completed`; a non-zero exit code is `failed`; an explicit stop is `cancelled`.
