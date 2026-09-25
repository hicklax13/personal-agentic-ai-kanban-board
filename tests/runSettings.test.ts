import { describe, expect, it } from 'vitest';
import { effortAccepted, resolveRunSettings } from '../shared/runSettings.js';
import { defaultConfig } from '../shared/boardOps.js';
import { buildClaudeCommand } from '../src/main/agents/claudeCode.js';
import { buildCodexCommand } from '../src/main/agents/codex.js';
import { buildHermesCommand } from '../src/main/agents/hermes.js';
import { makeCard } from '../src/main/store/schema.js';
import { normaliseJudge, normaliseProviderDefaults } from '../src/main/settings.js';
import type { Card, CardAgentConfig, ProviderDefault } from '../shared/types.js';

const cfg = (overrides: Partial<CardAgentConfig>): CardAgentConfig => defaultConfig(overrides);

// ---------------------------------------------------------------------------
// resolveRunSettings
// ---------------------------------------------------------------------------

describe('resolveRunSettings', () => {
  const defaults: Record<string, ProviderDefault> = {
    anthropic: { model: 'opus', effort: 'high' },
    openai: { model: 'gpt-6-astra', effort: 'xhigh' },
    hermes: { provider: 'hermes:deepseek', model: 'deepseek-flash', effort: 'medium' },
    'hermes:xai': { model: 'grok-5', effort: 'low' },
    'hermes:deepseek': { model: 'deepseek-pro', effort: 'max' },
  };

  it('fills a blank Claude Code card from the Anthropic default', () => {
    expect(resolveRunSettings(cfg({ agentId: 'claude-code' }), defaults)).toEqual({
      providerId: null,
      model: 'opus',
      effort: 'high',
    });
  });

  it('never overrides what the card itself chose', () => {
    const r = resolveRunSettings(cfg({ agentId: 'codex', model: 'gpt-5.5', effort: 'low' }), defaults);
    expect(r.model).toBe('gpt-5.5');
    expect(r.effort).toBe('low');
  });

  it('fills only the blank field when the card chose one of the two', () => {
    const r = resolveRunSettings(cfg({ agentId: 'codex', model: 'gpt-5.5' }), defaults);
    expect(r).toEqual({ providerId: null, model: 'gpt-5.5', effort: 'xhigh' });
  });

  it('uses Hermes’s own default provider, model and effort for a Hermes card with no provider', () => {
    expect(resolveRunSettings(cfg({ agentId: 'hermes' }), defaults)).toEqual({
      providerId: 'hermes:deepseek',
      model: 'deepseek-flash',
      effort: 'medium',
    });
  });

  it('uses the named provider’s default when a Hermes card picks a provider', () => {
    expect(resolveRunSettings(cfg({ agentId: 'hermes', providerId: 'hermes:xai' }), defaults)).toEqual({
      providerId: 'hermes:xai',
      model: 'grok-5',
      effort: 'low',
    });
  });

  it('falls back to Hermes’s effort when the named provider has no effort of its own', () => {
    const d = { ...defaults, 'hermes:xai': { model: 'grok-5', effort: null } };
    expect(resolveRunSettings(cfg({ agentId: 'hermes', providerId: 'hermes:xai' }), d).effort).toBe('medium');
  });

  it('leaves everything blank when nothing was saved', () => {
    expect(resolveRunSettings(cfg({ agentId: 'ollama' }), {})).toEqual({
      providerId: null,
      model: null,
      effort: null,
    });
  });
});

