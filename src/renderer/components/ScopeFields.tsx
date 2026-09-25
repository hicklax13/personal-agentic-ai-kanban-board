import { useMemo } from 'react';
import type { CardAgentConfig, DiscoveryReport } from '@shared/types';
import MultiSelect, { type Option } from './MultiSelect.js';

export type ScopeValue = Pick<
  CardAgentConfig,
  'allowedSkills' | 'allowedMcpServers' | 'allowedTools' | 'allowedPlugins'
>;

interface Props {
  discovery: DiscoveryReport | null;
  agentId: string | null;
  value: ScopeValue;
  onChange: (patch: Partial<ScopeValue>) => void;
}

/**
 * What the agent may use: skills, MCP servers, tools and plugins.
 *
 * All optional — an empty list means "the agent's own defaults". Each list only
 * offers what the chosen agent can reach (an MCP server belongs to the agent
 * whose configuration holds it), and each says plainly whether the agent's CLI
 * enforces the choice or can only record it: accepting a selection that will
 * not be applied, without saying so, would be worse than not offering it.
 */
export default function ScopeFields({ discovery, agentId, value, onChange }: Props): React.JSX.Element {
  const agent = discovery?.agents.find((a) => a.id === agentId) ?? null;

  const skills: Option[] = useMemo(
    () =>
      (discovery?.skills ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description || s.source })),
    [discovery],
  );

  const mcp: Option[] = useMemo(
    () =>
      (discovery?.mcpServers ?? [])
        .filter((s) => !agentId || s.owner === agentId)
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: `${s.ownerName} · ${s.availability} — ${s.statusDetail}`,
          disabled: s.availability === 'unavailable',
          disabledReason: s.statusDetail,
        })),
    [discovery, agentId],
  );

  const tools: Option[] = useMemo(() => {
    const all = discovery?.tools ?? [];
    const forAgent = agentId ? all.filter((t) => t.agentIds.includes(agentId)) : all;
    return forAgent.map((t) => ({ id: t.name, name: t.name, description: t.description }));
  }, [discovery, agentId]);

  const plugins: Option[] = useMemo(
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

  const enforcement = (supported: boolean | undefined, flag: string): React.JSX.Element =>
    !agentId ? (
      <div className="hint">Choose who does the task to see whether this is enforced.</div>
    ) : supported ? (
      <div className="hint">
        Enforced — passed to the agent as <code className="inline">{flag}</code>.
      </div>
    ) : (
      <div className="hint warn">
        Recorded only — {agent?.name ?? 'this agent'} has no setting for this, so the choice is
        saved but not applied.
      </div>
    );

  const section = (
    title: string,
    options: Option[],
    selected: string[],
    set: (next: string[]) => void,
    empty: string,
    hint: React.JSX.Element,
  ): React.JSX.Element => (
    <details className="scope">
      <summary>
        <span>{title}</span>
        <span className="scope-count">
          {selected.length > 0 ? `${selected.length} selected` : 'agent default'} · {options.length} available
        </span>
      </summary>
      <MultiSelect options={options} selected={selected} onChange={set} emptyText={empty} />
      {hint}
    </details>
  );

  return (
    <div className="scope-list">
      {section('Skills', skills, value.allowedSkills, (allowedSkills) => onChange({ allowedSkills }), 'No skills found.', enforcement(agent?.supportsSkillScoping, '--skills'))}
      {section('MCP servers', mcp, value.allowedMcpServers, (allowedMcpServers) => onChange({ allowedMcpServers }), agentId ? 'No MCP servers are set up in this agent.' : 'No MCP servers found.', enforcement(agent?.supportsMcpScoping, 'mcp__<server> in --allowedTools'))}
      {section('Tools', tools, value.allowedTools, (allowedTools) => onChange({ allowedTools }), 'No tools found for this agent.', enforcement(agent?.supportsToolScoping, '--allowedTools / -t'))}
      {section('Plugins', plugins, value.allowedPlugins, (allowedPlugins) => onChange({ allowedPlugins }), 'No plugins found.', enforcement(agent?.supportsPluginScoping, '--settings enabledPlugins'))}
    </div>
  );
}
