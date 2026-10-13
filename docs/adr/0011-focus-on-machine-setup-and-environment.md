# Focus the personal workbench on software and environment readiness

Date: 2026-10-09. Status: user-defined product direction; the roadmap proposes the first implementation slice.

Craft Hub's primary workflow is preparing and using a personal machine: inspect software and development environments, choose missing tools, review setup changes, restore selected configuration, and open tools for daily work. This refines the work-item-first home in [ADR 0010](./0010-personalize-the-persistent-workbench-overview.md); existing project, integration and handoff views remain available.

Craft Hub owns presentation and orchestration. Workstation remains the backend for managed configuration interpretation, plans, writes, backups and synchronization; new software and environment contracts should extend that boundary. Package managers perform installations. Application opening and startup before dependencies exist belong to the desktop host. Folding Workstation into a second Craft Hub implementation would duplicate ownership and break its independent CLI use.

A setup workbench must open on a machine without Node or Workstation. Keep the existing Electron default while the first workflow is validated. A lightweight host must provide an independent bootstrap view before it can rely on external Node. Small package size remains a goal, but cannot require users to prepare the environment before opening the tool that prepares it.

The [implementation roadmap](../design/machine-workbench-direction.md) records existing functionality, missing interfaces and staged acceptance. This decision does not install software, apply configuration, migrate credentials, remove existing callers or claim the proposed workflow is implemented.
