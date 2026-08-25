# Project configuration

Configuration is optional. Add `.craft-hub/project.yaml` only when a repository needs metadata or wants to hide discovered capabilities.

```yaml
version: 1
project:
  name: Craft Hub
  icon: ./icon.svg
defaults:
  agent: codex
capabilities:
  hidden: []
```

Hidden entries may be a capability name, capability id, or a source-qualified name such as `package.json:release`.
