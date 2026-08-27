# Craft Hub Workbench

Craft Hub organizes local development projects into safe execution boundaries and reusable personal or team working contexts without taking ownership of their repositories.

## Language

**Project**:
A registered local directory that owns capability discovery, trust, and command execution.
_Avoid_: Repository, folder, workspace

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
