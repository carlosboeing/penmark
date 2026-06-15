# Security Policy

## Supported versions

Penmark is pre-1.0 and local-first (sideloaded VSIX). Only the latest released
version receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.5.x   | Yes       |
| < 0.5   | No        |

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues,
pull requests, or discussions.

Report privately through GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Select **Report a vulnerability** under **Advisories**.
3. Provide a description, reproduction steps, affected version, and impact.

If you cannot use private reporting, email **carlosboeing@gmail.com** with the
same detail and `Penmark security` in the subject.

You can expect an initial acknowledgement within 7 days. Once a report is
triaged, the fix and disclosure timeline will be coordinated with you before any
public advisory is published.

## Scope

Penmark renders untrusted markdown inside a webview. Issues of particular
interest include sandbox or Content-Security-Policy bypasses, sanitization
gaps that allow script execution (the render pipeline uses DOMPurify behind a
nonce CSP), and any path that lets document content reach the extension host
outside the versioned message protocol. Findings in third-party dependencies
should be reported to the upstream project; report them here only when Penmark's
usage makes them exploitable in a way upstream would not address.
