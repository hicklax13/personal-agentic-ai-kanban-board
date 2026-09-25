import { describe, expect, it } from 'vitest';
import {
  filterOpenAiChatModels,
  HERMES_API_PROVIDERS,
  listHeaders,
  parseAnthropicModels,
  parseCodexCatalog,
  parseCommandCodeModels,
  parseDeepInfraModels,
  parseGoogleModels,
} from '../src/main/discovery/catalog.js';
import { parseOpenAiModels } from '../src/main/discovery/models.js';
import { CREDENTIALS } from '../shared/types.js';

/**
 * Fixtures are trimmed from real responses captured on a working install
 * (`codex debug models`, and the public DeepInfra and Command Code lists). The
 * Anthropic and Google shapes follow those providers' documented list formats.
 */

// ---------------------------------------------------------------------------
// Codex — `codex debug models`
// ---------------------------------------------------------------------------

const CODEX_CATALOG = {
  models: [
    {
      slug: 'gpt-6-astra',
      display_name: 'GPT-6-Astra',
      visibility: 'list',
      context_window: 272000,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low', description: 'Fast responses with lighter reasoning' },
        { effort: 'medium', description: 'x' },
        { effort: 'high', description: 'x' },
        { effort: 'xhigh', description: 'x' },
        { effort: 'max', description: 'x' },
        { effort: 'ultra', description: 'x' },
      ],
    },
    {
      slug: 'gpt-5.5',
      display_name: 'GPT-5.5',
      visibility: 'list',
      context_window: 272000,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }],
    },
    {
      slug: 'codex-auto-review',
      display_name: 'Codex Auto Review',
      visibility: 'hide',
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [{ effort: 'low' }],
    },
  ],
};

