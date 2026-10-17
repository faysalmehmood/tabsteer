# Chrome Web Store listing

Copy these into the Developer Dashboard. Files to upload are in this folder,
and the zip comes from `scripts/package-extension.sh` (current: `dist/tabsteer-extension-0.1.2.zip`).

## Store listing tab

**Name**

Tab Steer

**Summary** (132 characters max)

Hand your coding agent a tab, not your browser. A local CLI controls only the tabs and sites you share.

**Category**

Developer Tools

**Language**

English

**Description**

Tab Steer lets AI coding agents work in your real, logged-in browser, limited to the tabs and sites you choose.

It pairs this extension with a small open-source command-line tool on your computer. Any agent that can run a shell command (Claude Code, Antigravity, Codex, Cursor, or a script) can then read a page as compact Markdown and click, type and wait on it.

YOU STAY IN CONTROL
- Shared tabs only. The agent acts only on tabs in the "Tab Steer" tab group. Drag a tab in to share it, drag it out to stop.
- Allowed sites only. The extension installs with access to no sites. You grant each site from the toolbar icon.
- One-click pause. Every command is refused until you resume.
- Passwords stay hidden. Values of password, payment and one-time-code fields are never returned.
- No arbitrary code. There is no command to run scripts in your pages.

PRIVATE BY DESIGN
- Nothing is collected and nothing is sent to us or to any third party.
- The command-line tool talks to the extension over a private connection on your own machine. Nothing listens on the network.

REQUIRES A COMPANION PROGRAM
Tab Steer does nothing on its own. After installing, a welcome page walks you through installing the free companion tool (macOS and Linux, Node.js 18 or newer). Source code and instructions: https://github.com/faysalmehmood/tabsteer

USE IT RESPONSIBLY
Some websites prohibit automated access in their terms. You are responsible for the sites you use Tab Steer on. It has no features for evading bot detection.

Tab Steer is an independent open-source project (Apache-2.0), not affiliated with Google, OpenAI or Anthropic.

**Graphics**

| Asset | File |
| --- | --- |
| Store icon, 128x128 | `icon-128.png` |
| Screenshot 1, 1280x800 | `screenshot-1.png` |
| Screenshot 2, 1280x800 | `screenshot-2.png` |
| Small promo tile, 440x280 | `promo-440x280.png` |

**Links**

- Homepage: https://tabsteer.conceptlix.com
- Support: https://github.com/faysalmehmood/tabsteer/issues

## Privacy practices tab

**Single purpose**

Tab Steer lets a command-line tool on the user's own computer read and control the browser tabs the user has explicitly shared, so that the user's AI coding agent can work in their existing browser session.

**Permission justifications**

| Permission | Justification |
| --- | --- |
| `nativeMessaging` | The extension's only function is to receive commands from the companion command-line tool installed on the same computer, and return results to it. Native messaging is the channel between the two. No remote server is involved. |
| `scripting` | Used to run the extension's own packaged script in a shared tab to read page content and perform the click, type, scroll and wait actions the user's tool requests. No remotely hosted code is executed. |
| `tabGroups` | Sharing is represented by a tab group named "Tab Steer". The extension creates that group, adds tabs the user shares to it, and checks group membership before every action so that tabs outside it cannot be touched. |
| `activeTab` | When the user clicks the toolbar icon, the popup needs the current tab's address to show which site it is and to offer "Share this tab" and "Allow on this site" for that site. It never gives the command-line tool access: every command checks for a site permission the user granted. |
| `storage` | Stores one setting locally: whether the user has paused Tab Steer. |
| `alarms` | Retries the connection to the companion tool once a minute, so the extension connects after the user installs the companion without needing a browser restart. |
| Host permissions (optional, `<all_urls>`) | Declared as optional and never granted at install. The user grants access one site at a time (or all sites, if they choose) from the popup. Access is needed to read and act on pages of the sites the user has chosen to let their agent use; the set of sites cannot be known in advance. |

**Remote code**

No, the extension does not use remote code. All logic is in the package.

**Data usage**

The extension handles the following only on tabs the user has shared, on sites the user has allowed, and only when the user's local tool requests it:

- Website content (page text, links, form values other than passwords, screenshots)
- Web history (the address and title of shared tabs)

This data is passed to the companion program on the user's own computer and nowhere else. Certify all three statements:

- Data is not sold or transferred to third parties, outside of the approved use cases.
- Data is not used or transferred for purposes unrelated to the item's single purpose.
- Data is not used or transferred to determine creditworthiness or for lending purposes.

**Privacy policy URL**

https://tabsteer.conceptlix.com/privacy.html

## Test instructions tab

The extension needs its companion program, which is open source.

1. On macOS or Linux with Node.js 18 or newer, run:
   `npm install -g tabsteer && tabsteer install`
2. Install the extension from its store page.
3. The welcome page opens and shows "Connected" within a minute.
4. Open https://example.com, click the Tab Steer toolbar icon, choose "Share this tab with your agent" and accept the site permission prompt.
5. In a terminal run `tabsteer read`. The page content is printed. Run `tabsteer click "More information"` (or the link text shown) to see an action.
6. Click "Pause" in the popup and run `tabsteer read` again. It is refused.

No account or login is required.

## Store item

Item ID: `mkpmilnglglhiaeojeeioafmbjjghmed`. The companion already allows this ID.
