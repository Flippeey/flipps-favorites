import { useEffect, useRef, useState } from 'react';
import { Ico } from './Ico';

export interface ContextMenuItem {
  kind: 'item' | 'separator';
  icon?: string;
  label?: string;
  kbd?: string;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [hovered, setHovered] = useState(-1);

  useEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const PAD = 8;
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - PAD) left = window.innerWidth - r.width - PAD;
    if (top + r.height > window.innerHeight - PAD) top = window.innerHeight - r.height - PAD;
    setPos({ left, top });
  }, [x, y, items]);

  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      const enabled = items
        .map((it, i) => (it.kind !== 'separator' && !it.disabled) ? i : -1)
        .filter(i => i >= 0);
      if (enabled.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = enabled.indexOf(hovered);
        setHovered(cur === -1 ? enabled[0] : enabled[(cur + 1) % enabled.length]);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const cur = enabled.indexOf(hovered);
        setHovered(cur === -1 ? enabled[enabled.length - 1] : enabled[(cur - 1 + enabled.length) % enabled.length]);
      } else if (e.key === 'Enter' && hovered >= 0) {
        e.preventDefault();
        items[hovered]?.onClick?.();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [items, hovered, onClose]);

  return (
    <div ref={ref} className="ff-ctx" role="menu" style={{ left: pos.left, top: pos.top }}>
      {items.map((it, i) => (
        it.kind === 'separator' ? (
          <div key={i} className="ff-ctx__sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            data-hovered={hovered === i}
            data-destructive={!!it.destructive}
            className="ff-ctx__item"
            onMouseEnter={() => setHovered(i)}
            onClick={() => { if (!it.disabled) { it.onClick?.(); onClose(); } }}
          >
            <span className="ff-ctx__icon" aria-hidden="true">
              {it.icon && <Ico name={it.icon} size={14} />}
            </span>
            <span className="ff-ctx__label">{it.label}</span>
            {it.kbd && <span className="ff-ctx__kbd">{it.kbd}</span>}
          </button>
        )
      ))}
    </div>
  );
}
