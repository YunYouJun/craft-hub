# Example developer configuration source

This template publishes separate declarations:

- `.craft-hub/project.jsonc`: metadata for this repository.
- `.craft-hub/source.jsonc`: portable workspace members for Craft Hub subscriptions.
- `projects.yaml`: checkout groups for Workstation.
- `software.config.ts`: literal software metadata for the software center.

Copy the declarations you need and replace example names and URLs. Add environment configuration through Workstation's existing workflow.

Follow the [repository integration convention](https://github.com/YunYouJun/craft-hub/blob/main/docs/guide/repository-format.md). With Craft Hub, the trusted Host Plugin and a Workstation CLI supporting `validate-projects` already installed, run:

```sh
craft-hub repo:validate . --json \
  --host-plugin @craft-hub/craft-hub-plugin-workstation
```
