import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  kind: 'error' | 'info';
  message: string;
  action?: ToastAction;
}

export interface PushToastInput {
  kind: 'error' | 'info';
  message: string;
  action?: ToastAction;
  /** Override the auto-dismiss delay (ms). Defaults: error 5s, info 7s. */
  duration?: number;
}

export interface ToastApi {
  toasts: Toast[];
  pushToast: (input: PushToastInput) => void;
  dismissToast: (id: string) => void;
}

// Transient notifications for user-driven actions (e.g. delete + undo, failures).
// Each toast auto-dismisses; timers are cleaned up on dismiss and unmount.
export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const pushToast = useCallback((input: PushToastInput) => {
    const id = crypto.randomUUID();
    const toast: Toast = { id, kind: input.kind, message: input.message, action: input.action };
    setToasts(prev => [...prev, toast]);
    const ms = input.duration ?? (input.kind === 'error' ? 5000 : 7000);
    const timer = setTimeout(() => dismissToast(id), ms);
    timers.current.set(id, timer);
  }, [dismissToast]);

  useEffect(() => {
    const map = timers.current;
    return () => { map.forEach(clearTimeout); map.clear(); };
  }, []);

  return { toasts, pushToast, dismissToast };
}
