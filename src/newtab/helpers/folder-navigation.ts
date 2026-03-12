import { extensionApi } from '../../shared/browser';

export function openFolderView(folderId: string, openInNewTab: boolean): void {
  const folderUrl = extensionApi.runtime.getURL(`newtab.html#folder=${encodeURIComponent(folderId)}`);
  if (openInNewTab) {
    window.open(folderUrl, '_blank', 'noopener');
    return;
  }

  window.open(folderUrl, '_blank', 'noopener,noreferrer,width=1280,height=900');
}

export function getFolderIdFromHash(): string | null {
  const match = /^#folder=(.+)$/.exec(window.location.hash);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function syncFolderHash(folderId: string, mode: 'replace' | 'push' = 'replace'): void {
  const nextHash = `#folder=${encodeURIComponent(folderId)}`;
  if (window.location.hash !== nextHash) {
    if (mode === 'push') {
      history.pushState(null, '', nextHash);
      return;
    }

    history.replaceState(null, '', nextHash);
  }
}
