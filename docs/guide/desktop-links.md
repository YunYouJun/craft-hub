# Desktop Links

An online page or local integration can ask an installed Craft Hub desktop app to show a specific navigation target. Use an ordinary anchor so the browser and operating system remain in control:

```html
<a href="craft-hub://open?v=1">Open in Craft Hub</a>
```

The `open` link accepts the optional views `home`, `marketplace`, and `settings`:

```text
craft-hub://open?v=1&view=marketplace
craft-hub://open?v=1&view=settings
```

Open a Workspace by its stable ID:

```text
craft-hub://workspace?v=1&id=product-team
```

For a Team-owned Workspace, include its owner scope so Craft Hub can switch scopes before selecting it:

```text
craft-hub://workspace?v=1&id=release&scope=team-platform
```

To locate a Project, pass its credential-free HTTPS Git remote and, for a monorepo package, an optional repository-relative subdirectory:

```text
craft-hub://project?v=1&repo=https%3A%2F%2Fgithub.com%2FYunYouJun%2Fcraft-hub&subdir=apps%2Fweb
```

Append a capability ID to open its detail after resolving the Project:

```text
craft-hub://project?v=1&repo=https%3A%2F%2Fgithub.com%2FYunYouJun%2Fcraft-hub&capability=command%3Adev
```

Craft Hub compares the normalized `origin` and subdirectory with current registered Projects. One match opens directly. Multiple matches require a choice. When no Project matches, the user can choose an existing local checkout; Craft Hub verifies it first and registers it only after confirmation. Registration remains untrusted.

Desktop Links are deliberately navigation-only. Version 1 does not accept commands, local paths, trust changes, cloning, fragments, repeated parameters, or unknown parameters. The production application owns `craft-hub://`; local development uses `craft-hub-dev://` so it cannot replace the installed handler.

Browsers do not reliably reveal whether a custom-protocol application opened. Keep the anchor usable without JavaScript, and if helpful reveal an installation or troubleshooting link after a short delay. Do not claim that the application is missing based on that timeout.

## Opening Codex

Craft Hub exposes two distinct Codex actions. **New task in Codex** launches the selected project in Codex and copies the prepared prompt so the user can review and send it. **Run in Craft Hub background** uses the Codex SDK, keeps the task and streamed output in Craft Hub, and offers an **Open in Codex** action after the task stops running.

Opening an existing task uses the `codex://threads/<thread-id>` application link as a best-effort compatibility bridge. It is not part of the public Codex App Server protocol, so Craft Hub must not depend on it for persistence or execution. If the installed Codex version cannot handle the link, the task remains readable in Craft Hub. Integrations that need a supported embedded conversation UI should use the [Codex App Server](https://learn.chatgpt.com/docs/app-server).
