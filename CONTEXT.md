# Craft Hub Workbench

Craft Hub brings software, development environments and configuration migration into a personal workbench, while preserving local execution boundaries and personal or team working contexts.

## Language

**Software Item**:
An identified application or command-line tool with installation sources and relevant local availability. It is distinct from a plugin or a website shortcut.
_Avoid_: Marketplace Plugin, bookmark, arbitrary install command

**Environment Snapshot**:
An observation of this machine's tools, versions, locations and configuration readiness. It describes actual state rather than a desired setup.
_Avoid_: Setup Profile, portable environment, complete environment variables

**Setup Profile**:
A portable selection of desired Software Items and configuration sources for a purpose. It does not contain machine-local paths, login sessions or observed installation state.
_Avoid_: Workspace, machine backup, Environment Snapshot

**Configuration Migration**:
A reviewed restoration of selected configuration from its managed sources onto a machine. Software installation, account sign-in and project trust remain separate outcomes.
_Avoid_: Full machine clone, automatic overwrite, application installation

**Work Item**:
A unit of work whose identity, assignment and workflow state belong to its connected source. A Craft Hub preview does not become a separate authoritative task.
_Avoid_: Agent task, local execution, copied todo

**Work Handoff**:
A reviewed package of source identity, explicitly selected Project context and the user's objective for an external tool. Preparing or copying it does not establish that the destination received or executed it.
_Avoid_: Task dispatch, agent session, completed work

**External Tool Launch**:
A user-initiated request to open an application or invoke a configured external command. A successful launch is distinct from context reception and work completion.
_Avoid_: Work Handoff receipt, task execution, status update

**Project**:
A registered local directory that owns capability discovery, trust, and command execution.
_Avoid_: Repository, folder, workspace

**Project Catalog**:
The ordered machine-local view of registered Projects and any non-fatal problems affecting their optional metadata.
_Avoid_: Project configuration, workspace list, repository index

**Project Reference**:
A portable identity for a codebase that can be resolved to a different Project on each machine.
_Avoid_: Project path, checkout, trusted project

**Desktop Link**:
A versioned, navigation-only request that asks an installed Craft Hub desktop host to show the Workbench or one Project Reference.
_Avoid_: Command link, execution URL, trust link

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

**Plugin Pack**:
A named selection of Marketplace Plugins offered for installation together. Each included plugin retains its own identity, permissions and lifecycle, and may belong to more than one pack.
_Avoid_: Feature pack, single plugin, Host Plugin

**Plugin Marketplace**:
The user-level capability for discovering and managing Marketplace Plugins from one or more Marketplace Sources.
_Avoid_: Host plugin loader, Project Catalog

**Marketplace Source**:
A configured origin that supplies one Plugin Catalog and, optionally, a package registry.
_Avoid_: Registry, Plugin Catalog

**Managed Source**:
A Marketplace Source supplied and controlled by a Distribution rather than added or removed by an individual user. The UI may present this as enterprise-managed; Catalog validation remains a separate state.
_Avoid_: Built-in plugin, user source, verified source, intranet-authenticated source

**Publisher Verification**:
A cryptographic assertion that fetched Plugin Catalog bytes were signed by the organization named in a host-provisioned Trust Policy. It does not make a Marketplace Source managed or grant execution trust.
_Avoid_: Catalog validation, Managed Source, login authentication

**Trust Policy**:
A host-provisioned association between one Plugin Catalog location, an organization, and its public signing key.
_Avoid_: Import parameter, user preference, login session

**Plugin Catalog**:
A versioned, machine-readable collection of immutable Marketplace Plugin listings published by one Marketplace Source.
_Avoid_: Project Catalog, package registry, plugin manifest

**Catalog Entry**:
The source-curated listing for one Marketplace Plugin version, including integrity, compatibility, permission disclosure, status, and discovery metadata.
_Avoid_: Plugin Manifest, installed plugin

**Plugin Manifest**:
The declaration shipped inside a Marketplace Plugin package that describes its identity, permissions, project matching, and contributed capabilities.
_Avoid_: Catalog Entry, Codex plugin manifest

**Workspace Source**:
A publisher-maintained collection of portable Workspaces available from a repository location. Its author and visibility do not grant local execution trust.
_Avoid_: Team, checkout, personal configuration

**Workspace Subscription**:
A user's selection of Workspaces from a Workspace Source, viewed at the last applied source revision. Independent copies stop following that source.
_Avoid_: One-time import, project installation, repository authorization

**Workspace Source Catalog**:
A discoverable index of Workspace Sources available to the current audience. Inclusion in a catalog does not grant permission to read the source repository.
_Avoid_: Plugin Catalog, repository ACL, workspace snapshot
