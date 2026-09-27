import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { IconSearchCandidate } from '@/shared/messages';
import { iconPersistenceErrorMessage, normalizeUploadedImage } from '../lib/icon-helpers';

export type IconPickerStatusKind = 'info' | 'success' | 'error';
export type IconPickerStatus = { message: string; kind: IconPickerStatusKind } | null;

export interface UseIconPickerOptions<TPreview> {
  /** Gates every handler (upload/apply/remove/refresh) — false while there's no id to key the icon by. */
  enabled: boolean;
  /** Gates the identity-keyed initial load + seed search. Defaults to `enabled`. */
  initialEnabled?: boolean;
  /** Re-runs the initial load/search when this changes (a bookmark or folder id). */
  identityKey: string | undefined;
  /** Seed query for the initial search, read fresh at the moment `identityKey` changes. */
  initialQuery: string;
  /** Whether a search sets a status message on empty results / failure (EditDialog does; FolderNameDialog doesn't). */
  notifySearchResult?: boolean;
  onStatus: (status: IconPickerStatus) => void;
  loadInitial?: () => Promise<TPreview | null>;
  search: (query: string) => Promise<IconSearchCandidate[]>;
  applyCandidate: (candidate: IconSearchCandidate) => Promise<TPreview>;
  applyUpload: (dataUrl: string, file: File) => Promise<TPreview>;
  remove: {
    run: () => Promise<TPreview | null>;
    successMessage: string;
    errorMessage: string;
  };
  /** Omit when the dialog has no refresh action (folder icons). */
  refresh?: {
    run: () => Promise<TPreview>;
    successMessage: string;
    errorMessage: string;
  };
}

export interface UseIconPickerResult<TPreview> {
  preview: TPreview | null;
  query: string;
  setQuery: (value: string) => void;
  results: IconSearchCandidate[];
  validatedPreviews: ReadonlySet<string>;
  searching: boolean;
  working: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handlePreviewLoad: (imageUrl: string, image: HTMLImageElement) => void;
  handleSearchSubmit: () => void;
  pickCandidate: (candidate: IconSearchCandidate) => void;
  pickCandidateAndClose: (candidate: IconSearchCandidate) => Promise<void>;
  handleUploadClick: () => void;
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleRemove: () => Promise<void>;
  handleRefresh: (() => Promise<void>) | undefined;
}

