# Own imported workspaces

Craft Hub converts external workspace documents into its own editable Workspace manifests and Workspace Groups through an explicit, one-time import. It does not continuously project or synchronize repository-owned `.code-workspace` files: keeping one user-owned source of truth enables consistent editing and ordering, avoids two conflicting Workspace models, and keeps routine UI changes out of project repositories; users can re-import deliberately when an external document changes.
