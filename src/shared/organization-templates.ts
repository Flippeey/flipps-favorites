// Organization archetype template bundles consumed by the TemplatePicker (Wave 7).
// Context-free — no chrome.* / window accesses. Lives in shared/ so it can be
// imported from both the newtab context and any future background consumers.
//
// Templates NEVER set layoutPreset — resolution-aware layout (#17) owns that field.
// workspaceOverrides is limited to the agreed Pick:
//   folderMode | bookmarkSortMode | bookmarkSortDirection

import type { ViewMode, BookmarkSortMode, SortDirection, WorkspaceRecord } from './models';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArchetypeId = 'hoarder' | 'power-user' | 'casual' | 'researcher';

export interface OrganizationTemplate {
  id: ArchetypeId;
  title: string;
  description: string;
  workspaceOverrides: Partial<Pick<WorkspaceRecord, 'folderMode' | 'bookmarkSortMode' | 'bookmarkSortDirection'>>;
  settingsSummary: string[];
}

// Professional nudge: workspace-split suggestion metadata, NOT a bundle.
// It is not an archetype and has no workspaceOverrides — it only surfaces
// a nudge in the picker UI for users who appear to mix work + personal content.
export interface ProfessionalNudge {
  title: string;
  description: string;
  nudgeSummary: string[];
}

// ---------------------------------------------------------------------------
// Template bundles
// ---------------------------------------------------------------------------

// Hoarder: flat grid view; manual sort keeps existing order; list mode would
// lose the spatial memory hoarders rely on.
const hoarder: OrganizationTemplate = {
  id: 'hoarder',
  title: 'Quick Stash',
  description:
    'Everything in one place — fast to save, easy to scan. Perfect if you keep bookmarks flat and navigate by memory.',
  workspaceOverrides: {
    folderMode: 'grid' satisfies ViewMode,
    bookmarkSortMode: 'manual' satisfies BookmarkSortMode,
    bookmarkSortDirection: 'asc' satisfies SortDirection,
  },
  settingsSummary: ['Grid view', 'Manual order', 'No automatic sorting'],
};

// Power-user: list view for density; manual sort preserves deliberate structure.
const powerUser: OrganizationTemplate = {
  id: 'power-user',
  title: 'Structured Library',
  description:
    'Deep folders, curated order, maximum information density. Built for people who file everything and always know where to find it.',
  workspaceOverrides: {
    folderMode: 'list' satisfies ViewMode,
    bookmarkSortMode: 'manual' satisfies BookmarkSortMode,
    bookmarkSortDirection: 'asc' satisfies SortDirection,
  },
  settingsSummary: ['List view (compact)', 'Manual order', 'Folder-first navigation'],
};

// Casual: grid view; name sort gives predictable alphabetical access for small
// collections that don't warrant a filing system.
const casual: OrganizationTemplate = {
  id: 'casual',
  title: 'Light Collection',
  description:
    'A handful of favourites, neatly sorted. No folders required — just save what you need and find it by name.',
  workspaceOverrides: {
    folderMode: 'grid' satisfies ViewMode,
    bookmarkSortMode: 'name' satisfies BookmarkSortMode,
    bookmarkSortDirection: 'asc' satisfies SortDirection,
  },
  settingsSummary: ['Grid view', 'Alphabetical order', 'Simple and browsable'],
};

// Researcher: power-user variant with recency-oriented sort (created desc = newest
// first). Structural shape is the same as power-user; temporal emphasis differs.
// Researcher is demoted to a temporal overlay on the classifier side — this bundle
// is a card choice in the picker even when the classifier does not preselect it.
const researcher: OrganizationTemplate = {
  id: 'researcher',
  title: 'Research Flow',
  description:
    'Folder-heavy like a library, sorted by when you saved it. Ideal for active research where the newest additions matter most.',
  workspaceOverrides: {
    folderMode: 'list' satisfies ViewMode,
    bookmarkSortMode: 'created' satisfies BookmarkSortMode,
    bookmarkSortDirection: 'desc' satisfies SortDirection,
  },
  settingsSummary: ['List view (compact)', 'Newest first', 'Folder-first navigation'],
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const ORGANIZATION_TEMPLATES: Record<ArchetypeId, OrganizationTemplate> = {
  hoarder,
  'power-user': powerUser,
  casual,
  researcher,
};

// Professional: workspace-split nudge metadata — NOT a bundle.
// Exposed as a separate named export so the picker can render it conditionally
// when overlays.professionalSplit is true, without polluting the 4-bundle record.
export const PROFESSIONAL_NUDGE: ProfessionalNudge = {
  title: 'Split Work & Personal',
  description:
    'Your bookmarks span multiple domains and contexts. Consider creating separate workspaces — one for work, one for personal — so each stays focused.',
  nudgeSummary: [
    'Create one workspace per context',
    'Switch between them with a keyboard shortcut',
    'Each workspace can have its own theme and layout',
  ],
};
