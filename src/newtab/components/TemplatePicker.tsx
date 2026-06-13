import type { ArchetypeMatch } from '../lib/archetype-match';
import type { ArchetypeId, OrganizationTemplate } from '@/shared/organization-templates';
import { ORGANIZATION_TEMPLATES, PROFESSIONAL_NUDGE } from '@/shared/organization-templates';
import { Ico } from './Ico';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TemplatePickerProps {
  match: ArchetypeMatch | null;
  selectedId: ArchetypeId | null;
  onSelect: (id: ArchetypeId | null) => void;
}

// ---------------------------------------------------------------------------
// Card order — all 4 always rendered as equal choices.
// ---------------------------------------------------------------------------

const CARD_ORDER: ArchetypeId[] = ['hoarder', 'power-user', 'casual', 'researcher'];

// ---------------------------------------------------------------------------
// Individual template card
// ---------------------------------------------------------------------------

interface TemplateCardProps {
  template: OrganizationTemplate;
  selected: boolean;
  recommended: boolean;
  whyReasons: string[];
  researcherHint: boolean;
  onSelect: () => void;
}

function TemplateCard({ template, selected, recommended, whyReasons, researcherHint, onSelect }: TemplateCardProps) {
  return (
    <button
      className="ff-template-card"
      data-archetype-id={template.id}
      data-selected={selected || undefined}
      data-recommended={recommended || undefined}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="ff-template-card__header">
        <div className="ff-template-card__title-row">
          <span className="ff-template-card__title">{template.title}</span>
          {recommended && (
            <span className="ff-template-card__badge" aria-label="Recommended for you">
              <Ico name="star" size={12} />
              Recommended
            </span>
          )}
          {selected && (
            <Ico name="check" size={14} className="ff-template-card__check" />
          )}
        </div>

        <p className="ff-template-card__desc">{template.description}</p>
      </div>

      <div className="ff-template-card__summary">
        {template.settingsSummary.map((line, i) => (
          <div key={i} className="ff-template-card__summary-item">
            <Ico name="check" size={11} className="ff-template-card__summary-icon" />
            <span>{line}</span>
          </div>
        ))}
      </div>

      {recommended && whyReasons.length > 0 && (
        <div className="ff-template-card__why">
          <span className="ff-template-card__why-label">Why this fits you:</span>
          <ul className="ff-template-card__why-list">
            {whyReasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {researcherHint && (
        <div className="ff-template-card__hint">
          Your saving pattern also has research-like activity — see Research Flow below.
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main TemplatePicker
// ---------------------------------------------------------------------------

export function TemplatePicker({ match, selectedId, onSelect }: TemplatePickerProps) {
  const recommendedId = match?.archetype ?? null;

  return (
    <div className="ff-template-picker">
      <div className="ff-template-picker__grid">
        {CARD_ORDER.map(id => {
          const template = ORGANIZATION_TEMPLATES[id];
          const recommended = id === recommendedId;
          // Researcher hint appears on the researcher card only when researcher
          // overlay is active on a non-researcher recommended archetype.
          const researcherHint =
            id === 'researcher' &&
            !recommended &&
            (match?.overlays.researcher ?? false);
          const whyReasons = recommended ? (match?.reasons ?? []) : [];

          return (
            <TemplateCard
              key={id}
              template={template}
              selected={selectedId === id}
              recommended={recommended}
              whyReasons={whyReasons}
              researcherHint={researcherHint}
              onSelect={() => onSelect(id)}
            />
          );
        })}
      </div>

      {match?.overlays.professionalSplit && (
        <div className="ff-template-picker__nudge">
          <div className="ff-template-picker__nudge-title">
            <Ico name="layers" size={14} />
            {PROFESSIONAL_NUDGE.title}
          </div>
          <p className="ff-template-picker__nudge-desc">{PROFESSIONAL_NUDGE.description}</p>
          <ul className="ff-template-picker__nudge-list">
            {PROFESSIONAL_NUDGE.nudgeSummary.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
