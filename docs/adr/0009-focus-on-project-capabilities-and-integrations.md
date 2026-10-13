# Focus on project capabilities and development integrations

Date: 2026-10-08. Status: accepted product direction; implementation is a staged migration.

Craft Hub connects local project capabilities, external development systems, and the tools people already use. It supplies structured commands and reviewable integration actions through a shared runtime, public APIs, and focused browser views. Coding workbenches own agent conversations, parallel worktrees, interactive terminals, and code review.

## Why narrow the scope

General agent workbenches already cover much of the planned coding environment. Maintaining another full environment duplicates project navigation, session lifecycle, terminal hosting, and repository review. Local operation, open source, multiple agents, Skills, MCP, and a plugin system alone do not establish a separate user need. See the dated [workbench selection research](../research/agent-workbench-selection.md).

The useful existing investment is in concrete project and integration workflows: discovering declared commands, validating their arguments and directories, connecting provider context, reviewing native status transitions, and reviewing configuration changes. Each retained surface must justify its maintenance through repeated use. A contract or an unimplemented roadmap item is insufficient evidence.

## Ownership

| Surface | Decision | Boundary |
| --- | --- | --- |
| Project registry and portable workspaces | Retain for capabilities and integration context | Do not grow a second worktree/session manager |
| Command discovery, forms, trust, execution, output, cancellation, run records | Retain while they serve recurring tasks | Declared commands use structured argv; command output is part of this workflow |
| Account, work-item, repository and integration providers | Retain | Concrete external systems belong in optional Host extensions |
| Native business actions and status transitions | Retain focused review UI | Preserve required fields, provider validation, and explicit confirmation |
| Configuration review, recovery, plugin approval, diagnostics | Retain focused review UI | Configuration and workspace Git persistence is Craft Hub's own data management |
| Project/work-item context handoff | Keep and decouple execution | Review/copy/export first; add launch adapters only after validating the external contract |
| Generic agent prompts, local sessions, activity aggregation, Skill execution UI | Phase out internal hosting | External workbenches own session execution and restore |
| General Git merge/review UI and interactive terminal hosting | Phase out or stop expanding | Keep repository links, provider metadata, and structured command feedback |
| Remote agent delivery and automatic worktree creation | Migrate to an external executor or retire together | Existing delivery depends on agent task records, reconciliation, and cancellation |
| Electron shell | Evaluate after required workflows have other entry points | Browser and CLI remain supported; existing installations and user data need a migration path |
| Workflow Studio and broad editor integrations | Defer without a delivery commitment | Require a recurring unmet workflow before reopening |

## Current implementation and removal dependencies

`packages/craft-hub/src/agent-tasks.ts` is shared by workspace prompts, Skill execution, work-item launch, and project configuration actions. `packages/craft-hub/src/delivery/local-executor.ts` also uses its start, lookup, cancellation, and recovery behavior. Deleting it before these callers migrate breaks retained workflows.

`apps/web/src/DetailPanel.vue` displays the output of structured commands. This output and cancellation UI remains necessary even when general terminal hosting belongs elsewhere. Configuration subscriptions and workspace synchronization also use Git; removing a repository merge dialog must not remove this persistence.

The running Host's Agent connection is scoped and read-only. The independent MCP adapter supports discovery and preview, but neither entry point currently supplies command-run or business-write tools. External MCP configuration therefore does not provide complete replacement of existing write workflows today.

## Migration sequence and acceptance

1. Remove generic internal background-task creation from `WorkspaceDashboard.vue`. Preserve existing Codex handoff, project selection, trust checks, historical output, and the backend cancellation API. The current Codex handoff still uses the SDK runner; replacing internal execution is a later step. This first implementation slice does not complete the migration.
2. Change work-item, Skill, and configuration-action entry points to prepare reviewable context. Provide copy/export fallbacks before relying on an external launcher. Validate the launcher's actual executable/protocol, working directory, and failure behavior instead of assuming workbench interoperability.
3. Migrate or retire remote delivery as a complete flow, including paired-host dispatch, task identity, restart reconciliation, cancellation, and history. Retained entry points need a working destination.
4. Remove generic task/session/activity and repository merge UI, unused IPC, providers, and dependencies only after there are no retained callers. Stop new internal session features during this period.
5. Evaluate the Electron shell using real workflows. Retire it only when account setup, business actions, configuration review, diagnostics, and handoff work through retained entry points. Preserve user state and explain any conversion or rollback.

Run one representative workflow from a real work item through context preparation and an external coding tool, then review the result and perform the provider-native status change. Also verify a structured command run, configuration recovery, and access to historical tasks. Record every required return to Craft Hub and the reason; these observations determine which focused views remain useful.

No particular agent or external workbench becomes a runtime dependency. Orca and alternatives are consumption options, and their UI, license, or protocol changes remain isolated behind adapters.
