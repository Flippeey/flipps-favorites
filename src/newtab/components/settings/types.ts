import type { AppSettings, WorkspaceRecord } from '@/shared/messages';
import { defaultWorkspaceSettings } from '@/shared/storage';

export const FALLBACK_WORKSPACE: WorkspaceRecord = {
  id: '', name: '', rootFolderId: '',
  ...defaultWorkspaceSettings,
};

export interface SectionProps {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => void;
}

export interface WorkspaceSectionProps {
  workspace: WorkspaceRecord | null;
  onPatch: (patch: Partial<WorkspaceRecord>) => void;
}
