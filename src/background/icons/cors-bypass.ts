import { extensionApi } from '@/shared/browser';
import { isFirefox } from './platform';

// Re-export for callers that import from cors-bypass (icon-providers.ts)
export { isFirefox, firefoxSafeFetch } from './platform';

let corsBypassRuleCounter = 0;
let staleRuleCleanup: Promise<void> | null = null;

// Session rules outlive the service worker, but the id counter restarts at 0
// with it. A worker killed mid-fetch leaves its rule behind, and a later id
// colliding with it is rejected, so the fetch runs without the CORS header.
// Every session rule belongs to this module, so any found on the first call
// of a worker lifetime is a leftover and is cleared.
function clearStaleSessionRules(): Promise<void> {
  staleRuleCleanup ??= (async () => {
    const dnr = extensionApi.declarativeNetRequest;
    const stale = await dnr.getSessionRules();
    if (stale.length > 0) {
      await dnr.updateSessionRules({ removeRuleIds: stale.map(rule => rule.id) });
    }
  })().catch((error: unknown) => {
    console.warn('Clearing stale CORS session rules failed.', error);
  });
  return staleRuleCleanup;
}

export async function withCorsBypass<T>(urlFilter: string, fn: () => Promise<T>): Promise<T> {
  const ruleId = ++corsBypassRuleCounter;
  let ruleAdded = false;

  // On Firefox the declarativeNetRequest session-rule approach does not apply
  // CORS headers to fetch() responses on the background page — the XHR path
  // (via firefoxSafeFetch in platform.ts) handles CORS through host_permissions
  // instead. Only attempt to add the session rule on Chrome (where it works).
  if (!isFirefox() && extensionApi.declarativeNetRequest?.updateSessionRules) {
    await clearStaleSessionRules();
    try {
      await extensionApi.declarativeNetRequest.updateSessionRules({
        addRules: [{
          id: ruleId,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'access-control-allow-origin', operation: 'set', value: '*' },
            ],
          },
          condition: {
            urlFilter,
            resourceTypes: ['xmlhttprequest', 'other'],
          },
        }],
      });
      ruleAdded = true;
    } catch {
      // declarativeNetRequest unavailable — proceed without CORS header injection
    }
  }

  try {
    return await fn();
  } finally {
    if (ruleAdded) {
      await extensionApi.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
      }).catch(() => undefined);
    }
  }
}
