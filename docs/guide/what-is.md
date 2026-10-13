# What is Craft Hub?

Craft Hub is a personal software and development-environment workbench. Its product direction combines software setup, everyday tool access, environment checks and reviewed configuration migration. The current alpha provides the personal overview, local tool inspection, project capabilities, tool handoff and configuration review; software installation and a machine-readiness home are planned, not delivered.

Use Raycast for quick actions and extension commands. Use Orca or your preferred coding workbench for agent conversations, worktrees, terminals and code review. Craft Hub's proposed home answers what is installed, what is missing, whether the environment works, and which reviewed setup step comes next. Existing Workstation integration handles configuration review and synchronization; selected software installation and project-specific toolchain diagnostics need additional interfaces. See the [machine workbench roadmap](../design/machine-workbench-direction.md).

Open **Local environment** (`/environment`) to inspect Git, Node.js, pnpm, fnm, Homebrew and Workstation on the local API host. It reports versions, executable paths, search sources and per-tool failures, with the backend Node shown separately. Checks run only when this page opens or is refreshed. A missing result means the workbench search did not find the tool; hosted workbenches cannot inspect the browser user's machine. Software installation remains planned.

The current `/overview` still brings work items from connected providers and local project context together. These views remain useful alongside the proposed setup workflow.

The overview previews real assigned, unfinished work through declared read-only `work-items.list` actions. Provider identity and failures stay separate; partial results are labeled as previews. State updates remain in the provider's integration view with required fields, validation and confirmation. Craft Hub does not create a second task database.

Choose **Prepare handoff** on a work item or project, explicitly select the local project, add an objective, and review the context before copying it. Paste it in your external tool and start work there. Opening an application does not submit the task, confirm context reception, or change the provider's status.

Tool entries keep HTTPS website destinations. In the macOS desktop, optional Raycast and Orca presets open the installed application; Raycast may target a configured command deeplink copied from an installed command. This first version rejects URL parameters and unsupported protocols. A configured Raycast command may perform its own actions; handoff context is not automatically sent. Orca launches without a project or prompt. Browsers open websites, and application launch failure is reported as a website fallback. Neither application is a required runtime dependency.

Home preferences are stored under `workbench.home` in the operating-system settings file. Tool edits and local project pins survive restart. Project IDs depend on local paths, so portable settings export currently excludes these preferences.

Project Palette continues to discover commands and skills without executing project code. Structured command execution requires explicit project trust. Configuration review, diagnostics, CLI, local API, MCP and the optional Electron host share the runtime. Existing internal task callers remain during migration, and Agent connection currently grants scoped read access rather than execution or business writes.

See the [machine workbench decision](../adr/0011-focus-on-machine-setup-and-environment.md), [earlier overview and host experiments](../design/workbench-direction.md) and [coding-feature migration plan](../adr/0009-focus-on-project-capabilities-and-integrations.md).
