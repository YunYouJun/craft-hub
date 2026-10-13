# Personalize the persistent workbench overview

Date: 2026-10-08. Updated: 2026-10-09. Status: accepted product direction; the overview is the foundation and external handoff is the next slice.

Follow-up on 2026-10-09: the user's machine/software/environment focus refines the home priority in [ADR 0011](./0011-focus-on-machine-setup-and-environment.md). The installed overview and its safety contracts remain; cross-provider handoff is no longer the first implementation priority.

This decision refines [ADR 0009](./0009-focus-on-project-capabilities-and-integrations.md). Its separation of coding-workbench responsibilities and dependency-aware migration remains in force. Craft Hub's user-facing role is a personal developer workbench that connects cross-provider work items, project context, and explicit handoff to external tools. The persistent overview supports this workflow; shortcuts alone do not establish a separate product need.

## Motivation

A useful personal home lets someone see their commonly used projects, tools, and connected work without reopening unrelated project pages or remembering where each integration lives. Personalization is valuable when those choices persist and the page leads to real workflows. A collection of interchangeable coding terminals does not serve that need better than existing coding workbenches.

Use Orca or another coding workbench for daily coding. Raycast already supports configurable tool shortcuts, local project lists, and task-service views through extensions. Craft Hub must justify its persistent view through cross-provider identity, reviewed project associations, context preparation, and return to provider-native actions. Neither external tool becomes a required runtime dependency. See the dated [selection and launch-contract research](../research/agent-workbench-selection.md).

## Decision

`/overview` is the default home. Work items and projects lead; grouped HTTPS tool shortcuts and installed plugin entries support the next action. Real previews come from declared `work-items.list` actions. Initial discovery, an empty successful result, missing identity, and provider failure are distinct states; the home must not substitute fixture tasks for external data.

Personal home choices are owned by the existing runtime settings service under `workbench.home`. `PersonalWorkbenchHome` contains `tools` with stable IDs, titles, HTTPS URLs, groups, and optional descriptions, plus optional `pinnedProjectIds`. Tools can be added, edited, removed, and regrouped. Tool IDs and project pins are unique and bounded. URLs must use HTTPS and contain no embedded credentials or control characters. The defaults are ordinary editable links to Orca, ChatGPT, and Claude in the `AI Tools` group.

The settings file belongs in the operating-system Craft Hub data directory, using the existing atomic writes, validation, revisions, and reload behavior. Browser storage is not the source of truth for these choices. Project IDs currently derive from local paths, so this first slice excludes `workbench.home` from portable settings exports. A later decision may export tool links independently while keeping or mapping project pins locally.

Work-item data remains owned by the connected provider. Home previews invoke only unconfirmed global reads, keep source identities and failures separate, and filter by the source's exact current-user ID and terminal status. They are partial previews, not a claim to have fetched every assigned item. Provider-native status changes and other writes remain in existing integration views with their required fields, validation, and confirmation. Craft Hub does not add a separate personal task database.

The first external-handoff slice starts from a project or work-item preview. The user selects a local project, adds an objective, reviews a text context, copies it, and explicitly opens an external destination. A work-item title match cannot silently choose a project. Context must identify its source and project, show missing information, and preserve the website/copy fallback when no native launcher is available.

Tool preferences may add an optional `launch` alongside their HTTPS `url`: `{ application: 'raycast', commandUrl?: string }` or `{ application: 'orca' }`. The initial Raycast command adapter accepts only a canonical command deeplink with no query or hash. Orca only launches the fixed application. Launch requests return `contextTransferred: false`: opening an application or command is not evidence that it received the context or executed the objective.

Raycast's documented command URL is `raycast://extensions/<author-or-owner>/<extension-name>/<command-name>`. The command must already be installed and enabled; users obtain the exact URL with `Copy Deeplink`. Although the official protocol also supports arguments and launch context, this slice does not expose them. Orca's `orca open` has no project-path argument, and its currently implemented application deeplink handles skill sharing rather than project selection. Additional adapters require a verified receiving contract and observable acceptance before they can report transfer success. [Raycast contract](https://developers.raycast.com/information/lifecycle/deeplinks), [Orca CLI](https://www.onorca.dev/docs/cli/reference), [Orca URL handler](https://github.com/stablyai/orca/blob/main/src/main/index.ts#L91-L97)

## Boundaries

| Responsibility | Owner |
| --- | --- |
| Cross-provider overview, source identity, reviewed project associations and context preparation | Craft Hub |
| Tool groups, local project pins and explicit handoff requests | Craft Hub; convenience surfaces supporting the workflow |
| Project commands, trust, run feedback, configuration review, diagnostics | Craft Hub shared runtime and focused views |
| Real work-item data and system-specific actions | Optional integration providers |
| Agent conversations, worktree lifecycle, interactive terminals, code review | The user's coding workbench |
| Global shortcut actions and general application launching | The user's launcher or CLI setup |

Keep website navigation HTTPS-only. External launching is a separate, limited adapter, not a broad change to the navigation allowlist or to Craft Hub's navigation-only Desktop Links in [ADR 0007](./0007-keep-desktop-links-navigation-only.md). It requires an explicit user action and cannot grant project trust, run project commands, create worktrees, or update provider status as a side effect.

Do not embed arbitrary external sites, invent project deeplink routes, inject prompts through UI automation, or synchronize third-party sessions. A future return receipt describes observed handoff events, not a second task execution database; only the provider owns authoritative completion. Existing internal task callers must be migrated before their backend is removed.

Keep public runtime contracts vendor-neutral. External brands identify optional destinations whose contracts are isolated behind adapters. Private systems stay in downstream providers; the community overview consumes the same public action and navigation contracts.

## Acceptance and consequences

The implemented overview baseline must work with no project selected; edited tool groups and pins survive restart through runtime settings; unsafe links and stale revisions are rejected; and a pinned project opens the existing project workbench. Verify real read-only previews, exact account filtering, provider failure isolation, and access to plugin navigation and integration actions.

For the external-handoff slice, verify explicit context review/copy, restricted launch targets, no hidden execution, browser and missing-app fallbacks, and truthful `contextTransferred: false` results. Opening a tool cannot mark a work item done. Selecting a project must not create or mutate an Orca workspace.

The next acceptance gate is a real work item traced through exact source lookup, confirmed project context, external acceptance, returned summary, and a separately reviewed provider-native transition. Until that workflow is demonstrated, project mapping, automatic context delivery, receipt reconciliation, and complete cross-provider query/pagination remain open work. The ordered checklist and observations belong in [the workbench direction](../design/workbench-direction.md), rather than being described as delivered features.

The overview remains usable in a normal browser and the optional Electron host, with honest native-launch fallback. Preserve CLI and MCP entry points. Stop expanding general Agent hosting, remote delivery, repository review, a competing launcher, or freeform dashboard layout. Evaluate the desktop shell through repeated project/provider handoffs before changing packaging or migrating user data.
