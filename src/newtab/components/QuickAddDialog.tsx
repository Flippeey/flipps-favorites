import { useEffect, useRef, useState } from 'react';
import type { BookmarkNode } from '@/shared/messages';
import { createBookmark } from '../lib/messaging';
import { getHostname, getSearchName, isValidBookmarkUrl } from '../lib/icon-helpers';
import { Ico } from './Ico';
import { ModalDialog } from './ModalDialog';

interface QuickAddDialogProps {
  parentId: string;
  parentTitle?: string;
  onClose: () => void;
  onSaved: (bookmark: BookmarkNode) => void;
}

function inferTitle(url: string): string {
  const seed = getSearchName(url) || getHostname(url);
  if (!seed) return 'New bookmark';
  return seed.charAt(0).toUpperCase() + seed.slice(1);
}

export function QuickAddDialog({ parentId, parentTitle, onClose, onSaved }: QuickAddDialogProps) {
  const [value, setValue] = useState('https://www.');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    let url = value.trim();
    if (!url || url === 'https://' || url === 'http://' || url === 'www.') {
      setError('Enter a URL.');
      return;
    }
    if (!isValidBookmarkUrl(url)) {
      const withScheme = `https://${url.replace(/^\/+/, '')}`;
      if (isValidBookmarkUrl(withScheme)) {
        url = withScheme;
      } else {
        setError('URL is not valid.');
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const bookmark = await createBookmark(parentId, inferTitle(url), url);
      onSaved(bookmark);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save bookmark.');
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      icon="plus"
      eyebrow="Add bookmark"
      title={parentTitle ? `In ${parentTitle}` : 'New bookmark'}
      onClose={onClose}
      width="min(520px, 100%)"
      bodyStyle={{ gridTemplateColumns: '1fr', gap: 12 }}
      as="form"
      onSubmit={handleSubmit}
    >
      <div className="ff-field">
        <label className="ff-field__label">URL</label>
        <input
          ref={inputRef}
          className="ff-input"
          type="url"
          inputMode="url"
          spellCheck={false}
          value={value}
          onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
          placeholder="https://example.com"
        />
      </div>
      {error && <div className="ff-status" data-kind="error" role="alert">{error}</div>}
      <div className="ff-dialog__actions">
        <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="ff-btn" disabled={saving}>
          <Ico name="check" size={14} /> {saving ? 'Saving…' : 'Add bookmark'}
        </button>
      </div>
    </ModalDialog>
  );
}
