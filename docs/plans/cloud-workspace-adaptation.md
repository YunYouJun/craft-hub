# Cloud workspace adaptation

Status: design agreed; implementation started with explicit host capability metadata and directory-operation guards. Online project records, complete synchronization, remote devices and deployment remain pending. This plan extends the existing workspace source and Git snapshot features. A manually exported configuration backup is not a complete synchronization implementation.

## Agreed boundaries

- A project has a portable repository identity, optional device-local checkout bindings, and an explicitly selected execution location. A repository subdirectory is part of the project reference when needed.
- A Team describes ownership, not a mandatory Git synchronization target. Restoring a Team does not require configuring a separate repository.
- Source subscriptions, user configuration backups, and Team Git targets are distinct. Updating one does not implicitly update the others.
- Shared definitions remain source-owned. Subscribers retain selected workspaces and an applied snapshot; updates require preview and confirmation. Editable copies are independent.
- Hosted configuration edits persist to account state first. Export to Git is an explicit preview-and-confirm action. The file-backed service is the current implementation; multi-instance hosted state requires transactional persistence.
- Personal backups include the user's authorized configuration across ownership scopes, grouping, ordering, portable project references, and subscription selections. They exclude credentials, machine paths, project execution trust, runtime caches, and private source content copied merely because it was subscribed to.
- Restore previews a merge. Stable IDs identify existing items; account-only items survive. Conflicts and deletions require explicit choices. No last-writer-wins replacement or forced push.

## Generic device architecture and downstream boundary

Remote development machines are a community capability, not a distribution-specific machine type. A development VM, physical workstation or personal computer uses the same contracts. Product names, provisioning and internal network requirements belong in downstream setup and pilots.

- **Device:** stable device ID, pairing owner, display name, online state and supported actions. A device is not a Team or a repository.
- **Project binding:** repository identity plus optional repository-relative subdirectory, mapped to a checkout on one device. Absolute paths stay with the device.
- **Task:** stable request ID, chosen device and project binding, action, authorization context and lifecycle. Submission must be idempotent; loss of acknowledgement must not trigger duplicate execution. Reconnection reconciles running task status rather than replaying new work.
- **Connection adapter:** authenticated outbound pairing/session transport, revocation, heartbeat, cancellation and event delivery. A provider-specific transport is replaceable.
- **Agent adapter:** maps a supported agent protocol to task execution and permission events. Agent provider and device selection are independent.

The community runtime owns schemas, pairing lifecycle, bindings, task semantics, authorization boundaries and host capability contracts. The web app renders those contracts. Desktop remains a thin client; a headless connector must not depend on Electron. Downstream distributions contribute repository authentication, agent integrations and optional environment provisioning without introducing their product names into core APIs.

Initial implementation: `hostEnvironment` is explicitly selected by an embedding host and reported in health metadata. Local directory binding and checkout-based synchronization affordances are unavailable on hosted instances; their directory-oriented API mutations are also rejected. This metadata is not a substitute for the hosted route allowlist, per-user authorization, project trust or a complete execution sandbox. No remote device is inferred from a hosted server process, and no remote execution capability is advertised yet.

## Stage 1: online repositories and configuration synchronization

1. Add repository-backed project records independent of local checkout registration. Adapt reads through trusted host providers using the current user's access. Lack of a checkout is normal in a hosted view, not a broken project.
2. Expose explicit host capabilities to the UI. Hosted views offer repository connection and selection. Local views offer directory location. Hide or explain unavailable local execution actions rather than routing them to the web server's filesystem.
3. Unify portable backup coverage with a versioned, validated contract for all authorized scopes and source selections. Preserve ownership and stable IDs. Support existing personal snapshots and native configuration documents without silently changing their meaning.
4. Implement preview-based restore and synchronization with base revisions. Merge non-overlapping changes into the preview; resolve overlapping changes and deletions explicitly. Revalidate both account state and remote Git head before applying or pushing.
5. Add a remote repository synchronization adapter for hosted accounts. Keep repository authorization distinct from account identity. Local checkout-based Git sync remains available locally.
6. Make Team Git targets optional in navigation and configuration. Distinguish saving account state, updating a subscription, exporting a backup, and committing/pushing Git changes in UI actions.

Acceptance:

- A fresh hosted account can connect a repository and inspect projects without a server or laptop directory.
- The user can restore a backup containing multiple ownership scopes without mandatory per-Team Git setup.
- Source selections survive export and restore without copying machine bindings or granting execution trust.
- Two devices making disjoint changes retain both changes; conflicting updates and removals remain pending until resolved.
- Concurrent remote commits cannot be overwritten by a stale preview. Unauthorized reads and expired sessions fail without falling back to another identity.
- Existing local checkout, offline snapshot, independent-copy, and trust workflows continue to work.

## Stage 2: remote development device pilot

- Start with one user-controlled development host, then expand to personal computers using the same device and task contracts.
- Devices establish outbound authenticated connections and explicit pairing. No public arbitrary shell endpoint is required.
- A task names its repository, device, checkout and requested action. An offline device cannot accept a new task in the first release; save a draft instead. Never silently move execution to another machine.
- Initially expose Git status/diff/log, authorized project commands, and agent tasks inside registered project directories. Git commit, push, branch changes and destructive cleanup remain explicit actions. Do not offer a general server administration terminal.
- Reuse supported interfaces of installed agents where practical; do not require the full desktop workbench. A running receiver and pairing are still necessary. Unverified launch protocols only get a copy-task fallback.
- Preserve per-project trust, explicit command/args, shell:false, working-directory boundaries, cancellation and status reporting. Provider modes that bypass these requirements cannot silently inherit the workbench's trust guarantees.

## Later: hosted agent execution

- Agent provider and execution location are independent choices.
- Use officially supported API credentials or OAuth, isolated per account and revocable. Never place them in Git configuration backups.
- Execute in isolated workspaces with separate repository authorization. Return results and patches before explicit publication actions. A model credential never grants access to a user's laptop.

## Delivery and validation

Implement Stage 1 before enabling remote execution. Keep distribution-specific repository hosts, identity systems and agents downstream. Add integration coverage for authorization, preview conflicts, restore preservation and capability-driven UI. Run public-boundary checks, lint, type checks, runtime tests, builds, and browser acceptance in local and hosted modes before handoff. Deployment is a separate verified step; this design document does not mark these features as shipped.
