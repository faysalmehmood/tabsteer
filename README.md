<div align="center">

<img src="docs/assets/logo.svg" width="96" height="96" alt="Tab Steer logo">

# Tab Steer

**Hand your coding agent a tab, not your browser.**

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/mkpmilnglglhiaeojeeioafmbjjghmed?label=chrome%20web%20store)](https://chromewebstore.google.com/detail/tab-steer/mkpmilnglglhiaeojeeioafmbjjghmed)
[![npm](https://img.shields.io/npm/v/tabsteer.svg)](https://www.npmjs.com/package/tabsteer)
[![Tests](https://github.com/faysalmehmood/tabsteer/actions/workflows/test.yml/badge.svg)](https://github.com/faysalmehmood/tabsteer/actions/workflows/test.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[Website](https://tabsteer.conceptlix.com) · [Get started](#get-started) · [Commands](#commands) · [How you stay in control](#how-you-stay-in-control)

</div>

Tab Steer lets your coding agent (Claude Code, Antigravity, Codex, Cursor, or any tool that can run a shell command) work in your real, logged-in Chrome. It reaches only the tabs you share, on the sites you allow, and you can see and stop everything it does.

```console
$ tabsteer open localhost:5173/checkout
$ tabsteer read
# Checkout
[input:email "Email" value="" @kqzbwr4] [button "Place order" @kqzbwr9]
$ tabsteer click @kqzbwr9
Clicked button "Place order" @kqzbwr9
```

**Typical uses:** check your app after a change, read a ticket or error page that needs your login, reproduce a bug in your real session, or do repetitive work in a web console that has no API.

## Get started

You need Chrome (or another Chromium browser) and Node.js 18 or newer, on macOS or Linux.

1. **Add the extension** from the [Chrome Web Store](https://chromewebstore.google.com/detail/tab-steer/mkpmilnglglhiaeojeeioafmbjjghmed). A welcome page opens.
2. **Install the companion** in a terminal:
   ```sh
   npm install -g tabsteer && tabsteer install
   ```
3. **Turn it on and share a tab.** Click **Turn on** on the welcome page (Chrome asks once). Then, on any page, click the Tab Steer icon and choose **Share this tab with your agent**.

`tabsteer doctor` checks the setup. `tabsteer uninstall` removes everything outside the browser.

**Teach your agent:** `tabsteer install --agent claude` or `--agent antigravity` installs a ready-made skill. For other agents, paste [docs/agent-snippet.md](docs/agent-snippet.md) into `AGENTS.md` or your rules file.

## How you stay in control

<img src="docs/assets/panel.png" width="280" align="right" alt="The Tab Steer side panel: a live log of the agent's actions, including one refused attempt, and the list of allowed sites.">

- **Shared tabs only.** Your agent works only in tabs inside the "Tab Steer" tab group. Drag a tab out to stop sharing it.
- **Allowed sites only.** Sharing a tab allows its site. You can remove sites at any time, and the agent cannot add any.
- **See everything.** The Activity panel shows each action as it happens, including refused ones.
- **Pause.** One click refuses every further command and discards the result of any already running.
- **Secrets stay hidden.** Password values, and payment or one-time-code fields Tab Steer recognises, are never returned.
- **Local only.** No network listener, no telemetry, no `eval`. Page content goes only to the program on your computer that asked for it. See the [privacy policy](docs/PRIVACY.md).

Web pages can contain text written to mislead an agent, and an agent in your browser acts as you. Read the [threat model](docs/threat-model.md) before using Tab Steer on accounts that matter.

<br clear="right">

## Commands

| Command | Description |
| --- | --- |
| `tabsteer tabs` | List shared tabs |
| `tabsteer open <url>` / `navigate <url>` / `back` / `close` | Open, load, go back in, or close a shared tab |
| `tabsteer read` | The page as Markdown. Each control carries a ref such as `@kqzbwr4` |
| `tabsteer click <ref\|text>` | Click one element. Ambiguous text returns the candidates instead of guessing |
| `tabsteer type <text> --into <ref>` | Fill a field or choose a `<select>` option |
| `tabsteer press <key>` | Enter, Tab, Escape, Space, arrows, or one character |
| `tabsteer scroll [up\|down\|top\|bottom]` | Scroll the page |
| `tabsteer wait <text\|ref>` | Wait for something to appear (`--gone` to disappear) |
| `tabsteer snap` | Screenshot the visible tab |
| `tabsteer status` | Connection, pause state and shared tab count |

Add `--tab <id>` when several tabs are shared, and `--json` for raw output. `tabsteer --help` lists every option.

## Limits

- Clicks and key presses are simulated in the page, so a few sites ignore them.
- Cross-origin iframes are not readable.
- With Tab Steer in several Chrome profiles, the most recently opened profile is the one the agent controls.
- Windows is not supported yet.
- Some sites prohibit automated access in their terms. You are responsible for where you use Tab Steer; it has no features for evading bot detection.

## How it works

The `tabsteer` command talks to a small companion program that Chrome starts, over a socket only your user can open. The companion relays each command to the extension, which checks the tab, the site and the pause switch before acting. The reasoning is in [docs/decisions.md](docs/decisions.md).

## Development

```sh
git clone https://github.com/faysalmehmood/tabsteer.git && cd tabsteer
npm install && ./install.sh       # link tabsteer from this checkout
npm test                          # host and CLI
npx playwright install chromium && npm run test:e2e
```

To run your own build of the extension, remove the store version, then load the `extension` folder with **Load unpacked** in `chrome://extensions`. Report security issues privately, as described in [SECURITY.md](SECURITY.md).

## Credits and license

The idea of a CLI-first controller for the user's real browser was shown publicly by [Ivan Leo](https://x.com/ivanleomk) ([GitHub](https://github.com/ivanleomk)), building on the approach of the OpenAI Codex Chrome extension. Tab Steer is an independent implementation, not affiliated with or endorsed by Google, OpenAI, Anthropic or anyone named here.

Licensed under [Apache-2.0](LICENSE).
