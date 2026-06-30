import { extensionApi } from '@/shared/browser';
import { isFirefox } from './platform';

// Re-export for callers that import from cors-bypass (icon-providers.ts)
export { isFirefox, firefoxSafeFetch } from './platform';

let corsBypassRuleCounter = 0;

export async function withCorsBypass<T>(urlFilter: string, fn: () => Promise<T>): Promise<T> {
  const ruleId = ++corsBypassRuleCounter;
  let ruleAdded = false;

  // On Firefox the declarativeNetRequest session-rule approach does not apply
  // CORS headers to fetch() responses on the background page — the XHR path
  // (via firefoxSafeFetch in platform.ts) handles CORS through host_permissions
  // instead. Only attempt to add the session rule on Chrome (where it works).
  if (!isFirefox() && extensionApi.declarativeNetRequest?.updateSessionRules) {
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
