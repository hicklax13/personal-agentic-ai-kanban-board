import { useMemo } from 'react';
import type { AppSettings, DiscoveryReport } from '@shared/types';
import { defaultConfig } from '@shared/boardOps';
import { AGENT_EFFORTS, resolveRunSettings } from '@shared/runSettings';
import { effortsFor } from './ProviderPicker.js';
import {
  ASSIGNEE_GROUPS,
  buildAssignees,
  keyForConfig,
  providerForChoice,
  type AssigneeOption,
} from './assignees.js';

export interface AssigneeValue {
  agentId: string | null;
  providerId: string | null;
  model: string | null;
  effort: string | null;
}

interface Props {
  idPrefix: string;
  discovery: DiscoveryReport | null;
  settings: AppSettings | null;
  value: AssigneeValue;
  onChange: (next: AssigneeValue) => void;
  /** Label of the "nobody" choice. */
  noneLabel?: string;
  /** Heading of the first field. */
  label?: string;
}

/**
 * Who does the work, on which model, and how hard it thinks.
 *
 * Blank model and effort mean "the default saved for that provider in
 * Settings", and the placeholder says what that default is — the same rule the
 * main process applies at run time, so what is shown is what will run.
 */
export default function AssigneeFields({
  idPrefix,
  discovery,
  settings,
  value,
  onChange,
  noneLabel = '— choose who does this —',
  label = 'Assignee',
}: Props): React.JSX.Element {
  const options = useMemo(() => buildAssignees(discovery, settings), [discovery, settings]);
  const key = keyForConfig(value.agentId, value.providerId);
  const known = options.some((o) => o.key === key);

  const provider = providerForChoice(discovery, settings, value.agentId, value.providerId);
  const fallback = resolveRunSettings(
    defaultConfig({ agentId: value.agentId, providerId: value.providerId }),
    settings?.providerDefaults ?? {},
  );
  const models = provider?.models ?? [];
  const efforts = provider
    ? effortsFor(provider, value.model ?? fallback.model)
    : value.agentId
      ? (AGENT_EFFORTS[value.agentId] ?? [])
      : [];
  const agent = discovery?.agents.find((a) => a.id === value.agentId);

  const choose = (nextKey: string): void => {
    const opt = options.find((o) => o.key === nextKey);
    // A different assignee means a different model list: keeping the old model
    // or effort would send one the new agent has never heard of.
    onChange(
      opt
        ? { agentId: opt.agentId, providerId: opt.providerId, model: null, effort: null }
        : { agentId: null, providerId: null, model: null, effort: null },
    );
  };

  const chooseModel = (model: string): void => {
    const nextEfforts = provider ? effortsFor(provider, model || null) : efforts;
    onChange({
      ...value,
      model: model || null,
      effort: value.effort && nextEfforts.includes(value.effort) ? value.effort : null,
    });
  };

  const optionText = (o: AssigneeOption): string =>
    `${o.label}${o.note ? ` — ${o.note}` : ''}${o.unavailable ? ' — not available' : ''}`;

  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-assignee`}>{label}</label>
        <select id={`${idPrefix}-assignee`} value={key} onChange={(e) => choose(e.target.value)}>
          <option value="">{noneLabel}</option>
          {!known && key ? (
            <option value={key}>
              {value.agentId} · {value.providerId ?? 'default'} (saved)
            </option>
          ) : null}
          {ASSIGNEE_GROUPS.map((group) => {
            const inGroup = options.filter((o) => o.group === group);
            return inGroup.length > 0 ? (
              <optgroup key={group} label={group}>
                {inGroup.map((o) => (
                  <option key={o.key} value={o.key} disabled={o.unavailable}>
                    {optionText(o)}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
        {agent && agent.availability !== 'available' ? (
          <div className="hint warn">
            <span className={`dot ${agent.availability}`} /> {agent.statusDetail}
            {agent.remediation ? ` — ${agent.remediation}` : ''}
          </div>
        ) : null}
      </div>

      <div className="field row">
        <div>
          <label htmlFor={`${idPrefix}-model`}>Model</label>
          <select
            id={`${idPrefix}-model`}
            value={value.model ?? ''}
            disabled={!value.agentId}
            onChange={(e) => chooseModel(e.target.value)}
          >
            <option value="">
              {fallback.model ? `Default (${fallback.model})` : 'Default'}
            </option>
            {value.model && !models.some((m) => m.id === value.model) ? (
              <option value={value.model}>{value.model} (saved, not in list)</option>
            ) : null}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-effort`}>{provider?.effortLabel ?? 'Effort'}</label>
          <select
            id={`${idPrefix}-effort`}
            value={value.effort ?? ''}
            disabled={efforts.length === 0}
            onChange={(e) => onChange({ ...value, effort: e.target.value || null })}
          >
            <option value="">
              {efforts.length === 0
                ? 'Not adjustable'
                : fallback.effort
                  ? `Default (${fallback.effort})`
                  : 'Default'}
            </option>
            {efforts.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
      </div>
      {value.agentId ? (
        <div className="field-note">
          {models.length > 0
            ? `${models.length} model${models.length === 1 ? '' : 's'}${provider?.live ? ' · live list' : ''}`
            : value.agentId === 'hermes' && !value.providerId
              ? "Uses Hermes's own default model — pick a provider in Settings → Connections to choose one here."
              : 'No model list for this choice; the agent picks its default.'}
          {efforts.length > 0 ? ` · ${efforts.length} effort levels` : ''}
        </div>
      ) : null}
    </>
  );
}
