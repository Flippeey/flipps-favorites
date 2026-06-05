import { useCallback, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { useEscapeKey } from '../interaction/useEscapeKey';
import { useFocusTrap } from '../interaction/useFocusTrap';
import { Ico } from './Ico';

interface ModalDialogProps {
  icon: string;
  eyebrow: string;
  title: ReactNode;
  onClose: () => void;
  width?: string;
  bodyStyle?: CSSProperties;
  as?: 'div' | 'form';
  onSubmit?: (event: FormEvent) => void;
  children: ReactNode;
}

export function ModalDialog({
  icon,
  eyebrow,
  title,
  onClose,
  width,
  bodyStyle,
  as = 'div',
  onSubmit,
  children,
}: ModalDialogProps) {
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onClose(), 200);
  }, [closing, onClose]);

  useEscapeKey(handleClose);
  useFocusTrap(dialogRef);

  const onScrimMouseDown = (e: MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  };

  const head = (
    <div className="ff-dialog__head">
      <div className="ff-dialog__head-left">
        <div className="ff-section__icon-folder ff-dialog__head-icon">
          <Ico name={icon} size={16} />
        </div>
        <div>
          <div className="ff-dialog__eyebrow">{eyebrow}</div>
          <div className="ff-dialog__title">{title}</div>
        </div>
      </div>
      <button
        type="button"
        className="ff-iconbtn ff-iconbtn--icon"
        aria-label="Close"
        onClick={handleClose}
      >
        <Ico name="close" size={16} />
      </button>
    </div>
  );

  const body = <div className="ff-dialog__body" style={bodyStyle}>{children}</div>;
  const dialogStyle: CSSProperties | undefined = width ? { width } : undefined;

  return (
    <div className="ff-modal-scrim" data-closing={closing || undefined} onMouseDown={onScrimMouseDown}>
      {as === 'form' ? (
        <form
          ref={(el) => { dialogRef.current = el; }}
          className="ff-dialog"
          role="dialog"
          aria-modal="true"
          data-closing={closing || undefined}
          style={dialogStyle}
          onSubmit={onSubmit}
        >
          {head}
          {body}
        </form>
      ) : (
        <div
          ref={(el) => { dialogRef.current = el; }}
          className="ff-dialog"
          role="dialog"
          aria-modal="true"
          data-closing={closing || undefined}
          style={dialogStyle}
        >
          {head}
          {body}
        </div>
      )}
    </div>
  );
}
