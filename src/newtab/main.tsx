import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App';
import { getBookmarkTree, getSettings, getWorkspaces } from './lib/messaging';
import { readOnboardingState } from '../shared/storage';
import { EAGER_ICON_PREFETCH } from '../shared/constants';
import { prefetchAllIconsEager } from './lib/icon-prefetch';

async function bootstrap() {
  const container = document.getElementById('app');
  if (!container) return;
  let initialSettings;
  let initialTree;
  let initialWorkspaces;
  let initialOnboardOpen = false;
  try {
    const [rawSettings, tree, onboardingState, workspaces] = await Promise.all([
      getSettings(),
      getBookmarkTree(),
      readOnboardingState(),
      getWorkspaces(),
    ]);
    // When "Remember last workspace" is off, boot to the first ordered workspace
    // rather than the persisted (last-used) one. We resolve this at startup so
    // the App never needs to distinguish boot-time from runtime switches.
    let settings = rawSettings;
    if (!settings.rememberLastFolder && workspaces.length > 0) {
      const order = settings.workspaceOrder;
      const firstId = order && order.length > 0 ? order[0] : workspaces[0]?.id;
      if (firstId != null && firstId !== settings.activeWorkspaceId) {
        settings = { ...settings, activeWorkspaceId: firstId };
      }
    }
    initialSettings = settings;
    initialTree = tree;
    initialWorkspaces = workspaces;
    initialOnboardOpen = onboardingState.status === 'pending';

    // Start icon fetches BEFORE React mounts the grid so that by the time
    // <Favicon> components render, results are already in the in-memory
    // cache or in-flight (deduped by favicon-cache.ts).  The existing
    // App.tsx useEffect keeps idle-scheduled prefetch as a safety net for
    // subsequent tree changes.
    if (EAGER_ICON_PREFETCH) {
      prefetchAllIconsEager(tree);
    }
  } catch {
    const fallback = document.createElement('div');
    fallback.style.cssText = 'padding:24px;color:#B8B3AC;font-family:system-ui';
    fallback.textContent = 'Unable to reach extension background. Try reloading the new tab page.';
    container.replaceChildren(fallback);
    return;
  }
  createRoot(container).render(
    <StrictMode>
      <App initialSettings={initialSettings} initialTree={initialTree} initialWorkspaces={initialWorkspaces} initialOnboardOpen={initialOnboardOpen} />
    </StrictMode>,
  );
}

bootstrap();
