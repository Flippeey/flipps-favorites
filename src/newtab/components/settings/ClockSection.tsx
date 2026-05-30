import { Segmented, Toggle } from '../settings-controls';
import type { SectionProps } from './types';

export function ClockSection({ settings, onPatch }: SectionProps) {
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Clock & greeting</h3>
      <p className="ff-set-section__desc">Show the time above the search bar.</p>
      <div className="ff-card">
        <div className="ff-row">
          <div className="ff-row__label">Show clock</div>
          <Toggle on={settings.showClock} onChange={(v) => onPatch({ showClock: v })} />
        </div>
        <div className="ff-row">
          <div className="ff-row__label">Hour format</div>
          <Segmented<'24' | '12'>
            options={[{ id: '24', label: '24 h' }, { id: '12', label: '12 h' }]}
            value={settings.clockHourFormat}
            onChange={(v) => onPatch({ clockHourFormat: v })}
          />
        </div>
      </div>
    </div>
  );
}
