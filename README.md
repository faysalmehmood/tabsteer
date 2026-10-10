# Tab Steer

**Hand your coding agent a tab, not your browser.**

Tab Steer lets any agent that can run a shell command — Claude Code, Antigravity, Codex, Cursor, or a plain script — read and control pages in your real, logged-in Chrome. It can only touch the tabs you share and the sites you allow, and you can pause it with one click.

```console
$ tabsteer open news.ycombinator.com
Opened tab 1853312301
$ tabsteer read
# Hacker News
[new](newest) @kq2 | [past](front) @kq3 | [comments](newcomments) @kq4 ...
$ tabsteer click @kq2
Clicked link "new" @kq2
```

> **Status: 0.1, early.** macOS and Linux, Chromium-family browsers. Not yet on the Chrome Web Store; you load the extension unpacked.

## Why

Browser tools built on MCP put dozens of tool definitions into the model's context on every turn, and usually drive a separate, logged-out browser. Tab Steer is a command-line program instead: it costs nothing in context until it is called, and it works in the browser where you are already signed in.

That second part is also the risk, so the design starts from limits:

- **Shared tabs only.** The agent acts only on tabs in a tab group named "Tab Steer". Drag a tab in to share it, drag it out to stop.
- **Allowed sites only.** The extension is installed with access to no sites. You grant each site (or all sites) from the toolbar icon. The agent cannot grant itself access.
- **Pause.** One button stops every command until you resume.
- **No network surface.** The CLI talks to the browser over a Unix socket only your user can open. Nothing listens on a port.
- **No secrets in output.** Password and payment field values are never returned.
- **No arbitrary code.** There is no `eval` command.
- **No telemetry.** Nothing is collected or sent anywhere. See [docs/PRIVACY.md](docs/PRIVACY.md).

Read [docs/threat-model.md](docs/threat-model.md) before using it on accounts that matter. In particular: web pages can contain text written to manipulate an agent, and an agent acting in your session acts as you.

## Install

Requires Node.js 18 or newer.

```sh
git clone https://github.com/faysalmehmood/tabsteer.git
cd tabsteer
./install.sh                    # add --agent claude or --agent antigravity to install the skill
```

Then, once, in the browser:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension` folder of this repository.
3. Run `tabsteer doctor`. Every line should have a tick.

`./install.sh` registers a native messaging host for each Chromium-family browser it finds, and links `tabsteer` into `~/.local/bin`. `tabsteer uninstall` removes all of it.

## Use

Share a tab: click the Tab Steer toolbar icon on it and choose **Share this tab with your agent**. Or let the agent open its own with `tabsteer open <url>`; you will still need to allow the site the first time.

| Command | What it does |
| --- | --- |
| `tabsteer status` | Connection state, paused or not, number of shared tabs |
| `tabsteer tabs` | List shared tabs with their ids |
| `tabsteer open <url> [--background]` | Open a URL in a new shared tab |
| `tabsteer navigate <url>` | Load a URL in a shared tab |
| `tabsteer back` / `close` | Go back one page / close a shared tab |
| `tabsteer read [--offset N] [--limit N]` | Page as Markdown; every control carries a ref like `@kq12` |
| `tabsteer click <ref\|text\|css=sel>` | Click one element. Ambiguous text returns candidates instead of guessing |
| `tabsteer type <text> [--into <ref>]` | Replace a field's content, or choose a `<select>` option |
| `tabsteer press <key> [--into <ref>]` | Enter, Tab, Escape, Space, arrows, or a single character |
| `tabsteer scroll [up\|down\|top\|bottom] [px]` | Scroll the page |
| `tabsteer wait <text\|ref\|css=sel> [--gone] [--timeout ms]` | Wait for something to appear or disappear |
| `tabsteer snap [--out file.png]` | Screenshot the visible part of the tab |

`--tab <id>` picks a tab when several are shared. `--json` prints raw results.

### Teaching your agent

`skills/tabsteer/SKILL.md` is a ready-made skill. `tabsteer install --agent claude` or `--agent antigravity` copies it into place. For other agents, paste [docs/agent-snippet.md](docs/agent-snippet.md) into the project's `AGENTS.md` or rules file.

## Known limits

- Clicks and keys are simulated in the page, so sites that require trusted input events may ignore them. Enter submits forms and activates buttons; other keys may not trigger default behaviour.
- Cross-origin iframes and closed shadow roots are not readable.
- One browser profile at a time: the most recently started profile owns the connection.
- Windows is not supported yet.

## Use it responsibly

Some websites prohibit automated access in their terms, and may restrict accounts that use it. You are responsible for the sites you point Tab Steer at. Prefer a site's official API where one exists. Tab Steer has no features for evading bot detection and will not add any.

## How it works

```
agent ── runs ──▶ tabsteer (CLI)
                     │  Unix socket, ~/.tabsteer, mode 600
                     ▼
              native messaging host   ◀── launched by the browser
                     │  stdio
                     ▼
              Tab Steer extension ──▶ shared tabs on allowed sites
```

The reasoning behind this shape is in [docs/decisions.md](docs/decisions.md).

## Development

```sh
npm install
npm test                 # host and CLI
npx playwright install chromium
npm run test:e2e         # real Chromium with the extension loaded
```

## Credits

The idea of a CLI-first controller for the user's real browser was shown publicly by Ivan Leo, building on the approach of the OpenAI Codex Chrome extension. Tab Steer is an independent implementation and is not affiliated with or endorsed by Google, OpenAI, Anthropic or anyone named here.

## License

[Apache-2.0](LICENSE)
