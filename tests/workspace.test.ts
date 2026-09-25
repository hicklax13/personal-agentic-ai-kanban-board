import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  prepareWorkspace,
  repoRootOf,
  slugify,
  worktreePlan,
  type GitRunner,
} from '../src/main/dispatch/workspace.js';
import { makeCard } from '../src/main/store/schema.js';
import type { Card, CardAgentConfig } from '../shared/types.js';

function card(config: Partial<CardAgentConfig>, fields: Partial<Card> = {}): Card {
  return { ...makeCard({ columnId: 'c', title: 'Fix the login page!', position: 0, config }), ...fields };
}

/** Real git, argv only — the same way the app calls it. */
const git: GitRunner = async (args, cwd) => {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stdout, stderr: '' };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? String(err) };
  }
};

describe('names', () => {
  it('turns a title into a short branch-safe slug', () => {
    expect(slugify('Fix the login page!')).toBe('fix-the-login-page');
    expect(slugify('   ')).toBe('task');
    expect(slugify('A'.repeat(80)).length).toBeLessThanOrEqual(40);
  });

  it('puts the worktree under .worktrees on its own kanban/ branch, the same every time', () => {
    const c = card({}, { id: 'ABCDEF12-3456' });
    const plan = worktreePlan('C:/repo', c);
    expect(plan.path).toBe(join('C:/repo', '.worktrees', 'abcdef12'));
    expect(plan.branch).toBe('kanban/fix-the-login-page-abcdef12');
    expect(worktreePlan('C:/repo', c)).toEqual(plan);
  });
});

describe('prepareWorkspace without git', () => {
  it('uses the board folder in board mode', async () => {
    expect(await prepareWorkspace(card({ workspaceMode: 'board' }), 'C:/board', git)).toEqual({
      ok: true,
      cwd: 'C:/board',
    });
  });

  it('refuses a missing own folder with a clear message', async () => {
    const res = await prepareWorkspace(card({ workspaceMode: 'dir', workingDirectory: 'C:/no/such/folder' }), null, git);
    expect(res).toEqual({ ok: false, error: 'Working folder not found: C:/no/such/folder' });
    const none = await prepareWorkspace(card({ workspaceMode: 'dir', workingDirectory: null }), null, git);
    expect(none.ok).toBe(false);
  });
});

describe('prepareWorkspace with a real git repository', () => {
  let root: string;
  let repo: string;
  let plain: string;

  beforeAll(async () => {
    root = join(tmpdir(), `agent-kanban-wt-${randomUUID()}`);
    repo = join(root, 'repo');
    plain = join(root, 'plain');
    await fs.mkdir(repo, { recursive: true });
    await fs.mkdir(plain, { recursive: true });
    const g = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    };
    g('init', '-q');
    g('config', 'user.email', 'test@example.com');
    g('config', 'user.name', 'Test');
    await fs.writeFile(join(repo, 'README.md'), 'hello\n');
    g('add', '.');
    g('commit', '-q', '-m', 'first');
  });

  afterAll(async () => {
    // Worktrees register themselves with the repository; remove both.
    await fs.rm(root, { recursive: true, force: true });
  });

  it('finds the top of the repository', async () => {
    const res = await repoRootOf(repo, git);
    expect(res.ok && res.root.replace(/\\/g, '/').toLowerCase()).toBe(repo.replace(/\\/g, '/').toLowerCase());
  });

  it('makes a worktree on its own branch, and reuses it next time', async () => {
    const c = card({ workspaceMode: 'worktree', workingDirectory: repo }, { id: 'feedbeef-0000' });
    const first = await prepareWorkspace(c, null, git);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.worktreePath).toBe(first.cwd);
    expect(existsSync(join(first.cwd as string, 'README.md'))).toBe(true);

    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: first.cwd as string, encoding: 'utf8' });
    expect(branch.trim()).toBe('kanban/fix-the-login-page-feedbeef');

    // The main checkout does not see the worktree as untracked files.
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
    expect(status).not.toContain('.worktrees');

    const again = await prepareWorkspace({ ...c, worktreePath: first.worktreePath ?? null }, null, git);
    expect(again).toEqual(first);
  });

  it('says plainly when the folder is not a git repository', async () => {
    const res = await prepareWorkspace(card({ workspaceMode: 'worktree', workingDirectory: plain }), null, git);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/needs a git repository/);
  });
});