describe('effortAccepted', () => {
  it('accepts only the levels each agent’s own CLI documents', () => {
    expect(effortAccepted('claude-code', 'max')).toBe(true);
    expect(effortAccepted('claude-code', 'ultra')).toBe(false);
    expect(effortAccepted('hermes', 'minimal')).toBe(true);
    expect(effortAccepted('codex', 'ultra')).toBe(true);
    expect(effortAccepted('codex', 'none')).toBe(false);
    expect(effortAccepted('lmstudio', 'high')).toBe(false);
    expect(effortAccepted('claude-code', null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Effort reaching each CLI
// ---------------------------------------------------------------------------

function card(config: Partial<CardAgentConfig>): Card {
  const base = makeCard({ columnId: 'c', title: 't', position: 0 });
  return { ...base, config: defaultConfig({ taskPrompt: 'go', ...config }) };
}

function argAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe('effort flags', () => {
  it('passes --effort to Claude Code', () => {
    const { args } = buildClaudeCommand({
      binaryPath: 'claude',
      card: card({ effort: 'xhigh' }),
      workspaceRoot: null,
      resumeSessionId: null,
    });
    expect(argAfter(args, '--effort')).toBe('xhigh');
  });

  it('passes model_reasoning_effort to Codex as a quoted TOML string', () => {
    const { args } = buildCodexCommand({
      binaryPath: 'codex',
      card: card({ effort: 'ultra' }),
      workspaceRoot: null,
      resumeSessionId: null,
      lastMessagePath: 'x',
      localProvider: null,
    });
    expect(argAfter(args, '-c')).toBe('model_reasoning_effort="ultra"');
  });

  it('passes --reasoning to Hermes', () => {
    const { args } = buildHermesCommand({
      binaryPath: 'hermes',
      card: card({ effort: 'minimal' }),
      workspaceRoot: null,
      resumeSessionId: null,
    });
    expect(argAfter(args, '--reasoning')).toBe('minimal');
  });

  it('drops an effort the agent does not accept instead of passing it on', () => {
    // An Ollama "on" default reaching a Claude card must not become `--effort on`.
    const { args } = buildClaudeCommand({
      binaryPath: 'claude',
      card: card({ effort: 'on' }),
      workspaceRoot: null,
      resumeSessionId: null,
    });
    expect(args).not.toContain('--effort');
  });

  it('adds no effort flag when none was chosen', () => {
    const { args } = buildHermesCommand({
      binaryPath: 'hermes',
      card: card({}),
      workspaceRoot: null,
      resumeSessionId: null,
    });
    expect(args).not.toContain('--reasoning');
  });
});

// ---------------------------------------------------------------------------
// Saved defaults
// ---------------------------------------------------------------------------

describe('normaliseProviderDefaults', () => {
  it('keeps well-formed entries and trims text', () => {
    expect(normaliseProviderDefaults({ openai: { model: ' gpt-5.5 ', effort: 'high' } })).toEqual({
      openai: { model: 'gpt-5.5', effort: 'high' },
    });
  });

  it('drops an entry with nothing chosen, which is how a default is cleared', () => {
    expect(normaliseProviderDefaults({ openai: { model: null, effort: '' } })).toEqual({});
  });

  it('keeps the Hermes provider choice', () => {
    expect(normaliseProviderDefaults({ hermes: { provider: 'hermes:xai', model: null, effort: null } })).toEqual({
      hermes: { provider: 'hermes:xai', model: null, effort: null },
    });
  });

  it('ignores junk', () => {
    expect(normaliseProviderDefaults(null)).toEqual({});
    expect(normaliseProviderDefaults({ x: 'nope' })).toEqual({});
  });
});

describe('normaliseJudge', () => {
  it('defaults to no judge and five rounds', () => {
    expect(normaliseJudge(undefined)).toMatchObject({ agentId: null, maxRounds: 5, allowedTools: [] });
  });

  it('keeps a well-formed judge and cleans its lists', () => {
    expect(
      normaliseJudge({
        agentId: 'claude-code',
        model: ' haiku ',
        allowedTools: ['Read', 'Read', '', 7],
        maxRounds: 8,
      }),
    ).toMatchObject({ agentId: 'claude-code', model: 'haiku', allowedTools: ['Read'], maxRounds: 8 });
  });

  it('keeps the round limit between 1 and 50', () => {
    expect(normaliseJudge({ maxRounds: 0 }).maxRounds).toBe(1);
    expect(normaliseJudge({ maxRounds: 500 }).maxRounds).toBe(50);
    expect(normaliseJudge({ maxRounds: 'lots' }).maxRounds).toBe(5);
  });
});
