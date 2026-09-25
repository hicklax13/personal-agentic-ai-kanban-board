import type { DiscoveredProvider, ProviderDefault } from '@shared/types';
import { AGENT_EFFORTS } from '@shared/runSettings';

/**
 * Model and effort choice for one provider.
 *
 * The same saved default can be shown in several places — the Anthropic account
 * row and the Claude Code connection row edit one setting — so this component
 * holds no state of its own: it renders the saved value and reports changes.
 */

interface Props {
  provider: DiscoveredProvider | undefined;
  value: ProviderDefault | undefined;
  onChange: (value: ProviderDefault) => void;
}

/** Efforts available for a model: its own list when the source gives one, else the provider's. */
export function effortsFor(provider: DiscoveredProvider, modelId: string | null): string[] {
  const model = modelId ? provider.models.find((m) => m.id === modelId) : undefined;
  return model?.efforts && model.efforts.length > 0 ? model.efforts : provider.efforts;
}

export default function ProviderPicker({ provider, value, onChange }: Props): React.JSX.Element {
  if (!provider) {
    return <div className="picker-meta">Model list not loaded yet — it appears when the scan finishes.</div>;
  }

  const model = value?.model ?? '';
  const effort = value?.effort ?? '';
  const chosen = provider.models.find((m) => m.id === model);
  const efforts = effortsFor(provider, model || null);
  const modelDefault = chosen?.defaultEffort ? ` (model default: ${chosen.defaultEffort})` : '';

  const setModel = (next: string): void => {
    const nextEfforts = effortsFor(provider, next || null);
    // A saved effort the newly chosen model does not support would be silently
    // dropped at run time; clear it here so what is shown is what will run.
    onChange({
      ...value,
      model: next || null,
      effort: effort && nextEfforts.includes(effort) ? effort : null,
    });
  };

  return (
    <div className="picker">
      <label className="picker-field">
        <span>Model</span>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Agent default</option>
          {model && !chosen ? <option value={model}>{model} (saved, not in list)</option> : null}
          {provider.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="picker-field">
        <span>{provider.effortLabel}</span>
        <select
          value={effort}
          disabled={efforts.length === 0}
          onChange={(e) => onChange({ ...value, model: value?.model ?? null, effort: e.target.value || null })}
        >
          <option value="">{efforts.length > 0 ? `Default${modelDefault}` : 'Not adjustable'}</option>
          {efforts.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>
      <div className="picker-meta">
        {provider.models.length} model{provider.models.length === 1 ? '' : 's'}
        {provider.live ? ' · live list' : ' · from config'}
        {efforts.length > 0 ? ` · ${efforts.length} effort levels` : ''}
        {provider.modelsError ? <span className="picker-warn"> · {provider.modelsError}</span> : null}
        {provider.effortNote ? ` · ${provider.effortNote}` : ''}
      </div>
    </div>
  );
}

/**
 * Hermes's own default: which of its providers a card with no provider uses,
 * plus the model and reasoning effort for it.
 */
export function HermesDefaultPicker({
  providers,
  value,
  onChange,
}: {
  providers: DiscoveredProvider[];
  value: ProviderDefault | undefined;
  onChange: (value: ProviderDefault) => void;
}): React.JSX.Element {
  const hermesProviders = providers.filter((p) => p.id.startsWith('hermes:'));
  const providerId = value?.provider ?? '';
  const provider = hermesProviders.find((p) => p.id === providerId);
  const model = value?.model ?? '';

  return (
    <div className="picker">
      <label className="picker-field">
        <span>Provider</span>
        <select
          value={providerId}
          onChange={(e) =>
            onChange({ provider: e.target.value || null, model: null, effort: value?.effort ?? null })
          }
        >
          <option value="">Hermes default (its own config)</option>
          {hermesProviders.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.models.length} models
            </option>
          ))}
        </select>
      </label>
      <label className="picker-field">
        <span>Model</span>
        <select
          value={model}
          disabled={!provider}
          onChange={(e) => onChange({ ...value, model: e.target.value || null, effort: value?.effort ?? null })}
        >
          <option value="">{provider ? 'Provider default' : 'Pick a provider first'}</option>
          {provider?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="picker-field">
        <span>Reasoning effort</span>
        <select
          value={value?.effort ?? ''}
          onChange={(e) => onChange({ ...value, model: value?.model ?? null, effort: e.target.value || null })}
        >
          <option value="">Default</option>
          {AGENT_EFFORTS.hermes.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>
      <div className="picker-meta">
        Used by Hermes cards that do not name a provider. Each provider&apos;s own default is set in
        Credentials.
      </div>
    </div>
  );
}
