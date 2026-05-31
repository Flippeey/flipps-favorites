import { extensionApi } from '@/shared/browser';

let corsBypassRuleCounter = 0;

export async function withCorsBypass<T>(urlFilter: string, fn: () => Promise<T>): Promise<T> {
  const ruleId = ++corsBypassRuleCounter;
  let ruleAdded = false;
  if (extensionApi.declarativeNetRequest?.updateSessionRules) {
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
