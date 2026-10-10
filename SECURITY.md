# Security

Tab Steer acts inside a real browser session, so security reports are taken seriously.

## Reporting

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue for something exploitable.

Include what you did, what happened, and the browser and Tab Steer versions. You will get a reply within 7 days. Fixes for confirmed issues are released before details are published, and reporters are credited unless they prefer otherwise.

## Scope

In scope: anything that lets a web page, another local user, or the agent itself get around the limits described in [docs/threat-model.md](docs/threat-model.md) — for example reaching a tab that is not shared, a site that is not allowed, a password field's value, or the socket.

Out of scope: an agent misusing access the user granted it. That is the residual risk the threat model describes.

## Supported versions

Only the latest release.