// State machine behind both icon-picking dialogs (bookmark override, folder
// override): search/apply/upload/remove/refresh, the min-edge-64 preview-load
// dedupe, and the click-then-dblclick apply race guard. Callers differ only in
// which messaging calls persist the icon and which copy/status field reports
// the outcome — both supplied through `options`, read from a ref each call so
// the hook's own callbacks stay referentially stable across renders.
export function useIconPicker<TPreview>(options: UseIconPickerOptions<TPreview>): UseIconPickerResult<TPreview> {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [preview, setPreview] = useState<TPreview | null>(null);
  const [query, setQuery] = useState(options.initialQuery);
  const [results, setResults] = useState<IconSearchCandidate[]>([]);
  const [validatedPreviews, setValidatedPreviews] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [working, setWorking] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Dedupes a double-click (which fires click -> click -> dblclick) onto the
  // single in-flight write instead of racing a second apply.
  const applyingRef = useRef<Promise<void> | null>(null);

  const handlePreviewLoad = useCallback((imageUrl: string, image: HTMLImageElement) => {
    const minEdge = Math.min(image.naturalWidth, image.naturalHeight);
    if (minEdge < 64) return;
    setValidatedPreviews(prev => {
      if (prev.has(imageUrl)) return prev;
      const next = new Set(prev);
      next.add(imageUrl);
      return next;
    });
  }, []);

  const runSearch = useCallback(async (q: string) => {
    const opts = optionsRef.current;
    setSearching(true);
    setValidatedPreviews(new Set());
    try {
      const candidates = await opts.search(q);
      setResults(candidates);
      if (opts.notifySearchResult ?? true) {
        opts.onStatus(candidates.length ? null : { kind: 'error', message: 'No matches.' });
      }
    } catch {
      setResults([]);
      if (opts.notifySearchResult ?? true) {
        opts.onStatus({ kind: 'error', message: 'Search failed.' });
      }
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearchSubmit = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    void runSearch(q);
  }, [query, runSearch]);

  // Runs once per identity (bookmark/folder id): seeds the query, loads the
  // current preview, and kicks off the default search. Read via a ref so the
  // effect only re-fires on identity change, not on every prop update.
  const runInitialRef = useRef<() => void>(() => {});
  runInitialRef.current = () => {
    const opts = optionsRef.current;
    if (!(opts.initialEnabled ?? opts.enabled)) return;
    setQuery(opts.initialQuery);
    if (opts.loadInitial) {
      opts.loadInitial().then(setPreview).catch(() => undefined);
    }
    void runSearch(opts.initialQuery);
  };

  useEffect(() => {
    runInitialRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.identityKey]);

  const applyCandidate = useCallback(async (candidate: IconSearchCandidate): Promise<void> => {
    const opts = optionsRef.current;
    if (!opts.enabled) return;
    if (applyingRef.current) {
      await applyingRef.current.catch(() => undefined);
      return;
    }
    const run = (async () => {
      setWorking(true);
      try {
        const next = await opts.applyCandidate(candidate);
        setPreview(next);
        opts.onStatus({ kind: 'success', message: 'Icon applied.' });
      } catch (e) {
        opts.onStatus({ kind: 'error', message: iconPersistenceErrorMessage(e, 'search') });
      } finally {
        setWorking(false);
        applyingRef.current = null;
      }
    })();
    applyingRef.current = run;
    await run.catch(() => undefined);
  }, []);

  const pickCandidate = useCallback((candidate: IconSearchCandidate): void => {
    void applyCandidate(candidate);
  }, [applyCandidate]);

  const pickCandidateAndClose = useCallback(async (candidate: IconSearchCandidate): Promise<void> => {
    await applyCandidate(candidate);
  }, [applyCandidate]);

  const handleUploadClick = useCallback(() => {
    const opts = optionsRef.current;
    if (!opts.enabled || working) return;
    fileInputRef.current?.click();
  }, [working]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const opts = optionsRef.current;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !opts.enabled || working) return;
    setWorking(true);
    try {
      const dataUrl = await normalizeUploadedImage(file);
      const next = await opts.applyUpload(dataUrl, file);
      setPreview(next);
      opts.onStatus({ kind: 'success', message: 'Icon uploaded.' });
    } catch (e) {
      opts.onStatus({ kind: 'error', message: iconPersistenceErrorMessage(e, 'upload') });
    } finally {
      setWorking(false);
    }
  }, [working]);

  const handleRemove = useCallback(async () => {
    const opts = optionsRef.current;
    if (!opts.enabled || working) return;
    setWorking(true);
    try {
      const next = await opts.remove.run();
      setPreview(next);
      opts.onStatus({ kind: 'info', message: opts.remove.successMessage });
    } catch {
      opts.onStatus({ kind: 'error', message: opts.remove.errorMessage });
    } finally {
      setWorking(false);
    }
  }, [working]);

  const handleRefreshImpl = useCallback(async () => {
    const opts = optionsRef.current;
    const refresh = opts.refresh;
    if (!opts.enabled || working || !refresh) return;
    setWorking(true);
    try {
      const next = await refresh.run();
      setPreview(next);
      opts.onStatus({ kind: 'info', message: refresh.successMessage });
    } catch {
      opts.onStatus({ kind: 'error', message: refresh.errorMessage });
    } finally {
      setWorking(false);
    }
  }, [working]);
  // Only exposed when the caller supplied a refresh action (EditDialog); the
  // hook is still called unconditionally above to satisfy the rules of hooks.
  const handleRefresh = options.refresh ? handleRefreshImpl : undefined;

  return {
    preview,
    query,
    setQuery,
    results,
    validatedPreviews,
    searching,
    working,
    fileInputRef,
    handlePreviewLoad,
    handleSearchSubmit,
    pickCandidate,
    pickCandidateAndClose,
    handleUploadClick,
    handleFileChange,
    handleRemove,
    handleRefresh,
  };
}
