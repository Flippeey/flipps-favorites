# Privacy Policy — Flipp's Favorites

**Effective date:** 2026-05-31

Flipp's Favorites is a browser extension that replaces the new-tab page with a
dashboard of your own bookmarks. This policy explains what data the extension
handles and where it goes.

## Summary

The developer of Flipp's Favorites does **not** collect, store, sell, or
transmit any of your personal data. The extension has no analytics, no
tracking, no advertising, and no remote code. Everything the extension stores
stays on your own device or syncs through your browser's built-in sync — it is
never sent to the developer or to any server the developer controls.

## What the extension stores, and where

All of the following is stored locally on your device (and, where noted, synced
by your browser across devices you are signed in to):

- **Bookmarks** — The extension reads your existing browser bookmarks to display
  them, and creates, renames, moves, or deletes bookmarks when you edit tiles or
  folders. Bookmark data is never copied off your device by the extension.
- **Preferences and layout** — Theme, layout, density, tile shape, workspace
  definitions, and bookmark usage counts (used for "most used" sorting) are kept
  in your browser's extension storage. These use your browser's sync storage, so
  they follow you across browsers where you are signed in. This sync is handled
  by your browser vendor (e.g. Google for Chrome), not by the developer.
- **Wallpapers and onboarding state** — Stored in local extension storage on the
  current device only.
- **Favicon cache** — Resolved site icons and any custom icon overrides you set
  are cached in the browser's IndexedDB on your device, to avoid re-fetching
  icons. This data stays on your device.

You can remove all of this at any time by removing the extension or clearing the
extension's storage.

## Third-party favicon services

To show a recognizable icon for each bookmark, the extension fetches favicon
images from public icon providers. When it does so, it sends **only the hostname
of a bookmark** (for example, `example.com`) to these services — never the full
URL, your browsing history, or any personal information:

- Google S2 Favicons — https://policies.google.com/privacy
- Icon Horse — https://icon.horse/privacy
- DuckDuckGo — https://duckduckgo.com/privacy

These requests are made directly from your browser to the provider. The
developer does not receive, log, or store the results beyond the on-device cache
described above.

## Permissions

- **bookmarks** — Read and edit your bookmarks to display and organize them.
- **storage** — Save your preferences, workspaces, usage counts, wallpapers, and
  onboarding state, as described above.
- **declarativeNetRequest** — Add a temporary, per-request rule that lets the
  extension read favicon images returned by the icon providers. No browsing
  traffic is blocked, redirected, or recorded.
- **host permissions** (`https://*/*`, and the icon providers) — Fetch favicon
  images for any site you bookmark. Required because you may bookmark any site.

## Changes to this policy

If this policy changes, the updated version will be published at this same URL
with a new effective date.

## Contact

Questions about privacy or this extension: **flippey@flippflix.com**
