# Privacy

Tab Steer collects nothing and sends nothing to its authors or to any third party. There is no telemetry, no analytics and no remote server.

**What the extension handles.** When a command is run, the extension reads content from tabs you have shared, on sites you have allowed, and passes it to the `tabsteer` program on your own computer. That content can include page text, link addresses, form values (except password, payment and one-time-code fields) and screenshots.

**Where it goes.** To the local program that asked for it, over a private socket on your machine. What that program, typically an AI agent, does with it is governed by that program's own privacy terms.

**What is stored.** In the browser's extension storage: whether Tab Steer is paused, the sites you allowed, and whether every site is allowed. In session storage, which the browser clears when it closes: a list of recent agent actions for the Activity panel, with no typed text and no full addresses. Diagnostic logging is off by default; when you turn it on, it records command names and times in `~/.tabsteer/host.log`, never page content.

**Your controls.** Unshare a tab, revoke a site, pause, or remove the extension at any time. `tabsteer uninstall` removes everything outside the browser.
