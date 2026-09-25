import { describe, expect, it } from 'vitest';
import { buildClaudeCommand } from '../src/main/agents/claudeCode.js';
import { buildCodexCommand, itemText } from '../src/main/agents/codex.js';
import { buildHermesCommand } from '../src/main/agents/hermes.js';
import { parseSseData } from '../src/main/agents/lmstudio.js';
import { LineBuffer, pickErrorLine } from '../src/main/agents/streaming.js';
import { buildPrompt, renderCommand } from '../src/main/agents/types.js';
import { resolveAutoMove } from '../src/main/dispatch/dispatcher.js';
import { makeCard, makeColumn, defaultAgentConfig } from '../src/main/store/schema.js';
import type { Card, CardAgentConfig } from '../shared/types.js';

function card(config: Partial<CardAgentConfig> = {}, fields: Partial<Card> = {}): Card {
  const base = makeCard({ columnId: 'col', title: 'Fix the parser', position: 0 });
  return { ...base, ...fields, config: defaultAgentConfig({ taskPrompt: 'Do it.', ...config }) };
}

/** Value of the flag immediately following `flag` in an argv array. */
function argAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// ---------------------------------------------------------------------------

describe('buildPrompt', () => {
  it('sends the task prompt on its own when there is no description', () => {
    expect(buildPrompt(card({ taskPrompt: 'Just this.' }))).toBe('Just this.');
  });

  it('puts the card description above the prompt as context', () => {
    const c = card({ taskPrompt: 'Refactor it.' }, { description: 'The parser is fragile.' });
    const prompt = buildPrompt(c);
    expect(prompt).toContain('The parser is fragile.');
    expect(prompt).toContain('Refactor it.');
    expect(prompt.indexOf('fragile')).toBeLessThan(prompt.indexOf('Refactor it.'));
  });

  it('falls back to the card title when no prompt was written', () => {
    expect(buildPrompt(card({ taskPrompt: '' }))).toBe('Fix the parser');
  });
});

describe('renderCommand', () => {
  it('quotes arguments containing spaces so the line is paste-safe', () => {
    expect(renderCommand('claude', ['-p', 'two words'])).toBe('claude -p "two words"');
  });

  it('escapes embedded quotes', () => {
    expect(renderCommand('x', ['say "hi"'])).toBe('x "say \\"hi\\""');
  });
});

// ---------------------------------------------------------------------------

describe('buildClaudeCommand', () => {
  const base = { binaryPath: 'C:/bin/claude.exe', workspaceRoot: 'C:/ws', resumeSessionId: null };

  it('always requests the streaming JSON protocol', () => {
    const { args } = buildClaudeCommand({ ...base, card: card() });
    expect(argAfter(args, '--output-format')).toBe('stream-json');
    expect(args).toContain('--include-partial-messages');
  });

  it('passes --verbose, without which the CLI rejects stream-json outright', () => {
    // Regression guard: dropping this makes every Claude run exit 1 with
    // "When using --print, --output-format=stream-json requires --verbose",
    // before a single event is emitted.
    expect(buildClaudeCommand({ ...base, card: card() }).args).toContain('--verbose');
  });

  it('never runs interactively, because a permission prompt would hang forever', () => {
    const { args } = buildClaudeCommand({ ...base, card: card() });
    expect(argAfter(args, '--permission-mode')).toBe('bypassPermissions');
  });

  it('passes the prompt as a single argv entry, not through a shell', () => {
    const { args } = buildClaudeCommand({
      ...base,
      card: card({ taskPrompt: 'rm -rf / && echo "pwned" `whoami`' }),
    });
    // The dangerous text must survive intact as exactly one argument.
    expect(args[0]).toBe('-p');
    expect(args[1]).toBe('rm -rf / && echo "pwned" `whoami`');
  });

  it('omits --model entirely when no model was chosen', () => {
    expect(buildClaudeCommand({ ...base, card: card() }).args).not.toContain('--model');
  });

  it('passes the chosen model', () => {
    const { args } = buildClaudeCommand({ ...base, card: card({ model: 'sonnet' }) });
    expect(argAfter(args, '--model')).toBe('sonnet');
  });

  it('expands selected MCP servers into namespaced tool names', () => {
    const { args } = buildClaudeCommand({
      ...base,
      card: card({ allowedTools: ['Read'], allowedMcpServers: ['plugin:github:github'] }),
    });
    const i = args.indexOf('--allowedTools');
    expect(args.slice(i + 1, i + 3)).toEqual(['Read', 'mcp__plugin_github_github']);
  });

  it('locks MCP off when tools are scoped but no server was selected', () => {
    const { args } = buildClaudeCommand({ ...base, card: card({ allowedTools: ['Read'] }) });
    expect(args).toContain('--strict-mcp-config');
    expect(argAfter(args, '--mcp-config')).toBe('{"mcpServers":{}}');
  });

  it('does not restrict anything when the card selected nothing', () => {
    const { args } = buildClaudeCommand({ ...base, card: card() });
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('--strict-mcp-config');
  });

  it('scopes plugins through a settings override', () => {
    const { args } = buildClaudeCommand({
      ...base,
      card: card({ allowedPlugins: ['superpowers@claude-plugins-official'] }),
    });
    expect(argAfter(args, '--settings')).toBe(
      '{"enabledPlugins":{"superpowers@claude-plugins-official":true}}',
    );
  });

  it('resumes a session when the card belongs to a chat thread', () => {
    const { args } = buildClaudeCommand({ ...base, card: card(), resumeSessionId: 'sess-1' });
    expect(argAfter(args, '--resume')).toBe('sess-1');
  });

  it('prefers the card working directory over the board workspace', () => {
    const { args } = buildClaudeCommand({
      ...base,
      card: card({ workingDirectory: 'C:/other' }),
    });
    expect(argAfter(args, '--add-dir')).toBe('C:/other');
  });
});

