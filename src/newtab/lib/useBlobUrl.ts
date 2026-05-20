import { useEffect, useState } from 'react';

// Chromium silently drops very large inline style values (a few MB+), so a
// wallpaper data URL placed directly in CSS `url(...)` never reaches the DOM.
// Convert the data URL into a short-lived blob URL and use that instead.
export function useBlobUrl(dataUrl: string): string {
  const [blobUrl, setBlobUrl] = useState('');

  useEffect(() => {
    if (!dataUrl) {
      setBlobUrl('');
      return;
    }
    let cancelled = false;
    let createdUrl = '';
    fetch(dataUrl)
      .then(res => res.blob())
      .then(blob => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl('');
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [dataUrl]);

  return blobUrl;
}
