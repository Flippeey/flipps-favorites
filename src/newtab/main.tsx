import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App';
import { getBookmarkTree, getSettings, getWorkspaces } from './lib/messaging';
import { readOnboardingState } from '../shared/storage';

async function bootstrap() {
  const container = document.getElementById('app');
  if (!container) return;
  let initialSettings;
  let initialTree;
  let initialWorkspaces;
  let initialOnboardOpen = false;
  try {
    const [settings, tree, onboardingState, workspaces] = await Promise.all([
      getSettings(),
      getBookmarkTree(),
      readOnboardingState(),
      getWorkspaces(),
    ]);
    initialSettings = settings;
    initialTree = tree;
    initialWorkspaces = workspaces;
    initialOnboardOpen = onboardingState.status === 'pending';
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
