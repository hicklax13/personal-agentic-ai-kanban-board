import { useEffect, useId, useState } from 'react';
import type { Priority } from '@shared/types';

/**
 * The app's heraldic vocabulary, drawn once and reused everywhere.
 *
 * Agents bear tinctures: each has its own heraldic colour and, like an
 * engraved coat of arms, the Petra Sancta hatching that stands for that colour
 * in black and white. So an agent is told apart by pattern and letter as well
 * as by colour — nothing depends on seeing red from green.
 */

export type Tincture = 'or' | 'argent' | 'gules' | 'azure' | 'vert' | 'purpure' | 'tenne' | 'sable';

/** Field colour and the ink drawn on it (letter and hatching). */
const TINCTURES: Record<Tincture, { field: string; ink: string }> = {
  or: { field: '#C9A24A', ink: '#241A05' },
  argent: { field: '#C9CED4', ink: '#15171A' },
  gules: { field: '#A8222B', ink: '#FFFFFF' },
  azure: { field: '#2B50A8', ink: '#FFFFFF' },
  vert: { field: '#1E7442', ink: '#FFFFFF' },
  purpure: { field: '#6A3A8B', ink: '#FFFFFF' },
  tenne: { field: '#B45E1F', ink: '#FFFFFF' },
  sable: { field: '#2A2D33', ink: '#E8EAEC' },
};

/** Each agent's arms: tincture and the letter it bears. */
export const AGENT_ARMS: Record<string, { tincture: Tincture; letter: string; name: string }> = {
  'claude-code': { tincture: 'tenne', letter: 'C', name: 'Claude Code' },
  codex: { tincture: 'azure', letter: 'X', name: 'Codex' },
  hermes: { tincture: 'purpure', letter: 'H', name: 'Hermes' },
  ollama: { tincture: 'vert', letter: 'O', name: 'Ollama' },
  lmstudio: { tincture: 'argent', letter: 'L', name: 'LM Studio' },
};

/**
 * Petra Sancta hatching as SVG pattern content (a 6×6 tile). Argent is plain
 * by convention; or is dotted; gules vertical; azure horizontal; vert bendwise;
 * purpure bend sinister; tenné crossed diagonally; sable crossed.
 */
function hatch(t: Tincture, ink: string): React.JSX.Element | null {
  const s = { stroke: ink, strokeWidth: 1, strokeOpacity: 0.28 };
  switch (t) {
    case 'or':
      return <circle cx="3" cy="3" r="0.9" fill={ink} fillOpacity={0.3} />;
    case 'gules':
      return <path d="M3 0V6" {...s} />;
    case 'azure':
      return <path d="M0 3H6" {...s} />;
    case 'vert':
      return <path d="M0 0L6 6M-3 3L3 9M3 -3L9 3" {...s} />;
    case 'purpure':
      return <path d="M6 0L0 6M9 3L3 9M3 -3L-3 3" {...s} />;
    case 'tenne':
      return <path d="M0 0L6 6M6 0L0 6" {...s} />;
    case 'sable':
      return <path d="M3 0V6M0 3H6" {...s} />;
    default:
      return null;
  }
}

/** A heater shield outline in a 24×28 box. */
export const SHIELD_PATH = 'M2 2H22V13C22 20.5 17 24.8 12 26.5C7 24.8 2 20.5 2 13Z';

const SIZE: Record<Priority, number> = { urgent: 30, high: 26, normal: 23, low: 19 };

/**
 * An agent's escutcheon. Priority sets the size on a fixed ramp — urgent the
 * largest, with a gold bordure — so importance never rests on colour either.
 */