// ---------------------------------------------------------------------------

describe('buildCodexCommand', () => {
  const base = {
    binaryPath: 'C:/bin/codex.exe',
    workspaceRoot: 'C:/ws',
    resumeSessionId: null,
    lastMessagePath: 'C:/tmp/last.txt',
    localProvider: null,
  };

  it('uses the non-interactive exec subcommand with JSONL output', () => {
    const { args } = buildCodexCommand({ ...base, card: card() });
    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
  });

  it('captures the final answer to a file, which is more reliable than the event stream', () => {
    const { args } = buildCodexCommand({ ...base, card: card() });
    expect(argAfter(args, '--output-last-message')).toBe('C:/tmp/last.txt');
  });

  it('allows running outside a git repository', () => {
    expect(buildCodexCommand({ ...base, card: card() }).args).toContain('--skip-git-repo-check');
  });

  it('runs with full permissions: no sandbox and no approval prompts', () => {
    const { args } = buildCodexCommand({ ...base, card: card() });
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('does not also pass --sandbox, which the bypass flag replaces', () => {
    const { args } = buildCodexCommand({ ...base, card: card() });
    expect(args).not.toContain('--sandbox');
  });

  it('routes to a local provider when the card selected one', () => {
    const { args } = buildCodexCommand({ ...base, card: card(), localProvider: 'ollama' });
    expect(args).toContain('--oss');
    expect(argAfter(args, '--local-provider')).toBe('ollama');
  });

  it('puts the resume subcommand before the prompt', () => {
    const { args } = buildCodexCommand({ ...base, card: card(), resumeSessionId: 'thread-9' });
    expect(args.slice(0, 3)).toEqual(['exec', 'resume', 'thread-9']);
  });
});

describe('codex itemText', () => {
  it('reads whichever payload key the item type uses', () => {
    expect(itemText({ text: 'a' })).toBe('a');
    expect(itemText({ message: 'b' })).toBe('b');
    expect(itemText({ content: 'c' })).toBe('c');
    expect(itemText({ type: 'error' })).toBeNull();
  });

  it('reads the real usage-limit error item captured from this machine', () => {
    const item = {
      id: 'item_0',
      type: 'error',
      message: 'You’ve hit your usage limit.',
    };
    expect(itemText(item)).toBe('You’ve hit your usage limit.');
  });
});

// ---------------------------------------------------------------------------

describe('buildHermesCommand', () => {
  const base = { binaryPath: 'C:/bin/hermes.exe', workspaceRoot: 'C:/ws', resumeSessionId: null };

  it('uses one-shot mode', () => {
    const { args } = buildHermesCommand({ ...base, card: card() });
    expect(args[0]).toBe('-z');
    expect(args[1]).toBe('Do it.');
  });

  it('strips the hermes: namespace off the provider id', () => {
    const { args } = buildHermesCommand({ ...base, card: card({ providerId: 'hermes:deepseek' }) });
    expect(argAfter(args, '--provider')).toBe('deepseek');
  });

  it('passes toolsets as a comma-separated list with the namespace removed', () => {
    const { args } = buildHermesCommand({
      ...base,
      card: card({ allowedTools: ['hermes:hermes-cli', 'hermes:web'] }),
    });
    expect(argAfter(args, '-t')).toBe('hermes-cli,web');
  });

  it('passes skills, which is the one agent here that can genuinely scope them', () => {
    const { args } = buildHermesCommand({
      ...base,
      card: card({ allowedSkills: ['user:research', 'plugin:scrape'] }),
    });
    expect(argAfter(args, '--skills')).toBe('research,scrape');
  });

  it('runs with full permissions so a headless run never stalls on a prompt', () => {
    const { args } = buildHermesCommand({ ...base, card: card() });
    expect(args).toContain('--yolo');
    expect(args).toContain('--accept-hooks');
  });

  it('keeps the prompt as the value of -z after adding the permission flags', () => {
    const { args } = buildHermesCommand({ ...base, card: card() });
    expect(argAfter(args, '-z')).toBe('Do it.');
  });

  it('sets the working directory with --in', () => {
    const { args } = buildHermesCommand({ ...base, card: card() });
    expect(argAfter(args, '--in')).toBe('C:/ws');
  });
});

// ---------------------------------------------------------------------------

describe('LineBuffer', () => {
  it('holds back a partial line until its newline arrives', () => {
    const buf = new LineBuffer();
    expect(buf.push('{"a":1}\n{"b":')).toEqual(['{"a":1}']);
    expect(buf.push('2}\n')).toEqual(['{"b":2}']);
  });

  it('handles CRLF, which is what Windows child processes emit', () => {
    expect(new LineBuffer().push('one\r\ntwo\r\n')).toEqual(['one', 'two']);
  });

  it('emits a trailing line with no newline on flush', () => {
    const buf = new LineBuffer();
    buf.push('tail');
    expect(buf.flush()).toEqual(['tail']);
    expect(buf.flush()).toEqual([]);
  });

  it('drops blank lines', () => {
    expect(new LineBuffer().push('a\n\n\nb\n')).toEqual(['a', 'b']);
  });
});

describe('pickErrorLine', () => {
  it('prefers the real error over a shutdown hook logged after it', () => {
    // Both lines are real output captured from a failing Claude Code run. The
    // hook failure comes last and is a red herring.
    const stderr = [
      'Error: When using --print, --output-format=stream-json requires --verbose',
      'SessionEnd hook [${CLAUDE_PLUGIN_ROOT}/scripts/on-event.sh] failed: curl: (22) 404',
    ];
    expect(pickErrorLine(stderr)).toContain('requires --verbose');
  });

  it('falls back to the last line when nothing looks like an error', () => {
    expect(pickErrorLine(['starting up', 'still going', 'done'])).toBe('done');
  });

  it('returns null for no stderr at all', () => {
    expect(pickErrorLine([])).toBeNull();
  });

  it('recognises an auth expiry', () => {
    expect(
      pickErrorLine(['banner', 'Failed to authenticate: OAuth session expired', 'bye']),
    ).toContain('OAuth session expired');
  });
});

describe('parseSseData', () => {
  it('unwraps a data frame', () => {
    expect(parseSseData('data: {"x":1}')).toBe('{"x":1}');
  });

  it('ignores the terminator and keep-alives', () => {
    expect(parseSseData('data: [DONE]')).toBeNull();
    expect(parseSseData('')).toBeNull();
    expect(parseSseData(': ping')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('resolveAutoMove', () => {
  const columns = [
    makeColumn('Backlog', 0, '#000'),
    makeColumn('In Progress', 1, '#000'),
    makeColumn('In Review', 2, '#000'),
    makeColumn('Done', 3, '#000'),
  ];

  it('moves a starting card to In Progress by name', () => {
    expect(resolveAutoMove(columns, 'start', columns[0].id)).toBe(columns[1].id);
  });

  it('moves a finished card to In Review', () => {
    expect(resolveAutoMove(columns, 'success', columns[1].id)).toBe(columns[2].id);
  });

  it('never drags a card backwards when it is re-run from a later column', () => {
    expect(resolveAutoMove(columns, 'start', columns[2].id)).toBeNull();
  });

  it('stays put when the card is already in the target column', () => {
    expect(resolveAutoMove(columns, 'start', columns[1].id)).toBeNull();
  });

  it('falls back to position on a board with entirely custom column names', () => {
    const custom = [makeColumn('Ideas', 0, '#000'), makeColumn('Doing', 1, '#000')];
    expect(resolveAutoMove(custom, 'start', custom[0].id)).toBe(custom[1].id);
  });

  it('does nothing on a single-column board', () => {
    const one = [makeColumn('Only', 0, '#000')];
    expect(resolveAutoMove(one, 'start', one[0].id)).toBeNull();
    expect(resolveAutoMove(one, 'success', one[0].id)).toBeNull();
  });
});
