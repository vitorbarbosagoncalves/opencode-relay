# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them via [GitHub's private vulnerability reporting](https://github.com/vitorbarbosagoncalves/opencode-relay/security/advisories/new).

You can expect:
- **Acknowledgement** within 48 hours
- **Status update** within 7 days
- **Fix or mitigation** as soon as possible, typically within 30 days for critical issues

We follow [Responsible Disclosure](https://en.wikipedia.org/wiki/Responsible_disclosure) — please give us a reasonable window before any public disclosure.

## Scope

This project is a local daemon that reads and writes config files on your machine. It does not make outbound network requests by design. Security considerations include:

- Path traversal when resolving config file paths
- Unsafe deserialization of config values
- Environment variable leakage via `{env:VAR}` template resolution
- Privilege escalation via symlink attacks on watched files
