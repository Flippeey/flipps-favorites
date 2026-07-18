# Store listing source of truth

Canonical copy for both store listings. Edit here, then sync. Seeded from the live
listings on 2026-07-18 — this directory wins over the dashboards from that date on.

| File | Store field | How it reaches the store |
| --- | --- | --- |
| `amo/summary.txt` | AMO summary (max 250 chars, single line) | `npm run store:amo -- --apply` |
| `amo/description.html` | AMO description (limited HTML subset) | `npm run store:amo -- --apply` |
| `previews.json` | AMO screenshot captions + order | `npm run store:amo -- --apply` (captions); `--replace-previews` (images) |
| `chrome/description.txt` | Chrome Web Store detailed description | **Manual paste** — `npm run store:chrome` diffs live vs repo and tells you when + what |
| `public/_locales/en/messages.json` → `extensionDescription` | Chrome short description + AMO-visible manifest description (max 132 chars) | Ships inside the package on every release — no listing action needed |

## Commands

```bash
npm run store:lint     # char limits, HTML allowlist, previews.json shape
npm run store:amo      # dry-run diff repo vs live AMO listing (no credentials needed)
npm run store:amo -- --apply                      # push summary/description/caption changes
npm run store:amo -- --apply --replace-previews   # also delete + re-upload preview images
npm run store:chrome   # diff repo vs live Chrome listing; prints paste instructions
npm run promo:tiles    # generate Chrome promo tiles (440x280 + 1400x560)
```

`--apply` needs `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` in the environment (same credentials
as the publish workflow: https://addons.mozilla.org/developers/addon/api/key/).

## Why Chrome is paste-only

The Chrome Web Store API — including the 2025 V2 API — has **no listing-metadata
endpoints**. Only package upload/publish/rollout are exposed. Descriptions, screenshots,
and promo tiles can only be changed in the
[developer dashboard](https://chrome.google.com/webstore/devconsole/). `store:chrome`
exists to make that a 2-minute diff-and-paste instead of a guessing game.

## Screenshot sizes (hard store requirements)

- **Chrome**: screenshots must be exactly **1280x800** (or 640x400) — use
  `promo/screenshots/*/[scene]-1280x800.png`. Promo tiles: small 440x280 (required),
  marquee 1400x560 (optional) — `npm run promo:tiles`.
- **AMO**: flexible; current listing uses **1920x1080** — use
  `promo/screenshots/*/[scene]-1920x1080.png`.

Regenerate screenshots with `npm run promo:screenshots` (needs `npm run build:chrome`
first).
