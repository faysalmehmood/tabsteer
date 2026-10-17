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
- *Allowed sites.* Tab Steer is turned on once through Chrome's own permission prompt, which lets the extension reach websites. The agent still reaches only sites on the user's allowed list, kept in the extension's storage. Sites are added by sharing a tab or clicking Allow in the popup, and removed in the popup or the Activity panel. Code in web pages cannot read or change that storage. The temporary access Chrome gives when the toolbar icon is clicked counts for nothing.
- *Pause.* When paused, every command except `status` is refused, and the result of any command already running is discarded.

**The user can see what happened.** The Activity panel lists every command, including refused ones. It keeps no typed text and no full addresses, and is cleared when the browser closes.

**Sensitive values are withheld.** `read` and `type` never return the value of password fields, or of fields recognised as payment or one-time-code fields by their type, autocomplete hint, name or label. Recognition of the last two is a best effort. CSS selectors that test field values are refused, so values cannot be guessed one character at a time.

**No arbitrary code execution.** There is no `eval` command, and navigation is limited to `http` and `https` URLs. Everything the extension runs in a page is fixed code shipped in the extension.

**Clicks are deliberate.** A text target that matches more than one element is refused with a list of candidates. Refs are bound to one document, so a ref from an earlier page can never resolve to an element on a later one.

## What it does not protect against

**An agent with shell access runs as you.** It can already read your files and run programs. Tab Steer limits what it can do *through the browser*; it is not a sandbox for the agent.

**Prompt injection.** Text on a page can be written to look like instructions. Tab Steer cannot tell whether the agent is following your wishes or a page's. On an allowed site in a shared tab, the agent can do whatever you could do with a mouse and keyboard. Reduce the exposure: allow sites one at a time rather than all sites, do not share tabs for banking or account-recovery email alongside tabs showing untrusted content, and use an agent that asks before irreversible actions.

**Opening pages.** The agent may open or navigate a shared tab to any `http(s)` URL, including on sites it is not allowed to read. A request made that way carries your cookies, as it would if you clicked a link.

**Screenshots.** `snap` captures whatever the shared tab shows, including anything sensitive visible on it. It refuses if another tab becomes visible during the capture. Chrome allows it only when all sites are allowed.

**Tabs opened from a shared tab.** Chrome places a tab opened from a link in a shared tab into the same group, so it is shared too.

**Other extensions and malware.** Software already running as you is outside this model.

## Design choices that follow from this

- Policy is never read from disk, because the agent can write to disk. The allowed-site list lives in extension storage, which only the extension's own pages can change.
- Being turned on gives the extension the technical ability to reach any site. Tab Steer's own check decides which ones the agent may use. A bug in that check would matter more than in 0.1, where Chrome enforced each site; the end-to-end tests cover it.
- The CLI has no command to share a tab the user already has open, allow a site, turn Tab Steer on, or resume from pause.
- Features that widen access (trusted input through the debugger API, script evaluation) will be opt-in, per site, and granted from the extension's own window.
