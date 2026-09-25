import { useMemo, useState } from 'react';

export interface Option {
  id: string;
  name: string;
  description?: string;
  /** Rendered but not selectable, with the reason shown. */
  disabled?: boolean;
  disabledReason?: string;
}

interface Props {
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Shown when nothing matches the filter or the list is empty. */
  emptyText: string;
  searchPlaceholder?: string;
}

/**
 * A filterable checkbox list.
 *
 * The search box is not decoration: this machine exposes ~450 skills and 25 MCP
 * servers, and an unfiltered list of that size is unusable. Selected items are
 * hoisted to the top so a choice never scrolls out of sight behind a filter.
 */
export default function MultiSelect({
  options,
  selected,
  onChange,
  emptyText,
  searchPlaceholder = 'Filter…',
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            o.id.toLowerCase().includes(q) ||
            (o.description ?? '').toLowerCase().includes(q),
        )
      : options;

    const chosen = new Set(selected);
    return [...matches].sort((a, b) => {
      const aSel = chosen.has(a.id) ? 0 : 1;
      const bSel = chosen.has(b.id) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return a.name.localeCompare(b.name);
    });
  }, [options, query, selected]);

  const toggle = (id: string): void => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  return (
    <div className="multiselect">
      <input
        className="ms-search"
        value={query}
        placeholder={searchPlaceholder}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="ms-list">
        {visible.length === 0 ? (
          <div className="ms-empty">{options.length === 0 ? emptyText : 'No matches.'}</div>
        ) : (
          visible.map((o) => (
            <label
              key={o.id}
              className="ms-item"
              title={o.disabled ? o.disabledReason : (o.description ?? o.id)}
            >
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                disabled={o.disabled}
                onChange={() => toggle(o.id)}
              />
              <span className="ms-text">
                <span className="ms-name">{o.name}</span>
                {o.description ? <span className="ms-desc">{o.description}</span> : null}
              </span>
            </label>
          ))
        )}
      </div>
      <div className="ms-foot">
        <span>
          {selected.length} selected of {options.length}
        </span>
        <span className="spacer" />
        {selected.length > 0 ? (
          <button type="button" className="ghost" onClick={() => onChange([])}>
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
