import { useState } from 'react';
import { Ico } from './Ico';
import { ModalDialog } from './ModalDialog';

interface ConfirmOpenAllTabsDialogProps {
  count: number;
  folderTitle: string;
  onClose: () => void;
  onConfirm: () => void;
}

// Non-destructive confirm — guards against tab-bombing the browser when a
// folder holds a large number of bookmarks. Mirrors ConfirmBatchDeleteDialog's
// shape but with a neutral (not danger) primary action.
export function ConfirmOpenAllTabsDialog({ count, folderTitle, onClose, onConfirm }: ConfirmOpenAllTabsDialogProps) {
  const [working, setWorking] = useState(false);

  const handleConfirm = (): void => {
    if (working) return;
    setWorking(true);
    onConfirm();
    onClose();
  };

  return (
    <ModalDialog
      icon="arrowRight"
      eyebrow="Confirm"
      title={`Open ${count} tabs?`}
      onClose={onClose}
      width="min(440px, 100%)"
      bodyStyle={{ gridTemplateColumns: '1fr', gap: 12 }}
    >
      <p className="ff-confirm__message">
        This opens {count} bookmarks from “{folderTitle}” as new tabs.
      </p>
      <div className="ff-dialog__actions">
        <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose} disabled={working}>
          Cancel
        </button>
        <button type="button" className="ff-btn ff-btn--primary" onClick={handleConfirm} disabled={working}>
          <Ico name="arrowRight" size={14} /> Open {count} tabs
        </button>
      </div>
    </ModalDialog>
  );
}
