# Design decisions

## Extension plus native messaging, not the remote-debugging port

Chrome can be driven without any extension by attaching to its remote-debugging port, which is how Chrome DevTools MCP's `--autoConnect` works. That route has less to maintain and gives trusted input events.

Tab Steer uses an extension anyway because debugging access is all-or-nothing: it reaches every tab and every site. The point of this project is a narrower grant — some tabs, some sites, revocable in one click — and only an extension can enforce that with state the agent cannot change.

## A CLI, not an MCP server

A CLI costs no context until it is used and works with any agent that can run a command. The cost is that each agent needs a short description of the commands, which `skills/` provides.

## Tab group as the sharing boundary

Sharing needed to be visible at all times and changeable without opening a settings page. A tab group is both: it is drawn in the tab strip, and dragging a tab in or out is the grant.

## Site access through Chrome's own permission prompt

`optional_host_permissions` means the browser, not Tab Steer, enforces site access, and the grant needs a user gesture in the extension's window. It also keeps the install-time permission warning minimal.

## Policy lives in the browser

The agent has a shell and can edit files, so nothing that limits the agent is read from disk.

## Simulated input first

Clicks and keys are dispatched as DOM events from an isolated content-script world. This needs no extra permission and no "being debugged" banner. Sites that insist on trusted events will need the debugger API, planned as an opt-in.

## No `eval`

Running agent-supplied strings as code in a logged-in page is the largest single risk, and the Chrome Web Store only permits it through the debugger or user-scripts APIs. It is left out until it can be offered as an explicit, per-site opt-in.

## Zero runtime dependencies

The host and CLI use only Node's standard library, so there is no dependency supply chain between the agent and your browser.
