// Firefox-only bootstrap for the background event page (background.html).
//
// Firefox MV3 backgrounds are non-persistent event pages, and Firefox only
// wakes a suspended event page for events whose listeners were registered
// SYNCHRONOUSLY at document start ("Listeners must be registered synchronously
// from the start of the page" - MDN, Background scripts). background.js is a
// type="module" script: it evaluates after its import graph loads, which is
// too late for that registration. Without this bootstrap, the first message
// after the page idles out (~30s) fails with "Receiving end does not exist",
// or - if it lands mid-teardown - "Promised response from onMessage listener
// went out of scope" (shipped bug: Sync now on Firefox, PR #54).
//
// So this classic script registers the one runtime.onMessage listener at
// parse time and forwards every message to the real handler, which
// background.js publishes via __ffPublishBackgroundHandler once it has
// evaluated. Returning a Promise (rather than sendResponse + `return true`)
// uses the async-response style whose pending state Firefox tracks, keeping
// the event page alive while slow work (e.g. the 10s sync XHR) is in flight.
//
// Chrome ignores this file entirely: its manifest points straight at
// background.js as the service worker, and service-worker.ts detects the
// absence of the publish hook and registers its own listener.
(() => {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;

  let publish;
  const handlerReady = new Promise((resolve) => {
    publish = resolve;
  });
  globalThis.__ffPublishBackgroundHandler = publish;

  // The published handler never rejects (service-worker.ts wraps errors into
  // typed envelopes), so this promise chain always resolves with a response.
  api.runtime.onMessage.addListener((message) => handlerReady.then((handle) => handle(message)));
})();
