# Security policy

## Supported versions

Craft Hub is currently in alpha. Security fixes are applied to the latest prerelease and the `main` branch; older alpha builds are not supported.

## Reporting a vulnerability

Please use **Security → Report a vulnerability** on the GitHub repository to submit a private security advisory. Do not open a public issue for suspected vulnerabilities.

Include the affected version or commit, reproduction steps, expected impact, and any suggested mitigation. Reports involving project-trust bypasses, command or argument injection, path traversal outside a registered Project, unsafe Marketplace Plugin installation, or exposure of local project data are especially useful.

The maintainer will acknowledge a report as soon as practical, coordinate validation and remediation privately, and credit reporters who want to be named. Please allow time for a fix to be released before publishing details.

## Security model

Capability discovery is read-only. Projects start untrusted, and execution uses a structured command plus argument list with `shell: false`. Marketplace packages are installed without lifecycle scripts and are validated for integrity and declared permissions. A report that shows any of these boundaries can be bypassed should be treated as a security issue.
