// Firefox-only bootstrap for the background event page (background.html).
//
// Firefox suspends the event page after an idle timeout. A listener that
// returns a Promise is the async-response style whose pending state Firefox
// tracks; the Chrome-style sendResponse + `return true` is not, so a slow
// reply (icon resolution against slow hosts) was torn down mid-request with
// "Receiving end does not exist". Registering here, synchronously at document
// start, is also what Firefox requires to wake a suspended page for the event.
//
// background.js (a module script) publishes the real handler through
// __ffPublishBackgroundHandler once it has evaluated. Chrome never loads this
// file: its manifest points straight at background.js as the service worker.
(() => {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;

  let publish;
  const handlerReady = new Promise((resolve) => {
    publish = resolve;
  });
  globalThis.__ffPublishBackgroundHandler = publish;

  // The published handler never rejects (errors resolve into typed envelopes).
  api.runtime.onMessage.addListener((message) => handlerReady.then((handle) => handle(message)));
})();
