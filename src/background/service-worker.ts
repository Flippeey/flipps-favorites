import { extensionApi } from '../shared/browser';
import { IconFetchError, SyncFetchError, messageTypes, type AppErrorResponse, type AppRequest, type AppResponse, type BookmarkNode, type CreateWorkspaceResponse, type DeleteWorkspaceResponse, type GetSyncPairingCodeResponse, type GetWorkspacesResponse, type IconFetchErrorKind, type OpenTabResponse, type PatchWorkspaceResponse, type SyncErrorResponse, type SyncPullResponse, type SyncPullNotFoundResponse, type SyncPushResponse, type AdoptSyncSecretResponse, type WebSearchResponse, type WorkspaceRecord } from '../shared/messages';
import { deleteWorkspace, ensureWorkspacePerKeyMigration, ensureWorkspaceViewSortMigration, markOnboardingPending, patchWorkspaceRecord, readBookmarkUsageRecords, readSettings, readWorkspaces, writeBookmarkUsageRecord, writeSettings, writeWorkspace } from '../shared/storage';
import { getIcon, invalidateIcon, removeIconOverride, searchIcons, setIconOverride, setIconOverrideFromUrl, sweepGeneratedRecords } from './icons/icon-service';
import { adoptSyncSecret, getSyncPairingCode, previewPull, syncPull, syncPush } from './sync-client';
import { performWebSearch } from './search-shim';

extensionApi.runtime.onInstalled.addListener(async (details: { reason?: string }) => {
  const reason = details.reason ?? 'unknown';
  if (details.reason === 'install') {
    await markOnboardingPending();
    await invalidateIcon();
  }
  // Free chrome.storage.local quota that was used by icon cache/overrides (now in IndexedDB).
  const local = extensionApi.storage?.local;
  if (local?.remove) {
    await (local.remove as (keys: string[]) => Promise<void>)(['icon-cache-records', 'icon-override-records']).catch(() => { /* non-fatal */ });
  }
  void scheduleGeneratedRecordSweep();
  console.info(`Flipp's Favorites install event reason: ${reason}`);
  console.info('Flipp\'s Favorites - Bookmarks & more installed');
});

if (extensionApi.runtime.onStartup) {
  extensionApi.runtime.onStartup.addListener(() => {
    void scheduleGeneratedRecordSweep();
  });
}

function scheduleGeneratedRecordSweep(): Promise<void> {
  return sweepGeneratedRecords().catch((error: unknown) => {
    console.warn('Generated-icon sweep failed.', error);
  });
}

extensionApi.runtime.onMessage.addListener((message: AppRequest, _sender: unknown, sendResponse: (response: AppResponse | AppErrorResponse | SyncErrorResponse | undefined) => void) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      if (error instanceof SyncFetchError) {
        sendResponse(buildSyncErrorEnvelope(error));
        return;
      }
      sendResponse(buildErrorEnvelope(error));
    });
  return true; // Keep the message channel open for the async response
});

function buildErrorEnvelope(error: unknown): AppErrorResponse {
  let kind: IconFetchErrorKind = 'unknown';
  let message = 'Unknown error.';
  let httpStatus: number | undefined;

  if (error instanceof IconFetchError) {
    kind = error.kind;
    message = error.message;
    httpStatus = error.httpStatus;
  } else if (error instanceof Error) {
    message = error.message || message;
  } else if (typeof error === 'string') {
    message = error;
  }

  return { __error: { kind, message, httpStatus } };
}

function buildSyncErrorEnvelope(error: SyncFetchError): SyncErrorResponse {
  return { __syncError: { kind: error.kind, message: error.message, httpStatus: error.httpStatus } };
}