export function Escutcheon({
  agentId,
  priority = 'normal',
  muted = false,
  title,
}: {
  agentId: string | null;
  priority?: Priority;
  muted?: boolean;
  title?: string;
}): React.JSX.Element {
  const patternId = useId();
  const arms = agentId ? AGENT_ARMS[agentId] : undefined;
  const t: Tincture = arms?.tincture ?? 'sable';
  const { field, ink } = TINCTURES[t];
  const h = SIZE[priority];
  const w = Math.round((h * 24) / 28);
  const label = title ?? (arms ? `${arms.name}${priority !== 'normal' ? ` · ${priority} priority` : ''}` : 'No assignee');
  return (
    <svg
      className={`escutcheon${muted ? ' muted' : ''}`}
      width={w}
      height={h}
      viewBox="0 0 24 28"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <defs>
        <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse">
          {hatch(t, ink)}
        </pattern>
      </defs>
      {arms ? (
        <>
          <path d={SHIELD_PATH} fill={field} />
          <path d={SHIELD_PATH} fill={`url(#${patternId})`} />
          <path
            d={SHIELD_PATH}
            fill="none"
            stroke={priority === 'urgent' ? '#E8C872' : 'rgba(255,255,255,0.28)'}
            strokeWidth={priority === 'urgent' ? 2.2 : 1}
          />
          <text x="12" y="15.5" textAnchor="middle" fontSize="11" fontWeight="700" fill={ink} fontFamily="'Atkinson Hyperlegible Next', sans-serif">
            {arms.letter}
          </text>
        </>
      ) : (
        <>
          <path d={SHIELD_PATH} fill="none" stroke="#6E757D" strokeWidth="1.4" strokeDasharray="3 2.4" />
          <text x="12" y="15.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#9AA1A9" fontFamily="'Atkinson Hyperlegible Next', sans-serif">
            ?
          </text>
        </>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------- the crest

let brandRequest: Promise<string | null> | null = null;

/** The owner's crest, fetched once; null means none is installed. */
export function useCrest(): string | null {
  const [crest, setCrest] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    brandRequest ??= window.api
      .getBrand()
      .then((b) => b.crest)
      .catch(() => null);
    void brandRequest.then((c) => {
      if (alive) setCrest(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return crest;
}

/**
 * The crest at a given height — the owner's own when installed, otherwise a
 * plain gilded shield (the public build carries no family arms).
 */
export function Crest({ height, className = '' }: { height: number; className?: string }): React.JSX.Element {
  const crest = useCrest();
  const gold = useId();
  if (crest) {
    return <img className={`crest ${className}`} src={crest} alt="" height={height} draggable={false} />;
  }
  const w = Math.round((height * 24) / 28);
  return (
    <svg className={`crest crest-plain ${className}`} width={w} height={height} viewBox="0 0 24 28" aria-hidden="true">
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F0D68A" />
          <stop offset="1" stopColor="#9C7A2C" />
        </linearGradient>
      </defs>
      <path d={SHIELD_PATH} fill="#141519" stroke={`url(#${gold})`} strokeWidth="1.6" />
      <path d="M5.5 16.5L12 10L18.5 16.5" fill="none" stroke={`url(#${gold})`} strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------ the stations

/**
 * How a station's shield is filled. READY is gold; a station holding live,
 * stuck, finished or to-be-approved work takes that state's tincture, drawn
 * with its hatching too, so the states differ in pattern as well as colour.
 */
export type StationTone = 'plain' | 'or' | 'azure' | 'gules' | 'vert' | 'purpure';

const STATION_FILLS: Record<StationTone, { field: string; ink: string }> = {
  plain: { field: '#141519', ink: '#EEF0F2' },
  or: { field: '#C9A24A', ink: '#241A05' },
  azure: { field: '#2B50A8', ink: '#FFFFFF' },
  gules: { field: '#A8222B', ink: '#FFFFFF' },
  vert: { field: '#1E7442', ink: '#FFFFFF' },
  purpure: { field: '#6A3A8B', ink: '#FFFFFF' },
};

/** Silver edges, as on the crest; READY's gold shield takes a darker gold rim. */
const edgeOf = (tone: StationTone): string => (tone === 'or' ? '#8C6B22' : '#AEB4BB');

/**
 * A station's shield on the rail, carrying the count of cards it holds.
 * `lit` marks the selected card's station ('here') and where it goes next ('next').
 */
export function StationShield({
  count,
  tone,
  lit = null,
}: {
  count: number;
  tone: StationTone;
  lit?: 'here' | 'next' | null;
}): React.JSX.Element {
  const patternId = useId();
  const { field, ink } = STATION_FILLS[tone];
  const hatched = tone !== 'plain';
  return (
    <svg
      className={`station-shield tone-${tone}${lit ? ` lit-${lit}` : ''}`}
      width="30"
      height="35"
      viewBox="0 0 24 28"
      aria-hidden="true"
    >
      {hatched ? (
        <defs>
          <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse">
            {hatch(tone, ink)}
          </pattern>
        </defs>
      ) : null}
      <path d={SHIELD_PATH} fill={field} />
      {hatched ? <path d={SHIELD_PATH} fill={`url(#${patternId})`} /> : null}
      <path className="shield-edge" d={SHIELD_PATH} fill="none" stroke={edgeOf(tone)} strokeWidth="1.6" />
      <text x="12" y="15.8" textAnchor="middle" fontSize={count > 99 ? 8 : 10.5} fontWeight="700" fill={ink} fontFamily="'Atkinson Hyperlegible Next', sans-serif">
        {count > 99 ? '99+' : count}
      </text>
    </svg>
  );
}

/** The same shield at text size, for status lines that point at a station. */
export function StationMark({ tone }: { tone: StationTone }): React.JSX.Element {
  return (
    <svg className={`station-mark tone-${tone}`} width="12" height="14" viewBox="0 0 24 28" aria-hidden="true">
      <path d={SHIELD_PATH} fill={STATION_FILLS[tone].field} stroke={edgeOf(tone)} strokeWidth="2.6" />
    </svg>
  );
}
