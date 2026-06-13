// Archetype classifier — maps a TreeProfile to a base archetype + overlay signals.
//
// Base classes: hoarder | power-user | casual | null
// Researcher is DEMOTED to a temporal overlay on power-user (Abrams 1998: researcher
// structurally collapses into power-user over 3 empirically separated classes).
//
// All cutoffs are named constants with one-line rationale comments.
// The descope fallback (CLASSIFY_DISABLED) forces classify() to return neutral
// without touching the picker.

import type { TreeProfile } from './tree-profile';
import type { ArchetypeId } from '@/shared/organization-templates';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ArchetypeMatch {
  /** hoarder | power-user | casual | null. Researcher is an overlay only. */
  archetype: Exclude<ArchetypeId, 'researcher'> | null;
  /** 0–1. Populated only when archetype is non-null. */
  confidence: number;
  overlays: {
    /** True when base=power-user AND recency+foldering both exceed thresholds. */
    researcher: boolean;
    /** True when structural signals suggest mixed work/personal content. */
    professionalSplit: boolean;
  };
  /** Non-empty for any non-null match; describes why the archetype was chosen. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Descope fallback — single exported flag.
// Flip to `true` at deploy time to disable preselection without touching the picker.
// ---------------------------------------------------------------------------
export const CLASSIFY_DISABLED = false;

// ---------------------------------------------------------------------------
// Constants — each with a one-line rationale comment
// ---------------------------------------------------------------------------

// Minimum bookmarks before classification is meaningful.
// Abrams 1998: behavioural patterns are not visible below ~10 items.
const MIN_BOOKMARKS_FOR_CLASSIFICATION = 10;

// Casual users rarely exceed ~35 bookmarks before abandoning foldering.
// Empirical foldering threshold from Abrams 1998 + Bergman 2021.
const CASUAL_MAX_BOOKMARKS = 35;

// At >=300 bookmarks users are almost certainly filing-at-creation (power-user)
// unless disorder signals fire. Abrams 1998: 67% of heavy users file at creation.
const HIGH_VOLUME_ORGANIZED = 300;

// A hoarder folder is "giant" when it holds >=40% of all bookmarks.
// Mirrors tree-profile's GIANT_FOLDER_MIN constant — kept in sync.
const HOARDER_GIANT_FOLDER_THRESHOLD = 0.40;

// A folderedRatio below this is consistent with flat/hoarder behaviour.
// Chosen so that ~90% of bookmarks at root level counts as "effectively flat".
const HOARDER_MAX_FOLDERED_RATIO = 0.20;

// A hoarder duplicate rate above this is a disorder signal.
// 5%+ duplication suggests careless saving rather than deliberate curation.
const HOARDER_MIN_DUPLICATE_RATE = 0.05;

// Minimum folderedRatio for a power-user base classification.
// Power-users file deliberately; at least half their bookmarks are foldered.
const POWER_USER_MIN_FOLDERED_RATIO = 0.50;

// Minimum folderedRatio for the researcher overlay.
// Researcher behaviour requires a file-at-creation habit (high foldering).
const RESEARCHER_MIN_FOLDERED_RATIO = 0.70;

// Minimum recentAdditionRatio for the researcher overlay.
// High recency (>= 40% of bookmarks added recently) signals active research.
const RESEARCHER_MIN_RECENT_RATIO = 0.40;

// professionalSplit overlay: high domain diversity on a large collection
// suggests mixed work/personal content. Diversity >= 0.6 and >= 200 bookmarks.
const PROFESSIONAL_SPLIT_MIN_DIVERSITY = 0.60;
const PROFESSIONAL_SPLIT_MIN_BOOKMARKS = 200;

// Confidence margin rule: the winning score must beat the runner-up by at least
// this margin, AND clear the floor, for classification to be non-null.
// Prevents noisy preselection on ambiguous profiles.
const CONFIDENCE_MARGIN = 0.12;
const CONFIDENCE_FLOOR = 0.20;

// ---------------------------------------------------------------------------
// Scoring internals
// ---------------------------------------------------------------------------

type BaseClass = Exclude<ArchetypeId, 'researcher'>;

interface Scored {
  score: number;
  reasons: string[];
}

function scoreHoarder(p: TreeProfile): Scored {
  const reasons: string[] = [];
  let score = 0;

  // Core disorder signal: flat structure (low folderedRatio)
  if (p.folderedRatio <= HOARDER_MAX_FOLDERED_RATIO) {
    const contribution = 0.40 * (1 - p.folderedRatio / HOARDER_MAX_FOLDERED_RATIO);
    score += contribution;
    reasons.push(`${Math.round(p.folderedRatio * 100)}% of bookmarks are nested (mostly flat structure)`);
  }

  // Giant-folder presence: one folder dominates the collection
  if (p.giantFolderShare >= HOARDER_GIANT_FOLDER_THRESHOLD) {
    const contribution = 0.30 * Math.min((p.giantFolderShare - HOARDER_GIANT_FOLDER_THRESHOLD) / 0.60 + 0.5, 1.0);
    score += contribution;
    reasons.push(`${Math.round(p.giantFolderShare * 100)}% of bookmarks are in oversized folders`);
  }

  // Duplicate URLs as disorder signal
  if (p.duplicateUrlRate >= HOARDER_MIN_DUPLICATE_RATE) {
    const contribution = 0.15 * Math.min(p.duplicateUrlRate / 0.20, 1.0);
    score += contribution;
    reasons.push(`${Math.round(p.duplicateUrlRate * 100)}% duplicate URLs detected`);
  }

  // Volume reinforces hoarder when disorder is already signalled
  if (p.totalBookmarks > CASUAL_MAX_BOOKMARKS && score > 0.20) {
    score += 0.15;
    reasons.push(`${p.totalBookmarks} bookmarks in a flat or disordered tree`);
  }

  return { score, reasons };
}

function scorePowerUser(p: TreeProfile): Scored {
  const reasons: string[] = [];
  let score = 0;

  // High foldering is the primary power-user signal
  if (p.folderedRatio >= POWER_USER_MIN_FOLDERED_RATIO) {
    const contribution = 0.40 * Math.min((p.folderedRatio - POWER_USER_MIN_FOLDERED_RATIO) / 0.50 + 0.5, 1.0);
    score += contribution;
    reasons.push(`${Math.round(p.folderedRatio * 100)}% of bookmarks are organized into folders`);
  }

  // Deep hierarchy reinforces power-user
  if (p.maxDepth >= 2) {
    const contribution = 0.20 * Math.min((p.maxDepth - 1) / 4, 1.0);
    score += contribution;
    reasons.push(`Folder depth of ${p.maxDepth} levels indicates deliberate structure`);
  }

  // Low duplicate rate = curation discipline
  if (p.giantFolderShare < HOARDER_GIANT_FOLDER_THRESHOLD && p.duplicateUrlRate < HOARDER_MIN_DUPLICATE_RATE) {
    score += 0.15;
    reasons.push('Well-curated: no oversized folders and minimal duplicates');
  }

  // Volume with organization (>= HIGH_VOLUME_ORGANIZED) strongly favours power-user
  if (p.totalBookmarks >= HIGH_VOLUME_ORGANIZED) {
    score += 0.25;
    reasons.push(`${p.totalBookmarks} bookmarks with deliberate organization`);
  }

  return { score, reasons };
}

function scoreCasual(p: TreeProfile): Scored {
  const reasons: string[] = [];
  let score = 0;

  // Small collection is the primary casual signal
  if (p.totalBookmarks <= CASUAL_MAX_BOOKMARKS) {
    const normalised = 1 - p.totalBookmarks / CASUAL_MAX_BOOKMARKS;
    score += 0.60 * (0.5 + normalised * 0.5);
    reasons.push(`${p.totalBookmarks} bookmarks — a small, manageable collection`);
  }

  // Low foldering reinforces casual (they haven't felt the need to organise)
  if (p.folderedRatio < 0.50 && p.totalBookmarks <= CASUAL_MAX_BOOKMARKS) {
    score += 0.20;
    reasons.push('Minimal folder usage suggests an ad-hoc saving style');
  }

  return { score, reasons };
}

// ---------------------------------------------------------------------------
// Overlay logic
// ---------------------------------------------------------------------------

function computeResearcherOverlay(base: BaseClass | null, p: TreeProfile): boolean {
  if (base !== 'power-user') return false;
  return (
    p.recentAdditionRatio >= RESEARCHER_MIN_RECENT_RATIO &&
    p.folderedRatio >= RESEARCHER_MIN_FOLDERED_RATIO
  );
}

function computeProfessionalSplitOverlay(p: TreeProfile): boolean {
  return (
    p.totalBookmarks >= PROFESSIONAL_SPLIT_MIN_BOOKMARKS &&
    p.domainDiversity >= PROFESSIONAL_SPLIT_MIN_DIVERSITY
  );
}

// ---------------------------------------------------------------------------
// Public classify function
// ---------------------------------------------------------------------------

const NEUTRAL: ArchetypeMatch = {
  archetype: null,
  confidence: 0,
  overlays: { researcher: false, professionalSplit: false },
  reasons: [],
};

export function classify(profile: TreeProfile): ArchetypeMatch {
  // Descope fallback: single-flag escape hatch for shipping without preselection.
  if (CLASSIFY_DISABLED) return NEUTRAL;

  // Tiny or empty trees have no meaningful signal.
  if (profile.totalBookmarks < MIN_BOOKMARKS_FOR_CLASSIFICATION) return NEUTRAL;

  // Score each base class.
  const scores: Record<BaseClass, Scored> = {
    hoarder: scoreHoarder(profile),
    'power-user': scorePowerUser(profile),
    casual: scoreCasual(profile),
  };

  // Find top two scores.
  const ranked = (Object.entries(scores) as [BaseClass, Scored][]).sort(
    (a, b) => b[1].score - a[1].score,
  );
  const [first, second] = ranked;
  const winner: BaseClass = first[0];
  const winnerScore = first[1].score;
  const winnerReasons = first[1].reasons;
  const runnerUpScore = second[1].score;

  // Volume bias toward power-user is handled inside scorePowerUser (the
  // HIGH_VOLUME_ORGANIZED +0.25, plus the +0.15 well-curated bonus), so at
  // >=300 organized bookmarks power-user wins natively. No post-hoc promotion.

  // Margin rule: winner must beat runner-up by CONFIDENCE_MARGIN AND clear CONFIDENCE_FLOOR.
  const margin = winnerScore - runnerUpScore;
  if (margin < CONFIDENCE_MARGIN || winnerScore < CONFIDENCE_FLOOR) {
    return NEUTRAL;
  }

  // Confidence is the normalised margin (capped at 1).
  const confidence = Math.min(winnerScore, 1);

  const professionalSplit = computeProfessionalSplitOverlay(profile);
  const researcher = computeResearcherOverlay(winner, profile);

  return {
    archetype: winner,
    confidence,
    overlays: { researcher, professionalSplit },
    reasons: winnerReasons,
  };
}