describe('parseCodexCatalog', () => {
  const models = parseCodexCatalog(CODEX_CATALOG);

  it('lists the models Codex shows in its own picker and hides internal ones', () => {
    expect(models.map((m) => m.id)).toEqual(['gpt-6-astra', 'gpt-5.5']);
  });

  it('keeps each model’s own effort levels and default', () => {
    expect(models[0].efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(models[1].efforts).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(models[0].defaultEffort).toBe('medium');
  });

  it('shows the display name alongside the id', () => {
    expect(models[0].name).toBe('GPT-6-Astra (gpt-6-astra)');
    expect(models[0].contextLength).toBe(272000);
  });

  it('returns nothing for output that is not a catalogue', () => {
    expect(parseCodexCatalog({})).toEqual([]);
    expect(parseCodexCatalog(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DeepInfra — mixed catalogue, keep chat only
// ---------------------------------------------------------------------------

describe('parseDeepInfraModels', () => {
  const raw = {
    data: [
      {
        id: 'XiaomiMiMo/MiMo-V2.6-Flash',
        object: 'model',
        metadata: { tags: ['chat', 'reasoning', 'reasoning_effort'], context_length: 262144 },
      },
      { id: 'BAAI/bge-m3', object: 'model', metadata: { tags: ['embed'] } },
      { id: 'black-forest-labs/FLUX', object: 'model', metadata: { tags: ['image-gen'] } },
      { id: 'listed-but-not-served', object: 'model', metadata: null },
    ],
  };

  it('keeps only chat-tagged models, like Hermes does', () => {
    expect(parseDeepInfraModels(raw).map((m) => m.id)).toEqual(['XiaomiMiMo/MiMo-V2.6-Flash']);
  });

  it('carries context length and the reasoning capability through', () => {
    const [m] = parseDeepInfraModels(raw);
    expect(m.contextLength).toBe(262144);
    expect(m.capabilities).toContain('reasoning');
  });
});

// ---------------------------------------------------------------------------
// Command Code — public list with names
// ---------------------------------------------------------------------------

describe('parseCommandCodeModels', () => {
  it('reads id, name and context length', () => {
    const models = parseCommandCodeModels({
      data: [
        {
          id: 'claude-sonnet-5',
          object: 'model',
          owned_by: 'command-code',
          name: 'Claude Sonnet 5',
          context_length: 1000000,
          supported_endpoints: ['/messages'],
        },
      ],
    });
    expect(models).toEqual([
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5 (claude-sonnet-5)', contextLength: 1000000, capabilities: [] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Anthropic and Google — documented list shapes
// ---------------------------------------------------------------------------

describe('parseAnthropicModels', () => {
  it('reads ids and display names', () => {
    const models = parseAnthropicModels({
      data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: 'x' }],
      has_more: false,
    });
    expect(models[0]).toMatchObject({ id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (claude-opus-5-5)' });
  });

  it('survives an error body', () => {
    expect(parseAnthropicModels({ type: 'error', error: { type: 'authentication_error' } })).toEqual([]);
  });
});

describe('parseGoogleModels', () => {
  const raw = {
    models: [
      {
        name: 'models/gemini-3-pro',
        displayName: 'Gemini 3 Pro',
        inputTokenLimit: 1048576,
        supportedGenerationMethods: ['generateContent', 'countTokens'],
        thinking: true,
      },
      {
        name: 'models/text-embedding-005',
        displayName: 'Text Embedding',
        supportedGenerationMethods: ['embedContent'],
      },
    ],
  };

  it('keeps models that can generate content and drops embedding models', () => {
    expect(parseGoogleModels(raw).map((m) => m.id)).toEqual(['gemini-3-pro']);
  });

  it('strips the models/ prefix and records thinking support', () => {
    const [m] = parseGoogleModels(raw);
    expect(m.id).toBe('gemini-3-pro');
    expect(m.capabilities).toEqual(['thinking']);
    expect(m.contextLength).toBe(1048576);
  });
});

describe('filterOpenAiChatModels', () => {
  it('drops families that cannot hold a text conversation', () => {
    const models = parseOpenAiModels({
      data: [
        { id: 'gpt-5.6-sol' },
        { id: 'text-embedding-3-large' },
        { id: 'whisper-1' },
        { id: 'tts-1' },
        { id: 'dall-e-3' },
        { id: 'omni-moderation-latest' },
        { id: 'o5-mini' },
      ],
    });
    expect(filterOpenAiChatModels(models).map((m) => m.id)).toEqual(['gpt-5.6-sol', 'o5-mini']);
  });
});

// ---------------------------------------------------------------------------
// Provider table
// ---------------------------------------------------------------------------

describe('HERMES_API_PROVIDERS', () => {
  it('covers every credential that belongs to a Hermes provider', () => {
    const hermesCredentialProviders = CREDENTIALS.filter((c) => c.providerId.startsWith('hermes:'))
      .map((c) => c.providerId)
      .sort();
    const listed = HERMES_API_PROVIDERS.map((p) => `hermes:${p.id}`).sort();
    expect(listed).toEqual(hermesCredentialProviders);
  });

  it('pairs each provider with the key the Credentials tab stores for it', () => {
    for (const p of HERMES_API_PROVIDERS) {
      const credential = CREDENTIALS.find((c) => c.providerId === `hermes:${p.id}`);
      expect(credential?.key).toBe(p.credential);
    }
  });

  it('uses https for every list', () => {
    expect(HERMES_API_PROVIDERS.every((p) => p.url.startsWith('https://'))).toBe(true);
  });
});

describe('listHeaders', () => {
  it('sends a bearer token for OpenAI-style lists', () => {
    expect(listHeaders('bearer', 'k')).toEqual({ Authorization: 'Bearer k' });
  });

  it('sends Anthropic’s own key header and version', () => {
    expect(listHeaders('anthropic', 'k')).toEqual({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
  });

  it('sends Google’s key header', () => {
    expect(listHeaders('google', 'k')).toEqual({ 'x-goog-api-key': 'k' });
  });

  it('sends nothing for a public list or a missing key', () => {
    expect(listHeaders('none', 'k')).toEqual({});
    expect(listHeaders('bearer', null)).toEqual({});
  });
});
