import { useMemo, useState } from 'react';
import type {
  Card,
  CardAgentConfig,
  ChatSession,
  DiscoveryReport,
  Priority,
  ProviderDefault,
} from '@shared/types';
import { PRIORITIES } from '@shared/types';
import { latestRun } from '@shared/boardOps';
import { AGENT_DEFAULT_PROVIDER, AGENT_EFFORTS, resolveRunSettings } from '@shared/runSettings';
import MultiSelect, { type Option } from './MultiSelect.js';
import { effortsFor } from './ProviderPicker.js';

interface Props {
  card: Card;
  discovery: DiscoveryReport | null;
  chatSessions: ChatSession[];
  isRunning: boolean;
  /** Where agents run when this card sets no folder of its own. */
  workspaceRoot: string | null;
  /** Saved per-provider defaults, shown as what a blank field will use. */
  providerDefaults: Record<string, ProviderDefault>;
  onPatchCard: (patch: Partial<Omit<Card, 'id' | 'config' | 'runs'>>) => void;
  onPatchConfig: (patch: Partial<CardAgentConfig>) => void;
  onDelete: () => void;
  onDispatch: () => void;
  onCancel: () => void;
  onCreateChatSession: (name: string) => string;
  onClose: () => void;
}

/**
 * The per-card configuration panel.
 *
 * Its guiding rule is that a control never lies about what it does. Each
 * scoping list is checked against the selected agent's real capability flags,
 * and where the agent's CLI has no flag to enforce a choice the control still
 * appears — the spec calls for it — but is labelled "recorded only". Silently
 * accepting a selection that will not be applied is the worst of both worlds.
 */
