# Threat model

Tab Steer gives a program control over pages in a browser where you are logged in. This document says what it protects, how, and what it does not protect.

## Who might attack

| Attacker | What they want |
| --- | --- |
| A web page you visit | To send commands to Tab Steer, or read other tabs through it |
| Another user on the same machine | To use your browser session |
| A page the agent reads (prompt injection) | To make the agent act against you in your session |
| The agent itself, mistaken or manipulated | To reach tabs, sites or data you did not intend to share |

## Protections

**Web pages cannot reach Tab Steer.** There is no HTTP or WebSocket listener. The only entry point is a Unix socket in `~/.tabsteer` (directory mode 700, socket mode 600). The native host accepts connections from the extension IDs listed in its manifest only. The extension accepts control messages from its own pages only.

**Other local users cannot reach it.** File permissions on the directory and socket restrict access to your user. Logging is off by default and never records page content.

**The agent is confined by state only you can change.** All of these live in the browser, not in files the agent could edit:

- *Shared tabs.* Commands work only on tabs in the "Tab Steer" tab group.
- *Allowed sites.* The extension ships with no site access. Each site is granted through Chrome's permission prompt, which requires a click in the extension's own window. Without the grant the extension cannot read or script the page, and cannot even see its URL.
- *Pause.* When paused, every command except `status` is refused.

**Sensitive values are withheld.** `read` and `type` never return the value of password, payment or one-time-code fields.

**No arbitrary code execution.** There is no `eval` command, and navigation is limited to `http` and `https` URLs. Everything the extension runs in a page is fixed code shipped in the extension.

**Clicks are deliberate.** A text target that matches more than one element is refused with a list of candidates. Refs are bound to one document, so a ref from an earlier page can never resolve to an element on a later one.

## What it does not protect against

**An agent with shell access runs as you.** It can already read your files and run programs. Tab Steer limits what it can do *through the browser*; it is not a sandbox for the agent.

**Prompt injection.** Text on a page can be written to look like instructions. Tab Steer cannot tell whether the agent is following your wishes or a page's. On an allowed site in a shared tab, the agent can do whatever you could do with a mouse and keyboard. Reduce the exposure: allow sites one at a time rather than all sites, do not share tabs for banking or account-recovery email alongside tabs showing untrusted content, and use an agent that asks before irreversible actions.

**Opening pages.** The agent may open or navigate a shared tab to any `http(s)` URL, including on sites it is not allowed to read. A request made that way carries your cookies, as it would if you clicked a link.

**Screenshots.** `snap` captures whatever the shared tab shows, including anything sensitive visible on it.

**Other extensions and malware.** Software already running as you is outside this model.

## Design choices that follow from this

- Policy is never read from disk, because the agent can write to disk.
- The CLI has no command to share a tab the user already has open, allow a site, or resume from pause.
- Features that widen access (trusted input through the debugger API, script evaluation) will be opt-in, per site, and granted from the extension's own window.
