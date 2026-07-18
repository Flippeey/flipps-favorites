# Publishing & Release Automation

How Flipp's Favorites ships to the three stores, and whether/how to automate it.

> **Store listing copy & screenshots** (descriptions, captions, promo tiles) are a
> separate concern from package publishing — see [`store/README.md`](store/README.md).
> TL;DR: AMO syncs fully via `npm run store:firefox`; Chrome listing text is dashboard-only
> (no API exists, verified against CWS API v2), assisted by `npm run store:chrome`.

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
| **Chrome Web Store** | [Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/api) (REST) | ✅ Yes — mature | Async (hours–days) | OAuth2 refresh-token flow (service accounts also supported). Upload + publish in two calls. v1.1 sunsets **2026-10-15**. |
| **Microsoft Edge** | [Edge Add-ons API v1.1](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/api/using-addons-api) | ✅ Yes | Async | Uses Microsoft Entra API key + client ID. Upload → poll status → publish. |
| **Firefox (AMO)** | [`web-ext sign`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign) / [AMO API v5](https://mozilla.github.io/addons-server/topics/api/index.html) | ✅ Yes — easiest | Automated for listed/unlisted | JWT (issuer + secret). `web-ext sign` does build-upload-sign in one command. |

**Verdict: all three are automatable.** Firefox is the simplest (one CLI command). Chrome and Edge each need a short upload→publish script. The whole thing fits comfortably in one GitHub Actions workflow triggered on a version tag.

**Effort estimate:** ~half a day to wire up + store credential setup. The credential setup (one-time) is the fiddly part, not the scripting.

---

## Credentials needed (one-time setup → store as GitHub secrets)

**Chrome Web Store** — create OAuth client in Google Cloud Console, then generate a refresh token once (see [Generating `CHROME_REFRESH_TOKEN`](#generating-chrome_refresh_token) below):
- `CHROME_EXTENSION_ID`
- `CHROME_PUBLISHER_ID` — required by API v2; Developer Dashboard → Account (Publisher section)
- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`

> API v2 also accepts **service accounts** (grant the SA email access in the Developer Dashboard). Not used here: it would add a GCP service account, a key/WIF secret, and a token-minting step, while the existing OAuth secrets already work against v2 unchanged. Revisit if refresh-token rotation ever becomes a burden.

**Microsoft Edge** — from Partner Center → Publish API:
- `EDGE_PRODUCT_ID`
- `EDGE_CLIENT_ID`
- `EDGE_API_KEY`

**Firefox (AMO)** — from https://addons.mozilla.org/developers/addon/api/key/ :
- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`

> ⚠️ All stores still run a **review** after upload. "Publish" here means *submit for review*, not *go live instantly*. Plan releases with that lead time in mind.

Secrets live in the **`prod` environment** (repo Settings → Environments → prod), not as repo-level secrets. Publish jobs declare `environment: prod` to access them — a repo-level secret with the same name would NOT be picked up there, and vice versa.

### Generating `CHROME_REFRESH_TOKEN`

One-time, run privately (the token grants publish access to the extension):

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a project → **APIs & Services → Library** → enable **Chrome Web Store API**.
2. **OAuth consent screen** → External → fill in app name + own email; add your own Google account as a test user.
3. **Credentials → Create credentials → OAuth client ID** → type **Web application** → add authorized redirect URI `http://localhost:8818` (no server needs to run there). This yields `CHROME_CLIENT_ID` / `CHROME_CLIENT_SECRET`.
4. Open in a browser (replace `<CLIENT_ID>`):

   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&scope=https://www.googleapis.com/auth/chromewebstore&redirect_uri=http://localhost:8818&client_id=<CLIENT_ID>
   ```

   Approve → browser redirects to `localhost:8818` (the "can't connect" error page is expected) → copy the `code=` query param from the address bar.
5. Exchange the code within a few minutes:

   ```bash
   curl -s -X POST https://oauth2.googleapis.com/token \
     -d "client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>&code=<CODE>&grant_type=authorization_code&redirect_uri=http://localhost:8818"
   ```

   Save the `refresh_token` from the response as the `CHROME_REFRESH_TOKEN` secret in the `prod` environment.

> ⚠️ While the OAuth consent screen is in **Testing** status, refresh tokens expire after 7 days. Publish the consent screen (fine for own-use apps) to get a non-expiring token.

---

## Recommendation

**Pursue automation — it's low effort and high payoff** given you already ship Chrome+Edge from one package and have a `release` skill that bumps versions and tags.

Suggested rollout:
1. **Start with Firefox** via `web-ext sign` — single command, immediate win.
2. **Add a Chrome publish step** using a maintained action (e.g. `wdzeng/chrome-extension`) or the raw REST calls below.
3. **Add Edge last** (Partner Center API key occasionally needs renewal — the most maintenance-prone).
4. Trigger the workflow on a `v*` tag so it dovetails with the existing `/release-flipps-favorites` flow (which already bumps version, builds, zips, commits, and tags).

Keep `auto-publish` behind a manual approval or `workflow_dispatch` input for the first few releases so a bad build can't auto-promote to all three stores at once.

---

## Live workflow: `.github/workflows/publish.yml`

The workflow is wired up. How it runs:

1. **Trigger** — pushing a `v*` tag (the `/ff-release` flow bumps version, commits, and tags; pushing the tag fires this workflow). `workflow_dispatch` allows manual runs from the Actions tab. There is **no** version-diff detection on `main` — the tag is the explicit release signal.
2. **`build` job** (ungated) — `npm ci` → typecheck → build both targets → verifies the tag matches `package.json` version (a stale tag fails fast) → uploads chrome + firefox zips as artifacts.
3. **`chrome` / `firefox` jobs** (gated) — both declare `environment: prod`. With **Required reviewers** enabled on the environment, they pause until approved in the Actions UI. On approval:
   - **Chrome** — `wdzeng/chrome-extension` (pinned to the v2.0.1 SHA) exchanges the refresh token, uploads the zip via **CWS API v2**, and publishes (= submits for review). Replaced `mnao305/chrome-extension-upload` 2026-07-18: that action calls the v1.1 endpoints Google sunsets on **2026-10-15** and has no v2 release. Same author as the `wdzeng/edge-addon` planned for Edge below.
   - **Firefox** — `web-ext sign --channel listed` uploads to AMO with the source zip attached (`git archive`; build is reproducible via `npm ci && npm run build:firefox`). `--approval-timeout 0` makes the job succeed once upload + validation complete instead of polling for the human-reviewed signed XPI.

Jobs run in parallel after `build`; a failure in one store does not block the other.

### Edge — not wired yet

No Partner Center credentials exist yet. To add later: create the `EDGE_PRODUCT_ID` / `EDGE_CLIENT_ID` / `EDGE_API_KEY` secrets in the `prod` environment, then add an `edge` job using `wdzeng/edge-addon` (pin to a SHA) with the **chrome** zip — same package serves both Chromium stores.

### One-time setup checklist

- [ ] Repo Settings → Environments → `prod` → tick **Required reviewers**, add yourself, save. Without this, a tag push publishes straight to stores.
- [ ] Generate and add `CHROME_REFRESH_TOKEN` (instructions above).
- [ ] Add `CHROME_PUBLISHER_ID` to the `prod` environment (Developer Dashboard → Account) — required since the API v2 migration; the chrome job fails without it.
- [ ] First dry run: Actions → "Publish extension" → Run workflow. The build job produces artifacts; **reject** the chrome/firefox approval to verify the gate without touching stores.