export default function CardDetail({
  card,
  discovery,
  chatSessions,
  isRunning,
  workspaceRoot,
  providerDefaults,
  onPatchCard,
  onPatchConfig,
  onDelete,
  onDispatch,
  onCancel,
  onCreateChatSession,
  onClose,
}: Props): React.JSX.Element {
  const [showTranscript, setShowTranscript] = useState(false);

  const agent = discovery?.agents.find((a) => a.id === card.config.agentId) ?? null;

  const providers = useMemo(() => {
    if (!discovery) return [];
    if (!card.config.agentId) return discovery.providers;
    return discovery.providers.filter((p) => p.agentIds.includes(card.config.agentId as string));
  }, [discovery, card.config.agentId]);

  const models = useMemo(() => {
    const provider = providers.find((p) => p.id === card.config.providerId);
    if (provider) return provider.models;
    // No provider chosen yet: offer every model this agent could reach, so the
    // dropdown is useful before the user has narrowed things down.
    return providers.flatMap((p) => p.models);
  }, [providers, card.config.providerId]);

  // What blank provider, model and effort fields will turn into at dispatch —
  // the same rule the main process applies, so the hint is never wrong.
  const fallback = resolveRunSettings({ ...card.config, model: null, effort: null }, providerDefaults);
  const agentId = card.config.agentId ?? '';
  const activeProvider = providers.find(
    (p) => p.id === (card.config.providerId ?? fallback.providerId ?? AGENT_DEFAULT_PROVIDER[agentId]),
  );
  const effortOptions = activeProvider
    ? effortsFor(activeProvider, card.config.model ?? fallback.model)
    : (AGENT_EFFORTS[agentId] ?? []);

  const toolOptions: Option[] = useMemo(() => {
    if (!discovery) return [];
    const forAgent = card.config.agentId
      ? discovery.tools.filter((t) => t.agentIds.includes(card.config.agentId as string))
      : discovery.tools;
    return forAgent.map((t) => ({ id: t.name, name: t.name, description: t.description }));
  }, [discovery, card.config.agentId]);

  const mcpOptions: Option[] = useMemo(
    () =>
      (discovery?.mcpServers ?? [])
        // Each agent can only reach the servers in its own configuration.
        .filter((s) => !card.config.agentId || s.owner === card.config.agentId)
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: `${s.ownerName} · ${s.availability} — ${s.statusDetail}`,
          disabled: s.availability === 'unavailable',
          disabledReason: s.statusDetail,
        })),
    [discovery, card.config.agentId],
  );

  const pluginOptions: Option[] = useMemo(
    () =>
      (discovery?.plugins ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        description: `${p.marketplace}${p.enabled ? '' : ' — disabled globally'}`,
        disabled: !p.enabled,
        disabledReason: 'This plugin is disabled in the global Claude settings.',
      })),
    [discovery],
  );

  const skillOptions: Option[] = useMemo(
    () =>
      (discovery?.skills ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description || s.source,
      })),
    [discovery],
  );

  const run = latestRun(card);
  const canDispatch = Boolean(card.config.agentId) && !isRunning;

  /** Explains whether a scoping choice is actually enforced by the chosen agent. */
  const enforcement = (supported: boolean | undefined, flag: string): React.JSX.Element => {
    if (!card.config.agentId) {
      return <div className="hint">Choose an agent to see whether this is enforced.</div>;
    }
    return supported ? (
      <div className="hint">
        Enforced — passed to the agent as <code className="inline">{flag}</code>.
      </div>
    ) : (
      <div className="hint warn">
        Recorded on the card only — {agent?.name ?? 'this agent'} has no flag for this, so the
        selection is saved but not applied at run time.
      </div>
    );
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Card</h2>
        <button type="button" className="ghost" onClick={onClose} title="Close panel">
          ✕
        </button>
      </div>

      <div className="panel-body">
        {/* ------------------------------------------------------- basics */}
        <div className="field">
          <label htmlFor="card-title">Title</label>
          <input
            id="card-title"
            value={card.title}
            onChange={(e) => onPatchCard({ title: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="card-desc">Description</label>
          <textarea
            id="card-desc"
            rows={3}
            value={card.description}
            onChange={(e) => onPatchCard({ description: e.target.value })}
            placeholder="Background the agent should know. Sent above the prompt."
          />
        </div>

        <div className="field row">
          <div>
            <label htmlFor="card-pri">Priority</label>
            <select
              id="card-pri"
              value={card.priority}
              onChange={(e) => onPatchCard({ priority: e.target.value as Priority })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="card-session">Chat session</label>
            <select
              id="card-session"
              value={card.config.chatSessionId ?? ''}
              onChange={(e) => {
                if (e.target.value === '__new__') {
                  const name = window.prompt('Name for the new chat session:');
                  if (name?.trim()) {
                    onPatchConfig({ chatSessionId: onCreateChatSession(name.trim()) });
                  }
                  return;
                }
                onPatchConfig({ chatSessionId: e.target.value || null });
              }}
            >
              <option value="">(one-off — no shared thread)</option>
              {chatSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.nativeSessionId ? ' ·  resumable' : ''}
                </option>
              ))}
              <option value="__new__">+ New session…</option>
            </select>
          </div>
        </div>

        {/* -------------------------------------------------------- agent */}
        <fieldset className="group">
          <legend>Agent &amp; model</legend>

          <div className="field">
            <label htmlFor="card-agent">Assigned agent</label>
            <select
              id="card-agent"
              value={card.config.agentId ?? ''}
              onChange={(e) =>
                // Provider and model belong to the old agent; keeping them would
                // send a model the new agent has never heard of.
                onPatchConfig({
                  agentId: e.target.value || null,
                  providerId: null,
                  model: null,
                  effort: null,
                  allowedTools: [],
                })
              }
            >
              <option value="">(none)</option>
              {(discovery?.agents ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.availability === 'available'
                    ? ''
                    : a.availability === 'degraded'
                      ? '  · needs attention'
                      : '  · NOT CONNECTED'}
                </option>
              ))}
            </select>
            {agent ? (
              <div className={`hint ${agent.availability === 'available' ? '' : 'warn'}`}>
                <span className={`dot ${agent.availability}`} /> {agent.statusDetail}
                {agent.remediation ? ` — ${agent.remediation}` : ''}
              </div>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="card-provider">Model provider</label>
            <select
              id="card-provider"
              value={card.config.providerId ?? ''}
              onChange={(e) => onPatchConfig({ providerId: e.target.value || null, model: null })}
              disabled={!card.config.agentId}
            >
              <option value="">(agent default)</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.live ? ' · live' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="card-model">Model</label>
            <input
              id="card-model"
              list="card-model-list"
              value={card.config.model ?? ''}
              placeholder={
                fallback.model
                  ? `Default: ${fallback.model} — pick from the list or type any id`
                  : '(agent default) — pick from the list or type any id'
              }
              onChange={(e) => onPatchConfig({ model: e.target.value || null })}
            />
            <datalist id="card-model-list">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </datalist>
            <div className="hint">
              {models.length} models available. Free text is allowed too, so a model missing from a
              list can still be used.
            </div>
          </div>

          <div className="field">
            <label htmlFor="card-effort">{activeProvider?.effortLabel ?? 'Effort'}</label>
            <select
              id="card-effort"
              value={card.config.effort ?? ''}
              disabled={effortOptions.length === 0}
              onChange={(e) => onPatchConfig({ effort: e.target.value || null })}
            >
              <option value="">
                {effortOptions.length === 0
                  ? 'Not adjustable for this agent'
                  : fallback.effort
                    ? `Default: ${fallback.effort}`
                    : 'Agent default'}
              </option>
              {effortOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <div className="hint">Defaults for each provider are set in Settings.</div>
          </div>
        </fieldset>

        {/* -------------------------------------------------------- scope */}
        <fieldset className="group">
          <legend>Tools</legend>
          <MultiSelect
            options={toolOptions}
            selected={card.config.allowedTools}
            onChange={(allowedTools) => onPatchConfig({ allowedTools })}
            emptyText="No tools discovered for this agent."
          />
          {enforcement(agent?.supportsToolScoping, '--allowedTools / -t')}
          {card.config.allowedTools.length === 0 ? (
            <div className="hint">Empty means the agent&apos;s own default tool set.</div>
          ) : null}
        </fieldset>

        <fieldset className="group">
          <legend>MCP servers</legend>
          <MultiSelect
            options={mcpOptions}
            selected={card.config.allowedMcpServers}
            onChange={(allowedMcpServers) => onPatchConfig({ allowedMcpServers })}
            emptyText="No MCP servers discovered."
          />
          {enforcement(agent?.supportsMcpScoping, 'mcp__<server> in --allowedTools')}
        </fieldset>

        <fieldset className="group">
          <legend>Plugins</legend>
          <MultiSelect
            options={pluginOptions}
            selected={card.config.allowedPlugins}
            onChange={(allowedPlugins) => onPatchConfig({ allowedPlugins })}
            emptyText="No plugins discovered."
          />
          {enforcement(agent?.supportsPluginScoping, '--settings enabledPlugins')}
        </fieldset>

        <fieldset className="group">
          <legend>Skills</legend>
          <MultiSelect
            options={skillOptions}
            selected={card.config.allowedSkills}
            onChange={(allowedSkills) => onPatchConfig({ allowedSkills })}
            emptyText="No skills discovered."
          />
          {enforcement(agent?.supportsSkillScoping, '--skills')}
        </fieldset>

        {/* ------------------------------------------------------- prompt */}
        <div className="field">
          <label htmlFor="card-prompt">Task prompt</label>
          <textarea
            id="card-prompt"
            rows={6}
            value={card.config.taskPrompt}
            onChange={(e) => onPatchConfig({ taskPrompt: e.target.value })}
            placeholder="The instruction sent to the agent. Falls back to the card title if left empty."
          />
        </div>

        <div className="field">
          <label htmlFor="card-cwd">Working directory</label>
          <input
            id="card-cwd"
            value={card.config.workingDirectory ?? ''}
            placeholder={workspaceRoot ? `Default: ${workspaceRoot}` : '(board workspace)'}
            onChange={(e) => onPatchConfig({ workingDirectory: e.target.value || null })}
          />
        </div>

        {/* ------------------------------------------------------- result */}
        {run ? (
          <fieldset className="group">
            <legend>Last run — {run.status}</legend>

            {run.error ? <div className="banner err">{run.error}</div> : null}

            {run.command ? (
              <div className="field">
                <label>Command</label>
                <div className="transcript" style={{ maxHeight: 90 }}>
                  {run.command}
                </div>
              </div>
            ) : null}

            <div className="field">
              <label>Output</label>
              <div className="transcript">
                {run.output || (run.status === 'running' ? 'Waiting for output…' : '(empty)')}
              </div>
            </div>

            <button type="button" className="ghost" onClick={() => setShowTranscript((v) => !v)}>
              {showTranscript ? 'Hide' : 'Show'} event log ({run.events.length})
            </button>

            {showTranscript ? (
              <div className="transcript" style={{ marginTop: 6 }}>
                {run.events.length === 0
                  ? '(no events)'
                  : run.events.map((e, i) => (
                      <div key={i} className={`ev-${e.kind}`}>
                        [{e.kind}] {e.text}
                      </div>
                    ))}
              </div>
            ) : null}

            {run.agentSessionId ? (
              <div className="hint">
                Agent session: <code className="inline">{run.agentSessionId}</code>
              </div>
            ) : null}
          </fieldset>
        ) : null}
      </div>

      <div className="panel-foot">
        {isRunning ? (
          <button type="button" className="danger" onClick={onCancel}>
            Cancel run
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={onDispatch}
            disabled={!canDispatch}
            title={card.config.agentId ? 'Dispatch this card' : 'Assign an agent first'}
          >
            Send to Agent
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="danger" onClick={onDelete}>
          Delete card
        </button>
      </div>
    </div>
  );
}
