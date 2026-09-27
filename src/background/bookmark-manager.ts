import { extensionApi } from '../shared/browser';

export async function openBookmarkManager(): Promise<{ ok: boolean; opened: boolean; message?: string }> {
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
