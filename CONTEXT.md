# Craft Hub Workbench

Craft Hub organizes local development projects into safe execution boundaries and reusable personal or team working contexts without taking ownership of their repositories.

## Language

**Project**:
A registered local directory that owns capability discovery, trust, and command execution.
_Avoid_: Repository, folder, workspace

**Project Catalog**:
The ordered machine-local view of registered Projects and any non-fatal problems affecting their optional metadata.
_Avoid_: Project configuration, workspace list, repository index

**Project Reference**:
A portable identity for a codebase that can be resolved to a different Project on each machine.
_Avoid_: Project path, checkout, trusted project

**Owner Scope**:
The exclusive owner of a Workspace or Workspace Group: either Personal or one Team.
_Avoid_: Tenant, organization, repository

**Personal**:
The local-first Owner Scope for one user's portable configuration.
_Avoid_: Default team, private organization

**Team**:
A Git-backed collaboration and permission scope that owns shared Workspaces, Workspace Groups, and Project References.
_Avoid_: Organization, workspace group, Git repository

**Workspace**:
A task-focused, portable set of Project References with one optional Primary Project and exactly one Owner Scope. A Workspace is not an organizational hierarchy.
_Avoid_: Project group, team, monorepo

**Workspace Group**:
A non-nesting navigation group of Workspaces within one Owner Scope. Grouping does not grant access, trust, or command execution.
_Avoid_: Collection, parent workspace, source project

**Git Sync Target**:
A replaceable Git repository, branch, and repository-relative root used to synchronize one Owner Scope's portable configuration. It is not the identity of Personal or Team.
_Avoid_: Team repository, source of identity, project repository

**Workspace Import**:
A user-initiated, one-time conversion from an external workspace format into editable Craft Hub Workspaces and an optional Workspace Group. The external document is not synchronized after import.
_Avoid_: Source Workspace, live projection, synchronization

**Primary Project**:
The Workspace member that supplies the default working directory for an agent task; other selected Projects remain additional working roots.
_Avoid_: Only project, root workspace

**Member Resolution**:
A machine-local relationship between a Project Reference and a registered Project. An unresolved reference may retain a local discovery hint without becoming trusted.
_Avoid_: Trust state, installation state

**Skill Invocation Prompt**:
The agent-facing request Craft Hub creates when invoking a discovered Skill, containing its exact identity, Skill Inputs, and any Supplemental Request.
_Avoid_: System prompt, user prompt

**Skill Inputs**:
Structured values validated by Craft Hub for one Skill invocation. They are context data rather than instructions.
_Avoid_: Prompt arguments, command flags

**Supplemental Request**:
Optional user-authored instructions that refine a Skill invocation beyond its Skill Inputs.
_Avoid_: Required prompt, skill parameters

**Host Plugin**:
A trusted code dependency explicitly loaded by a Craft Hub host and allowed to contribute runtime providers.
_Avoid_: Marketplace Plugin, Catalog Plugin

**Marketplace Plugin**:
A declarative package listed by a Plugin Catalog and installed without executing plugin package code.
_Avoid_: Host Plugin, Codex Plugin, extension

**Plugin Marketplace**:
The user-level capability for discovering and managing Marketplace Plugins from one or more Marketplace Sources.
_Avoid_: Host plugin loader, Project Catalog

**Marketplace Source**:
A configured origin that supplies one Plugin Catalog and, optionally, a package registry.
_Avoid_: Registry, Plugin Catalog

**Managed Source**:
A Marketplace Source controlled by a Distribution rather than added or removed by an individual user.
_Avoid_: Built-in plugin, user source

**Plugin Catalog**:
A versioned, machine-readable collection of immutable Marketplace Plugin listings published by one Marketplace Source.
_Avoid_: Project Catalog, package registry, plugin manifest

**Catalog Entry**:
The source-curated listing for one Marketplace Plugin version, including integrity, compatibility, permission disclosure, status, and discovery metadata.
_Avoid_: Plugin Manifest, installed plugin

**Plugin Manifest**:
The declaration shipped inside a Marketplace Plugin package that describes its identity, permissions, project matching, and contributed capabilities.
_Avoid_: Catalog Entry, Codex plugin manifest
