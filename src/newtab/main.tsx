import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App';
import { getBookmarkTree, getSettings } from './lib/messaging';
import { readOnboardingState } from '../shared/storage';

async function bootstrap() {
  const container = document.getElementById('app');
  if (!container) return;
  let initialSettings;
  let initialTree;
  let initialOnboardOpen = false;
  try {
    const [settings, tree, onboardingState] = await Promise.all([
      getSettings(),
      getBookmarkTree(),
      readOnboardingState(),
    ]);
    initialSettings = settings;
    initialTree = tree;
    initialOnboardOpen = onboardingState.status === 'pending';
  } catch {
    container.innerHTML = '<div style="padding:24px;color:#B8B3AC;font-family:system-ui">Unable to reach extension background. Try reloading the new tab page.</div>';
    return;
  }
  createRoot(container).render(
    <StrictMode>
      <App initialSettings={initialSettings} initialTree={initialTree} initialOnboardOpen={initialOnboardOpen} />
    </StrictMode>,
  );
}

bootstrap();
