# Privacy Policy — Flipp's Favorites

**Effective date:** 2026-10-11

Flipp's Favorites is a browser extension that replaces the new-tab page with a
dashboard of your own bookmarks. This policy explains what data the extension
handles and where it goes.

## Summary

The developer of Flipp's Favorites does **not** collect, store, sell, or
transmit any of your personal data. The extension has no analytics, no
tracking, no advertising, and no remote code. Everything the extension stores
stays on your own device or syncs through your browser's built-in sync — it is
never sent to the developer or to any server the developer controls. The only
network requests the extension makes are for site icons, described below.

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

## Site icons and third-party icon services

To show a recognizable icon for each bookmark, the extension first asks the
bookmarked site itself for its icon: it requests the site's home page (to read
the icon links it declares) and its standard icon files, such as `favicon.ico`.

If the site has no usable icon, the extension falls back to public icon
providers. For these automatic lookups it sends **only the hostname of a
bookmark** (for example, `example.com`) — never the full URL, your browsing
history, or any personal information:

- Google S2 Favicons — https://policies.google.com/privacy
- Icon Horse — https://icon.horse/privacy
- DuckDuckGo — https://duckduckgo.com/privacy

DuckDuckGo image results can point at images hosted elsewhere; the extension
downloads the chosen image from that host. When you search for an icon yourself
in the edit dialog, the text you type is sent to DuckDuckGo image search.

All of these requests go directly from your browser to the site or provider.
The developer does not receive, log, or store them or their results; resolved
icons are kept only in the on-device cache described above.

## Permissions

- **bookmarks** — Read and edit your bookmarks to display and organize them.
- **storage** — Save your preferences, workspaces, usage counts, wallpapers, and
  onboarding state, as described above.
- **search** — When you choose to search the web from the search bar, hand the
  query to your browser's default search engine, exactly as if you had typed it
  into the address bar. The extension does not see or store the results.
- **declarativeNetRequest** — Add a temporary, per-request rule that lets the
  extension read favicon images returned by the icon providers. No browsing
  traffic is blocked, redirected, or recorded.
- **host permissions** (`https://*/*`, and the icon providers) — Fetch icons
  from any site you bookmark, and from the icon providers above. Required
  because you may bookmark any site.

## Changes to this policy

If this policy changes, the updated version will be published at this same URL
with a new effective date.

## Contact

Questions about privacy or this extension: **flippey@flippflix.com**
