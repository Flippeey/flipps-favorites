<p align="center">
  <img src="public/icons/ff-icon-128.png" width="96" alt="Flipp's Favorites icon" />
</p>

<h1 align="center">Flipp's Favorites</h1>

<p align="center">A browser extension that replaces the new tab page with a fast, customizable bookmark dashboard.<br/>Works on Chrome and Firefox.</p>

---

## ✨ Features

- 📁 **Bookmark dashboard** — navigate your bookmark folders directly in the new tab page
- 🖼️ **Visual tiles** — see site icons at a glance; override any icon with a custom image or URL
- 🔍 **Search** — filter bookmarks instantly from the hero search bar
- 🎨 **Themes** — light and dark modes, accent color picker, and wallpaper support
- 🖱️ **Drag & drop** — reorder and move bookmarks and folders
- ☑️ **Multi-select** — select, cut, paste, and move multiple items at once
- ⚙️ **Settings drawer** — all appearance and behavior options in one place
- 🧙 **Onboarding wizard** — guided first-time setup to get your workspace ready in under a minute
- 💾 **Import / export** — back up and restore your settings and icon overrides across devices
- 🔒 **Privacy-first** — requests only the permissions it actually needs

---

## 🛠️ Development

**Requirements:** Node.js 18+

```bash
npm install
```

| Command | What it does |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Build for Chrome and Firefox |
| `npm run build:chrome` | Chrome only → `dist/chrome/` |
| `npm run build:firefox` | Firefox only → `dist/firefox/` |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run Playwright E2E tests |

### Load in browser

After running `npm run build`:

- **Chrome** — go to `chrome://extensions`, enable Developer mode, load unpacked from `dist/chrome/`
- **Firefox** — go to `about:debugging`, load temporary add-on from `dist/firefox/manifest.json`

> Store listings coming soon.

### How it's built

- **TypeScript** (strict, ES2022) — no framework, vanilla DOM
- **Vite** — single source tree, dual output
- **Manifest V3** — same spec for both Chrome and Firefox
- **No runtime dependencies** — devDependencies only

The manifest is generated post-build by `scripts/write-manifest.mjs` and supports environment variable overrides:

| Variable | Default | Purpose |
|----------|---------|---------|
| `EXTENSION_VERSION` | from `package.json` | Version string |
| `FIREFOX_EXTENSION_ID` | `com.flipps-favorites@flippflix.com` | Firefox add-on ID |
| `FIREFOX_UPDATE_URL` | _(none)_ | Self-hosted update manifest URL |
| `INCLUDE_HTTP_HOSTS` | `0` | Set to `1` to add `http://*/*` host permission |

---

## 🏗️ Architecture

The extension has two entry points:

- **`src/background/service-worker.ts`** — handles install/update lifecycle, all browser API calls, and icon resolution
- **`src/newtab/main.ts`** — the full new tab UI; communicates with the background exclusively via typed messages

All cross-boundary message types are defined in `src/shared/messages.ts`.

---

## 🔐 Privacy

- No accounts, no sign-in, no external servers
- All data (settings, icon overrides) is stored in local browser extension storage
- Icon fetching uses Google S2 and DuckDuckGo as fallbacks — only the hostname of each bookmark is sent
- No telemetry or analytics

---

## 🤝 Contributing

Bug reports and feature requests are welcome — please [open an issue](https://github.com/Flippeey/flipps-favorites/issues).

Pull requests are not being accepted at this time.

---

## 📄 License

Copyright (c) 2026 Jason Leeraert. All rights reserved.

The source code is publicly visible for reference and transparency. No permission is granted to use, copy, modify, or distribute this software without explicit written consent from the author.
