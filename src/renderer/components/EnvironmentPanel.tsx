import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CircleCheck, CircleX, RefreshCw } from 'lucide-react';
import type { DiscoveredMcpServer, DiscoveryReport } from '@shared/types';
import { plainStatus } from './status.js';

/**
 * Everything the last scan found, with every count opening into its items and
 * every MCP server offering its owner's browser sign-in.
 */

interface Row {
  key: string;
  title: string;
  detail?: string;
  dot?: 'available' | 'degraded' | 'unavailable';
}

function Expander({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="expander">
      <button
        type="button"
        className="expander-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="chevron" aria-hidden="true">
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
        <span className="expander-label">{label}</span>
        <strong>{count}</strong>
      </button>
      {open ? <div className="expander-body">{children}</div> : null}
    </div>
  );
}

/** A filterable list; long lists (hundreds of skills) are unusable without the filter. */
function FilterList({ rows, empty }: { rows: Row[]; empty: string }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? rows.filter((r) => r.title.toLowerCase().includes(q) || (r.detail ?? '').toLowerCase().includes(q))
      : rows;
  }, [rows, query]);

  if (rows.length === 0) return <div className="ms-empty">{empty}</div>;
  return (
    <>
      {rows.length > 8 ? (
        <input
          className="filter-input"
          placeholder={`Filter ${rows.length} items…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      <div className="filter-list">
        {visible.map((r) => (
          <div className="filter-row" key={r.key}>
            {r.dot ? <span className={`dot ${r.dot}`} /> : null}
            <div className="filter-text">
              <div className="filter-title">{r.title}</div>
              {r.detail ? <div className="filter-detail">{r.detail}</div> : null}
            </div>
          </div>
        ))}
        {visible.length === 0 ? <div className="ms-empty">No matches.</div> : null}
      </div>
    </>
  );
}

type SignInState = { status: 'waiting' | 'done' | 'failed'; text?: string; link?: string };

function McpServerRow({
  server,
  state,
  onSignIn,
}: {
  server: DiscoveredMcpServer;
  state: SignInState | undefined;
  onSignIn: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const waiting = state?.status === 'waiting';
  return (
    <div className="mcp-row">
      <div className="mcp-head">
        <button type="button" className="mcp-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="chevron" aria-hidden="true">
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
          <span className={`dot ${server.availability}`} />
          <span className="mcp-name">{server.name}</span>
          <span className="mcp-status">{plainStatus(server.statusDetail)}</span>
        </button>
        {server.signIn === 'oauth' ? (
          <button
            type="button"
            disabled={waiting}
            onClick={onSignIn}
            title={`Open the sign-in page for ${server.name} in your default browser`}
          >
            {waiting ? 'Waiting…' : server.availability === 'available' ? 'Sign in again' : 'Sign in'}
          </button>
        ) : null}
      </div>
      {waiting ? (
        <div className="mcp-note">
          Finish signing in in your browser and grant access…{' '}
          {state?.link ? (
            <a href={state.link} target="_blank" rel="noreferrer">
              Browser did not open? Open the sign-in page
            </a>
          ) : null}
        </div>
      ) : null}
      {state && state.status !== 'waiting' ? (
        <div className={state.status === 'done' ? 'mcp-note' : 'mcp-note sr-fix'}>
          {state.status === 'done' ? (
            <CircleCheck className="inline-icon ok" size={14} aria-label="Succeeded" />
          ) : (
            <CircleX className="inline-icon fail" size={14} aria-label="Failed" />
          )}{' '}
          {state.text}
        </div>
      ) : null}
      {open ? (
        <div className="mcp-detail">
          <div>
            <span className="mcp-key">Owner</span> {server.ownerName}
          </div>
          <div>
            <span className="mcp-key">Transport</span> {server.kind}
          </div>
          <div>
            <span className="mcp-key">Target</span> <code className="inline">{server.target || '—'}</code>
          </div>
          <div>
            <span className="mcp-key">Sign-in</span>{' '}
            {server.signIn === 'oauth'
              ? `Browser sign-in through ${server.ownerName}`
              : 'None needed (local program or no OAuth)'}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function EnvironmentPanel({
  discovery,
  boardPath,
  busy,
  onRescan,
}: {
  discovery: DiscoveryReport | null;
  boardPath: string;
  busy: boolean;
  onRescan: () => Promise<void>;
}): React.JSX.Element {
  const [signIns, setSignIns] = useState<Record<string, SignInState>>({});

  useEffect(
    () =>
      window.api.onMcpSignInProgress((p) =>
        setSignIns((s) => ({ ...s, [`${p.owner}/${p.name}`]: { status: 'waiting', link: p.url } })),
      ),
    [],
  );

  if (!discovery) return <div className="empty-state">Discovery has not completed yet.</div>;

  const signIn = async (server: DiscoveredMcpServer): Promise<void> => {
    const key = `${server.owner}/${server.name}`;
    setSignIns((s) => ({ ...s, [key]: { status: 'waiting' } }));
    const result = await window.api.mcpSignIn(server.owner, server.name);
    setSignIns((s) => ({
      ...s,
      [key]: {
        status: result.ok ? 'done' : 'failed',
        text: result.ok ? `${result.detail} Rescan to refresh the status.` : result.detail,
      },
    }));
  };

  const agents: Row[] = discovery.agents.map((a) => ({
    key: a.id,
    title: `${a.name}${a.version ? ` — ${a.version}` : ''}`,
    detail: a.statusDetail,
    dot: a.availability,
  }));
  const providers: Row[] = discovery.providers.map((p) => ({
    key: p.id,
    title: p.name,
    detail: `${p.models.length} models${p.live ? ' · live' : ''}${p.efforts.length ? ` · effort: ${p.efforts.join(', ')}` : ''}${p.modelsError ? ` · ${p.modelsError}` : ''}`,
    dot: p.availability,
  }));
  const models: Row[] = discovery.providers.flatMap((p) =>
    p.models.map((m) => ({
      key: `${p.id}/${m.id}`,
      title: m.name,
      detail: `${p.name}${m.efforts?.length ? ` · effort: ${m.efforts.join(', ')}` : ''}${m.contextLength ? ` · ${m.contextLength.toLocaleString()} context` : ''}`,
    })),
  );
  const mcpRows = (list: DiscoveredMcpServer[]): Row[] =>
    list.map((s) => ({
      key: s.id,
      title: s.name,
      detail: `${s.ownerName} · ${plainStatus(s.statusDetail)}`,
      dot: s.availability,
    }));
  const plugins: Row[] = discovery.plugins.map((p) => ({
    key: p.id,
    title: p.name,
    detail: `${p.marketplace}${p.enabled ? '' : ' · disabled'}`,
    dot: p.enabled ? 'available' : 'unavailable',
  }));
  const skills: Row[] = discovery.skills.map((s) => ({
    key: s.id,
    title: s.name,
    detail: `${s.source}${s.description ? ` · ${s.description}` : ''}`,
  }));
  const tools: Row[] = discovery.tools.map((t) => ({
    key: t.id,
    title: t.name,
    detail: `${t.agentIds.join(', ')} · ${t.description}`,
  }));

  const owners = ['claude-code', 'codex', 'hermes'];
  const connected = discovery.mcpServers.filter((s) => s.availability === 'available');
  const needSignIn = discovery.mcpServers.filter(
    (s) => s.signIn === 'oauth' && s.availability !== 'available',
  ).length;

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => void onRescan()} disabled={busy} style={{ flex: '0 0 auto' }}>
          <RefreshCw size={14} aria-hidden="true" />
          {busy ? 'Rescanning…' : 'Rescan environment'}
        </button>
      </div>
      <div className="hint" style={{ marginBottom: 10 }}>
        Scanned {new Date(discovery.scannedAt).toLocaleString()} on {discovery.platform}. Click any line
        to see its items.
      </div>

      {discovery.warnings.map((w, i) => (
        <div className="banner warn" key={i}>
          {w}
        </div>
      ))}

      <fieldset className="group">
        <legend>Counts</legend>
        <Expander label="Agents" count={agents.length}>
          <FilterList rows={agents} empty="No agents found." />
        </Expander>
        <Expander label="Agents available" count={agents.filter((a) => a.dot === 'available').length}>
          <FilterList rows={agents.filter((a) => a.dot === 'available')} empty="None available." />
        </Expander>
        <Expander label="Providers" count={providers.length}>
          <FilterList rows={providers} empty="No providers found." />
        </Expander>
        <Expander label="Models" count={models.length}>
          <FilterList rows={models} empty="No models found." />
        </Expander>
        <Expander label="MCP servers" count={discovery.mcpServers.length}>
          <FilterList rows={mcpRows(discovery.mcpServers)} empty="No MCP servers found." />
        </Expander>
        <Expander label="MCP connected" count={connected.length}>
          <FilterList rows={mcpRows(connected)} empty="None connected." />
        </Expander>
        <Expander label="Plugins" count={plugins.length}>
          <FilterList rows={plugins} empty="No plugins found." />
        </Expander>
        <Expander label="Skills" count={skills.length}>
          <FilterList rows={skills} empty="No skills found." />
        </Expander>
        <Expander label="Tools" count={tools.length}>
          <FilterList rows={tools} empty="No tools found." />
        </Expander>
      </fieldset>

      <fieldset className="group">
        <legend>MCP servers</legend>
        <div className="hint" style={{ marginBottom: 8 }}>
          {needSignIn > 0 ? `${needSignIn} need a sign-in. ` : ''}Sign in opens your default browser at
          the service&apos;s own consent page; the agent that owns the server stores the result. Each
          agent keeps its own list, so a server can appear under more than one.
        </div>
        {owners.map((owner) => {
          const list = discovery.mcpServers.filter((s) => s.owner === owner);
          if (list.length === 0) return null;
          return (
            <div className="mcp-group" key={owner}>
              <div className="mcp-group-head">
                {list[0].ownerName} · {list.length} server{list.length === 1 ? '' : 's'}
              </div>
              {list.map((s) => (
                <McpServerRow
                  key={s.id}
                  server={s}
                  state={signIns[`${s.owner}/${s.name}`]}
                  onSignIn={() => void signIn(s)}
                />
              ))}
            </div>
          );
        })}
      </fieldset>

      <div className="hint">Board file: {boardPath}</div>
    </>
  );
}
