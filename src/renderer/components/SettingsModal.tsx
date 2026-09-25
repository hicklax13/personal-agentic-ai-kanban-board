import { useEffect, useState } from 'react';
import type {
  AccountProvider,
  AccountStatus,
  AgentTestResult,
  AppSettings,
  DiscoveredProvider,
  DiscoveryReport,
  EndpointSettings,
  JudgeSettings,
  ProviderDefault,
  SecretKey,
} from '@shared/types';
import { CREDENTIALS } from '@shared/types';
import { AGENT_DEFAULT_PROVIDER } from '@shared/runSettings';
import ProviderPicker, { HermesDefaultPicker } from './ProviderPicker.js';
import EnvironmentPanel from './EnvironmentPanel.js';
import JudgePanel from './JudgePanel.js';

interface Props {
  settings: AppSettings;
  discovery: DiscoveryReport | null;
  onClose: () => void;
  onSaveEndpoints: (endpoints: EndpointSettings) => Promise<void>;
  onSaveSecret: (key: SecretKey, value: string) => Promise<void>;
  onClearSecret: (key: SecretKey) => Promise<void>;
  onTestAgent: (agentId: string) => Promise<AgentTestResult>;
  onRefreshDiscovery: () => Promise<void>;
  onRefreshCatalog: () => Promise<void>;
  onSetProviderDefault: (providerId: string, value: ProviderDefault) => Promise<void>;
  onSaveJudge: (judge: JudgeSettings) => Promise<void>;
}

/** The catalogue provider each account's sign-in runs. */
const ACCOUNT_PROVIDER_ID: Record<AccountProvider, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
};

/** Re-reads every provider's model list; seconds, unlike a full rescan. */
function ModelsBar({
  discovery,
  onRefresh,
}: {
  discovery: DiscoveryReport | null;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const total = discovery?.providers.reduce((n, p) => n + p.models.length, 0) ?? 0;
  return (
    <div className="models-bar">
      <span>
        {total} models across {discovery?.providers.length ?? 0} providers
        {discovery ? ` · updated ${new Date(discovery.scannedAt).toLocaleTimeString()}` : ''}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onRefresh();
          setBusy(false);
        }}
      >
        {busy ? 'Refreshing…' : 'Refresh model lists'}
      </button>
    </div>
  );
}

type Tab = 'accounts' | 'connections' | 'credentials' | 'judge' | 'environment';

