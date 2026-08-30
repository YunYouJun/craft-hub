# Desktop Links

An online page can ask an installed Craft Hub desktop app to show the Workbench or one Project. Use an ordinary anchor so the browser and operating system remain in control:

```html
<a href="craft-hub://open?v=1">Open in Craft Hub</a>
```

To locate a Project, pass its credential-free HTTPS Git remote and, for a monorepo package, an optional repository-relative subdirectory:

```text
craft-hub://project?v=1&repo=https%3A%2F%2Fgithub.com%2FYunYouJun%2Fcraft-hub&subdir=apps%2Fweb
```

Craft Hub compares the normalized `origin` and subdirectory with current registered Projects. One match opens directly. Multiple matches require a choice. When no Project matches, the user can choose an existing local checkout; Craft Hub verifies it first and registers it only after confirmation. Registration remains untrusted.

Desktop Links are deliberately navigation-only. Version 1 does not accept commands, local paths, trust changes, cloning, fragments, repeated parameters, or unknown parameters. The production application owns `craft-hub://`; local development uses `craft-hub-dev://` so it cannot replace the installed handler.

Browsers do not reliably reveal whether a custom-protocol application opened. Keep the anchor usable without JavaScript, and if helpful reveal an installation or troubleshooting link after a short delay. Do not claim that the application is missing based on that timeout.
