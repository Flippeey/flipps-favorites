import type { CSSProperties, FormEvent, MouseEvent, ReactNode } from 'react';
import { useEscapeKey } from '../interaction/useEscapeKey';
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
  useEscapeKey(onClose);

  const onScrimMouseDown = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
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
        onClick={onClose}
      >
        <Ico name="close" size={16} />
      </button>
    </div>
  );

  const body = <div className="ff-dialog__body" style={bodyStyle}>{children}</div>;
  const dialogStyle: CSSProperties | undefined = width ? { width } : undefined;

  return (
    <div className="ff-modal-scrim" onMouseDown={onScrimMouseDown}>
      {as === 'form' ? (
        <form className="ff-dialog" style={dialogStyle} onSubmit={onSubmit}>
          {head}
          {body}
        </form>
      ) : (
        <div className="ff-dialog" style={dialogStyle}>
          {head}
          {body}
        </div>
      )}
    </div>
  );
}