async function handleMessage(message: AppRequest): Promise<AppResponse> {
  // One-time, idempotent migration: splits the legacy `workspaces` aggregate key
  // into per-record `workspace:<id>` sync keys. Must run BEFORE view/sort migration
  // so writeWorkspace (called by that migration) already uses per-key layout.
  await ensureWorkspacePerKeyMigration();

  // One-time, idempotent copy of legacy global view/sort onto every workspace.
  // Memoized + persisted-marker gated, so this is a cheap no-op after the first
  // run. Covers applyWorkspaceImport's direct newtab-side writeSettings, since
  // newtab always messages the SW before that path is reachable.
  await ensureWorkspaceViewSortMigration();

  switch (message.type) {
    case messageTypes.ping:
      return { ok: true, context: 'background' };
    case messageTypes.getSettings:
      return { settings: await readSettings() };
    case messageTypes.patchSettings:
      return { settings: await writeSettings(message.patch) };
    case messageTypes.openBookmarkManager:
      return openBookmarkManager();
    case messageTypes.getBookmarkTree:
      return { tree: await getBookmarkTree() };
    case messageTypes.createBookmark:
      return {
        bookmark: normalizeBookmarkNode(await extensionApi.bookmarks.create({
          parentId: message.parentId,
          title: message.title,
          url: message.url,
          index: message.index,
        })),
      };
    case messageTypes.moveBookmark: {
      // Compensate for Chrome/WebExtensions same-parent move quirk: when the
      // target index is greater than the bookmark's current index, the browser
      // subtracts 1 internally (item shifts on removal). The UI passes a
      // post-removal index; bump it by 1 in that case so the item lands where
      // intended.
      let index = message.index;
      if (typeof index === 'number') {
        const existing = await extensionApi.bookmarks.get(message.bookmarkId);
        const current = Array.isArray(existing) ? existing[0] : existing;
        if (
          current &&
          current.parentId === message.parentId &&
          typeof current.index === 'number' &&
          index > current.index
        ) {
          index = index + 1;
        }
      }
      return {
        bookmark: normalizeBookmarkNode(await extensionApi.bookmarks.move(message.bookmarkId, {
          parentId: message.parentId,
          index,
        })),
      };
    }
    case messageTypes.updateBookmark:
      return { bookmark: normalizeBookmarkNode(await extensionApi.bookmarks.update(message.bookmarkId, message.changes)) };
    case messageTypes.removeBookmark:
      if (message.recursive) {
        await extensionApi.bookmarks.removeTree(message.bookmarkId);
      } else {
        await extensionApi.bookmarks.remove(message.bookmarkId);
      }
      return { ok: true };
    case messageTypes.getIcon:
      return { icon: await getIcon(message) };
    case messageTypes.searchIcons:
      return { candidates: await searchIcons(message.query, message.bookmarkUrl) };
    case messageTypes.setIconOverride:
      return { icon: await setIconOverride(message) };
    case messageTypes.setIconOverrideFromUrl:
      return {
        icon: await setIconOverrideFromUrl(message.bookmarkUrl, message.imageUrl, message.fileName, message.fallbackImageUrl, message.scope),
      };
    case messageTypes.removeIconOverride:
      return { icon: await removeIconOverride(message.bookmarkUrl, message.bookmarkTitle) };
    case messageTypes.invalidateIcon:
      await invalidateIcon(message.bookmarkUrl);
      return { ok: true };
    case messageTypes.getBookmarkUsage: {
      const records = await readBookmarkUsageRecords();
      const usage: Record<string, number> = {};
      for (const r of Object.values(records)) usage[r.bookmarkId] = r.usedAt;
      return { usage };
    }
    case messageTypes.recordBookmarkUse: {
      const usedAt = Date.now();
      await writeBookmarkUsageRecord({ bookmarkId: message.bookmarkId, usedAt });
      return { ok: true, usedAt };
    }
    case messageTypes.getWorkspaces: {
      const workspaces = await readWorkspaces();
      return { workspaces } satisfies GetWorkspacesResponse;
    }
    case messageTypes.createWorkspace: {
      await writeWorkspace(message.workspace);
      return { workspace: message.workspace } satisfies CreateWorkspaceResponse;
    }
    case messageTypes.patchWorkspace: {
      const updated = await patchWorkspaceRecord(message.id, message.patch);
      return { workspace: updated } satisfies PatchWorkspaceResponse;
    }
    case messageTypes.deleteWorkspace: {
      await deleteWorkspace(message.id);
      return { ok: true } satisfies DeleteWorkspaceResponse;
    }
    case messageTypes.openTab: {
      await extensionApi.tabs.create({ url: message.url });
      return { ok: true } satisfies OpenTabResponse;
    }
    case messageTypes.syncPush: {
      await syncPush(message.bundle);
      return { ok: true } satisfies SyncPushResponse;
    }
    case messageTypes.syncPull: {
      const result = await syncPull();
      return result.found
        ? ({ found: true, payload: result.payload } satisfies SyncPullResponse)
        : ({ found: false } satisfies SyncPullNotFoundResponse);
    }
    case messageTypes.syncPreviewPull: {
      const result = await previewPull(message.pairingCode);
      return result.found
        ? ({ found: true, payload: result.payload } satisfies SyncPullResponse)
        : ({ found: false } satisfies SyncPullNotFoundResponse);
    }
    case messageTypes.getSyncPairingCode: {
      const pairingCode = await getSyncPairingCode();
      return { pairingCode } satisfies GetSyncPairingCodeResponse;
    }
    case messageTypes.adoptSyncSecret: {
      await adoptSyncSecret(message.pairingCode);
      return { ok: true } satisfies AdoptSyncSecretResponse;
    }
    case messageTypes.webSearch: {
      await performWebSearch(message.query, message.openInNewTab);
      return { ok: true } satisfies WebSearchResponse;
    }
    default:
      throw new Error(`Unhandled message type: ${(message as AppRequest).type}`);
  }
}

async function getBookmarkTree(): Promise<BookmarkNode[]> {
  const nodes = await extensionApi.bookmarks.getTree();
  return normalizeBookmarkNodes(nodes);
}

interface RawBookmarkNode {
  id: string | number;
  parentId?: string | number;
  title?: string;
  url?: string;
  dateAdded?: number;
  children?: RawBookmarkNode[];
}

function normalizeBookmarkNode(node: RawBookmarkNode): BookmarkNode {
  return {
    id: String(node.id),
    parentId: node.parentId !== undefined ? String(node.parentId) : undefined,
    title: node.title || 'Untitled',
    url: node.url,
    dateAdded: typeof node.dateAdded === 'number' ? node.dateAdded : undefined,
    children: node.children ? normalizeBookmarkNodes(node.children) : undefined,
  };
}

function normalizeBookmarkNodes(nodes: RawBookmarkNode[]): BookmarkNode[] {
  return nodes.map(normalizeBookmarkNode);
}

async function openBookmarkManager(): Promise<{ ok: boolean; opened: boolean; message?: string }> {
  const isFirefox = /firefox/i.test(navigator.userAgent);

  if (isFirefox) {
    return {
      ok: false,
      opened: false,
      message: 'Firefox restricts opening the bookmark manager from extensions. Use Ctrl+Shift+O or open it from the browser menu.',
    };
  }

  if (!extensionApi.tabs?.create) {
    return {
      ok: false,
      opened: false,
      message: 'This browser does not expose tab creation from the extension context.',
    };
  }

  try {
    await extensionApi.tabs.create({ url: 'chrome://bookmarks/' });
    return { ok: true, opened: true };
  } catch (error) {
    return {
      ok: false,
      opened: false,
      message: error instanceof Error
        ? error.message
        : 'The browser blocked the native bookmark manager page.',
    };
  }
}
