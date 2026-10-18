# Contributing

## Build and test

```sh
git clone https://github.com/faysalmehmood/tabsteer.git && cd tabsteer
npm install && ./install.sh       # link tabsteer from this checkout
npm test                          # host and CLI
npx playwright install chromium && npm run test:e2e
```

To run your own build of the extension, switch off the store version in `chrome://extensions`, then load the `extension` folder with **Load unpacked**.

## Releasing

1. Bump the version in `package.json` and `extension/manifest.json`.
2. `npm test` and `npm run test:e2e` pass.
3. **Smoke test in your everyday Chrome.** Load the release build unpacked, click **Turn on**, then run `npm run smoke`. The e2e tests use a clean Chromium, so they miss problems caused by password managers, ad blockers and other extensions. The smoke test runs the same kind of checks in your real profile and asks you to click Allow, Pause, Resume and Remove when needed.
4. Merge the release PR, then `npm publish` from `main`.
5. `scripts/package-extension.sh` builds `dist/tabsteer-extension-<version>.zip` for the Chrome Web Store. Update the listing from `store/listing.md` if permissions or behaviour changed.

## Style

Match the surrounding code. Keep the extension free of remote code and `eval`, and keep every check (shared tab, allowed site, pause) inside the extension, where the agent can't change it.