export default function SettingsModal({
  settings,
  discovery,
  onClose,
  onSaveEndpoints,
  onSaveSecret,
  onClearSecret,
  onTestAgent,
  onRefreshDiscovery,
  onRefreshCatalog,
  onSetProviderDefault,
  onSaveJudge,
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('accounts');
  const [endpoints, setEndpoints] = useState<EndpointSettings>(settings.endpoints);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<Record<string, AgentTestResult | 'running'>>({});
  const [busy, setBusy] = useState(false);

  const defaults = settings.providerDefaults ?? {};
  const providerById = (id: string): DiscoveredProvider | undefined =>
    discovery?.providers.find((p) => p.id === id);
  const setDefault = (id: string) => (value: ProviderDefault) => void onSetProviderDefault(id, value);

  const runTest = async (agentId: string): Promise<void> => {
    setTests((t) => ({ ...t, [agentId]: 'running' }));
    const result = await onTestAgent(agentId);
    setTests((t) => ({ ...t, [agentId]: result }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>Settings</h2>
          <button
            type="button"
            className={tab === 'accounts' ? 'primary' : 'ghost'}
            onClick={() => setTab('accounts')}
          >
            Accounts
          </button>
          <button
            type="button"
            className={tab === 'connections' ? 'primary' : 'ghost'}
            onClick={() => setTab('connections')}
          >
            Connections
          </button>
          <button
            type="button"
            className={tab === 'credentials' ? 'primary' : 'ghost'}
            onClick={() => setTab('credentials')}
          >
            Credentials
          </button>
          <button
            type="button"
            className={tab === 'judge' ? 'primary' : 'ghost'}
            onClick={() => setTab('judge')}
          >
            Judge
          </button>
          <button
            type="button"
            className={tab === 'environment' ? 'primary' : 'ghost'}
            onClick={() => setTab('environment')}
          >
            Environment
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="panel-body">
          {tab === 'accounts' ? (
            <>
              <ModelsBar discovery={discovery} onRefresh={onRefreshCatalog} />
              <AccountsPanel
                providerById={providerById}
                defaults={defaults}
                onSetDefault={(id, value) => void onSetProviderDefault(id, value)}
              />
            </>
          ) : null}

          {/* ------------------------------------------------ connections */}
          {tab === 'connections' ? (
            <>
              <ModelsBar discovery={discovery} onRefresh={onRefreshCatalog} />
              <div className="field">
                <label htmlFor="ep-ollama">Ollama base URL</label>
                <input
                  id="ep-ollama"
                  value={endpoints.ollamaBaseUrl}
                  onChange={(e) => setEndpoints({ ...endpoints, ollamaBaseUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="ep-lms">LM Studio base URL</label>
                <input
                  id="ep-lms"
                  value={endpoints.lmStudioBaseUrl}
                  onChange={(e) => setEndpoints({ ...endpoints, lmStudioBaseUrl: e.target.value })}
                />
              </div>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onSaveEndpoints(endpoints);
                  await onRefreshDiscovery();
                  setBusy(false);
                }}
              >
                {busy ? 'Saving…' : 'Save and rescan'}
              </button>

              <fieldset className="group" style={{ marginTop: 16 }}>
                <legend>Agent connectivity</legend>
                <div className="hint" style={{ marginBottom: 8 }}>
                  Test performs a real round-trip. It is the only way to tell an installed binary
                  from a working account.
                </div>
                <div className="status-list">
                  {(discovery?.agents ?? []).map((a) => {
                    const result = tests[a.id];
                    return (
                      <div className="status-row" key={a.id}>
                        <span className={`dot ${a.availability}`} style={{ marginTop: 4 }} />
                        <div className="sr-main">
                          <div className="sr-name">
                            {a.name}
                            {a.version ? ` — ${a.version}` : ''}
                          </div>
                          <div className="sr-detail">{a.statusDetail}</div>
                          {a.remediation ? <div className="sr-fix">Fix: {a.remediation}</div> : null}
                          {result && result !== 'running' ? (
                            <div className={result.ok ? 'sr-detail' : 'sr-fix'}>
                              {result.ok ? '✔' : '✘'} {result.detail} ({result.durationMs} ms)
                            </div>
                          ) : null}
                          {a.id === 'hermes' ? (
                            <HermesDefaultPicker
                              providers={discovery?.providers ?? []}
                              value={defaults.hermes}
                              onChange={setDefault('hermes')}
                            />
                          ) : AGENT_DEFAULT_PROVIDER[a.id] ? (
                            <ProviderPicker
                              provider={providerById(AGENT_DEFAULT_PROVIDER[a.id])}
                              value={defaults[AGENT_DEFAULT_PROVIDER[a.id]]}
                              onChange={setDefault(AGENT_DEFAULT_PROVIDER[a.id])}
                            />
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={result === 'running' || a.transport === 'none'}
                          onClick={() => void runTest(a.id)}
                        >
                          {result === 'running' ? 'Testing…' : 'Test'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            </>
          ) : null}

          {/* ------------------------------------------------ credentials */}
          {tab === 'credentials' ? (
            <>
              <div className={settings.encryptionAvailable ? 'banner info' : 'banner warn'}>
                {settings.encryptionAvailable
                  ? 'Credentials are encrypted at rest with the OS keyring (DPAPI on Windows). They are stored per Windows account and never leave this machine.'
                  : 'The OS keyring is unavailable, so credentials are stored base64-encoded, NOT encrypted. Treat this file as sensitive.'}
                <div style={{ marginTop: 4, opacity: 0.8 }}>{settings.secretsPath}</div>
              </div>

              <div className="hint" style={{ marginBottom: 10 }}>
                Hermes reads these keys for its providers. If Hermes&apos;s own settings already hold a
                key for a provider, Hermes uses its own copy — it loads its settings over anything this
                app passes in.
              </div>

              <ModelsBar discovery={discovery} onRefresh={onRefreshCatalog} />

              {CREDENTIALS.map(({ key, label, usedBy, help, providerId }) => (
                <div className="field" key={key}>
                  <label htmlFor={`sec-${key}`}>
                    {label} {settings.secretsPresent[key] ? '· set' : '· not set'}
                  </label>
                  <div className="row">
                    <input
                      id={`sec-${key}`}
                      type="password"
                      autoComplete="off"
                      placeholder={settings.secretsPresent[key] ? '•••••• (stored)' : 'Paste value'}
                      value={drafts[key] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    />
                    <button
                      type="button"
                      style={{ flex: '0 0 auto' }}
                      disabled={!drafts[key]?.trim()}
                      onClick={async () => {
                        await onSaveSecret(key, drafts[key].trim());
                        // Clear the draft immediately so the plaintext does not
                        // linger in renderer memory or in a React devtools tree.
                        setDrafts((d) => ({ ...d, [key]: '' }));
                        // A new key can unlock a provider's model list.
                        await onRefreshCatalog();
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="danger"
                      style={{ flex: '0 0 auto' }}
                      disabled={!settings.secretsPresent[key]}
                      onClick={async () => {
                        await onClearSecret(key);
                        await onRefreshCatalog();
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="hint">
                    <code className="inline">{key}</code> · used by {usedBy}. {help}
                  </div>
                  <ProviderPicker
                    provider={providerById(providerId)}
                    value={defaults[providerId]}
                    onChange={setDefault(providerId)}
                  />
                </div>
              ))}

              <div className="hint">
                Stored values are never sent back to this window — there is no read path across the
                IPC bridge, only write and clear.
              </div>
            </>
          ) : null}

          {/* ------------------------------------------------------ judge */}
          {tab === 'judge' ? (
            <JudgePanel settings={settings} discovery={discovery} onSave={onSaveJudge} />
          ) : null}

          {/* ------------------------------------------------ environment */}
          {tab === 'environment' ? (
            <EnvironmentPanel
              discovery={discovery}
              boardPath={settings.boardPath}
              busy={busy}
              onRescan={async () => {
                setBusy(true);
                await onRefreshDiscovery();
                setBusy(false);
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}


/**
 * Account sign-in for the agents whose CLIs support it.
 *
 * The buttons run each CLI's own official browser sign-in, so this window never
 * handles a password or token. While a sign-in waits on the browser, the main
 * process forwards the sign-in address so it can be offered as a link in case
 * the browser did not open by itself.
 */
function AccountsPanel({
  providerById,
  defaults,
  onSetDefault,
}: {
  providerById: (id: string) => DiscoveredProvider | undefined;
  defaults: Record<string, ProviderDefault>;
  onSetDefault: (providerId: string, value: ProviderDefault) => void;
}): React.JSX.Element {
  const [accounts, setAccounts] = useState<AccountStatus[] | null>(null);
  const [busy, setBusy] = useState<Partial<Record<AccountProvider, 'in' | 'out'>>>({});
  const [links, setLinks] = useState<Partial<Record<AccountProvider, string>>>({});
  const [messages, setMessages] = useState<
    Partial<Record<AccountProvider, { ok: boolean; text: string }>>
  >({});

  const refresh = async (): Promise<void> => {
    setAccounts(await window.api.getAccounts());
  };

  useEffect(() => {
    void refresh();
    return window.api.onSignInProgress((p) => setLinks((l) => ({ ...l, [p.provider]: p.url })));
  }, []);

  const act = async (provider: AccountProvider, action: 'in' | 'out'): Promise<void> => {
    if (
      action === 'out' &&
      !window.confirm('Sign out? Runs for this agent will fail until you sign in again.')
    ) {
      return;
    }
    setBusy((b) => ({ ...b, [provider]: action }));
    setMessages((m) => ({ ...m, [provider]: undefined }));
    const result =
      action === 'in' ? await window.api.signIn(provider) : await window.api.signOut(provider);
    setBusy((b) => ({ ...b, [provider]: undefined }));
    setLinks((l) => ({ ...l, [provider]: undefined }));
    setMessages((m) => ({ ...m, [provider]: { ok: result.ok, text: result.detail } }));
    await refresh();
  };

  if (!accounts) return <div className="empty-state">Checking sign-in status…</div>;

  return (
    <>
      <div className="banner info">
        Use your own accounts instead of API keys. Each button opens that company&apos;s official
        sign-in page in your browser; this app never sees your password or tokens.
      </div>
      <div className="status-list">
        {accounts.map((a) => {
          const state = busy[a.provider];
          const message = messages[a.provider];
          const link = links[a.provider];
          const dot = !a.available ? 'unavailable' : a.signedIn ? 'available' : 'degraded';
          return (
            <div className="status-row" key={a.provider}>
              <span className={`dot ${dot}`} style={{ marginTop: 4 }} />
              <div className="sr-main">
                <div className="sr-name">
                  {a.label} <span style={{ fontWeight: 400, opacity: 0.7 }}>· via {a.via}</span>
                </div>
                <div className="sr-detail">
                  {a.signedIn ? `Signed in with ${a.method}` : a.detail}
                </div>
                {state === 'in' ? (
                  <div className="sr-detail">
                    Finish signing in in your browser…{' '}
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer">
                        Browser did not open? Open the sign-in page
                      </a>
                    ) : null}
                  </div>
                ) : null}
                {message ? (
                  <div className={message.ok ? 'sr-detail' : 'sr-fix'}>
                    {message.ok ? '✔' : '✘'} {message.text}
                  </div>
                ) : null}
                <ProviderPicker
                  provider={providerById(ACCOUNT_PROVIDER_ID[a.provider])}
                  value={defaults[ACCOUNT_PROVIDER_ID[a.provider]]}
                  onChange={(value) => onSetDefault(ACCOUNT_PROVIDER_ID[a.provider], value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className={a.signedIn ? '' : 'primary'}
                  disabled={!a.available || Boolean(state)}
                  onClick={() => void act(a.provider, 'in')}
                >
                  {state === 'in' ? 'Waiting…' : a.signedIn ? 'Sign in again' : 'Sign in'}
                </button>
                {a.signedIn ? (
                  <button
                    type="button"
                    className="danger"
                    disabled={Boolean(state)}
                    onClick={() => void act(a.provider, 'out')}
                  >
                    {state === 'out' ? 'Signing out…' : 'Sign out'}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        While you are signed in, Codex and Claude Code bill your subscription. A saved API key does
        not override the sign-in — that was checked with a test key.
      </div>
    </>
  );
}
