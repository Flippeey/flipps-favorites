# Publishing & Release Automation

How Flipp's Favorites ships to the three stores, and whether/how to automate it.

Current build produces two MV3 packages:

```
npm run build          # builds both
# dist/chrome/   → Chrome Web Store + Microsoft Edge Add-ons (same package)
# dist/firefox/  → Firefox Add-ons (AMO)
```

> Edge accepts the **same MV3 package as Chrome** — there is no separate Edge build. One zip serves both Chromium stores.

---

## Feasibility summary

| Store | API / CLI | Automatable? | Review gate | Notes |
| --- | --- | --- | --- | --- |
| **Chrome Web Store** | [Chrome Web Store API v1.1](https://developer.chrome.com/docs/webstore/api) (REST) | ✅ Yes — mature | Async (hours–days) | OAuth2 refresh-token flow. Upload + publish in two calls. |
| **Microsoft Edge** | [Edge Add-ons API v1.1](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/api/using-addons-api) | ✅ Yes | Async | Uses Microsoft Entra API key + client ID. Upload → poll status → publish. |
| **Firefox (AMO)** | [`web-ext sign`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign) / [AMO API v5](https://mozilla.github.io/addons-server/topics/api/index.html) | ✅ Yes — easiest | Automated for listed/unlisted | JWT (issuer + secret). `web-ext sign` does build-upload-sign in one command. |

**Verdict: all three are automatable.** Firefox is the simplest (one CLI command). Chrome and Edge each need a short upload→publish script. The whole thing fits comfortably in one GitHub Actions workflow triggered on a version tag.

**Effort estimate:** ~half a day to wire up + store credential setup. The credential setup (one-time) is the fiddly part, not the scripting.

---

## Credentials needed (one-time setup → store as GitHub secrets)

**Chrome Web Store** — create OAuth client in Google Cloud Console, then generate a refresh token once:
- `CHROME_EXTENSION_ID`
- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`

**Microsoft Edge** — from Partner Center → Publish API:
- `EDGE_PRODUCT_ID`
- `EDGE_CLIENT_ID`
- `EDGE_API_KEY`

**Firefox (AMO)** — from https://addons.mozilla.org/developers/addon/api/key/ :
- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`

> ⚠️ All stores still run a **review** after upload. "Publish" here means *submit for review*, not *go live instantly*. Plan releases with that lead time in mind.

---

## Recommendation

**Pursue automation — it's low effort and high payoff** given you already ship Chrome+Edge from one package and have a `release` skill that bumps versions and tags.

Suggested rollout:
1. **Start with Firefox** via `web-ext sign` — single command, immediate win.
2. **Add a Chrome publish step** using a maintained action (e.g. `mnao305/chrome-extension-upload`) or the raw REST calls below.
3. **Add Edge last** (Partner Center API key occasionally needs renewal — the most maintenance-prone).
4. Trigger the workflow on a `v*` tag so it dovetails with the existing `/release-flipps-favorites` flow (which already bumps version, builds, zips, commits, and tags).

Keep `auto-publish` behind a manual approval or `workflow_dispatch` input for the first few releases so a bad build can't auto-promote to all three stores at once.

---

## Draft GitHub Actions workflow

> **Draft only — not wired up.** Add the secrets above before enabling. Save as `.github/workflows/publish.yml` when ready.

```yaml
name: Publish extension

on:
  push:
    tags: ["v*"]
  workflow_dispatch:
    inputs:
      publish:
        description: "Submit to stores (false = build + artifact only)"
        type: boolean
        default: false

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.ver.outputs.version }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build
      - id: ver
        run: echo "version=$(node -p "require('./package.json').version")" >> "$GITHUB_OUTPUT"
      - name: Zip packages
        run: |
          cd dist/chrome  && zip -r ../../flipps-favorites-chrome.zip  . && cd ../..
          cd dist/firefox && zip -r ../../flipps-favorites-firefox.zip . && cd ../..
      - uses: actions/upload-artifact@v4
        with:
          name: packages
          path: flipps-favorites-*.zip

  chrome:
    needs: build
    if: github.event_name == 'push' || inputs.publish
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { name: packages }
      - name: Upload & publish to Chrome Web Store
        uses: mnao305/chrome-extension-upload@v5
        with:
          file-path: flipps-favorites-chrome.zip
          extension-id: ${{ secrets.CHROME_EXTENSION_ID }}
          client-id: ${{ secrets.CHROME_CLIENT_ID }}
          client-secret: ${{ secrets.CHROME_CLIENT_SECRET }}
          refresh-token: ${{ secrets.CHROME_REFRESH_TOKEN }}

  edge:
    needs: build
    if: github.event_name == 'push' || inputs.publish
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { name: packages }
      # Same package as Chrome. Uses the Edge Add-ons API v1.1.
      - name: Upload to Edge Add-ons
        uses: wdzeng/edge-addon@v2
        with:
          product-id: ${{ secrets.EDGE_PRODUCT_ID }}
          zip-path: flipps-favorites-chrome.zip
          client-id: ${{ secrets.EDGE_CLIENT_ID }}
          api-key: ${{ secrets.EDGE_API_KEY }}

  firefox:
    needs: build
    if: github.event_name == 'push' || inputs.publish
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci && npm run build:firefox
      - name: Sign & submit to AMO
        run: npx web-ext sign
          --source-dir dist/firefox
          --channel listed
          --api-key "$AMO_JWT_ISSUER"
          --api-secret "$AMO_JWT_SECRET"
        env:
          AMO_JWT_ISSUER: ${{ secrets.AMO_JWT_ISSUER }}
          AMO_JWT_SECRET: ${{ secrets.AMO_JWT_SECRET }}
```

### Notes on the draft
- The third-party actions (`mnao305/chrome-extension-upload`, `wdzeng/edge-addon`) are popular wrappers around the official REST APIs. Pin them to a SHA in production. If you prefer no third-party actions, both stores can be driven with `curl` against their REST endpoints — slightly more code, zero supply-chain surface.
- `web-ext sign --channel listed` submits to the public AMO listing; use `unlisted` for self-distributed signed builds.
- All three jobs run in parallel after `build`; a failure in one store does not block the others.
- For source-code submission (AMO sometimes requests it for minified/bundled extensions), add `--upload-source-code` or attach the source zip — the Vite build is reproducible from `npm ci && npm run build:firefox`.
