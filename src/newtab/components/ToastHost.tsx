import type { Toast } from '../state/useToasts';
import { Ico } from './Ico';

interface ToastHostProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastHost({ toasts, onDismiss }: ToastHostProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="ff-toasts" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map(toast => (
        <div key={toast.id} className="ff-toast" data-kind={toast.kind} role="status">
          <span className="ff-toast__msg">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="ff-toast__action"
              onClick={() => { toast.action!.onClick(); onDismiss(toast.id); }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            className="ff-toast__close"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            <Ico name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
