# Project space and maintenance

Craft Hub owns project context and project-declared maintenance commands. Augma owns system disk cleanup, shared tool caches and simulator maintenance. Neither application needs the other installed for its core workflow. This feature adds no deletion engine or system-wide cleanup rules to Craft Hub.

## Workflow

Open a project overview → **Space and maintenance** → **Analyze space**. Analysis starts only on request and remains available for untrusted projects because it reads file metadata without executing project code. The result shows measured logical bytes, directory-name categories, the twelve largest top-level entries, a timestamp and incomplete scope. **Scan again** refreshes the snapshot; nothing polls or persists scan results in the background.

**Project maintenance** lists discovered commands whose names contain a delimited `clean` or `cleanup` token. Choosing one opens the existing capability detail, including package context. Trust, exact invocation review, parameters, execution and logs continue through the existing command flow. A directory category never grants permission to remove it. Commands may affect more than the scanned directory; review their declaration before execution.

## Runtime contract

`GET /api/projects/:projectId/space` accepts only a registered project ID, with no query parameters, extra path or write method. The local same-origin and host-session checks apply; hosted runtimes reject inspection. Results use `Cache-Control: no-store`. The endpoint is not added to the read-only Agent project grant.

`CraftHubRuntime.projectSpace` owns at most two concurrent scans and one per project. Client disconnect aborts its scan; runtime shutdown aborts and awaits all active scans. The browser also discards late results after cancel, navigation or project changes. No shared-runtime process ownership or Augma transport changes are needed.

The metadata walker stays within the canonical registered root, excludes symlinks, special files and other volumes, and deduplicates regular files by device/inode. The outermost recognized directory category wins, so dependencies containing build outputs are counted once. Git worktree pointers are ordinary files; external Git data is not followed.

Production budgets are 50,000 entries, five seconds checked between filesystem operations and 48 nested directory levels. These checks do not forcibly interrupt an individual stalled filesystem call. Diagnostics and top-level entries are each capped at twelve, with omitted counts. Limits, permission failures and changed paths produce a partial result; unmeasured content is never represented as complete zero usage.

Sizes are logical file lengths, excluding directory allocation. They are neither allocated disk bytes nor reclaimable space; APFS clones, sparse files and compressed files can differ substantially. Metadata revalidation is best effort, not an atomic filesystem snapshot. Classifications are navigation hints based on directory names, not evidence that content is generated, unused or safe to delete.

## Verification

Scanner fixtures cover nested packages and category overlap, hard-link deduplication, internal/external/cyclic symlinks, changed roots, permission errors, bounded reports, scan limits and cancellation. Runtime/HTTP tests cover untrusted discovery without execution, local/hosted access, cross-origin/rebinding rejection, arbitrary-path rejection, cancellation on disconnect and fresh scans after cancellation. UI tests cover explicit scanning, partial accounting, command review without execution, errors/retry, cancellation, project switching, unmount and unavailable states.
