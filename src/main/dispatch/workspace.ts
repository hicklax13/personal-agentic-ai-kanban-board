import { existsSync, promises as fs } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { Card, WorkspaceMode } from '@shared/types';

/**
 * Where a card's agent works.
 *
 * - `board`    — the board's folder (Settings shows it; every card shares it).
 * - `dir`      — a folder chosen on the card.
 * - `worktree` — a git worktree made for this card from the repository that
 *                holds the card's folder (or the board's folder). Like Hermes
 *                Agent's Kanban, it lives under `<repo>/.worktrees/<id>` on its
 *                own branch, and is kept after the task finishes so the work
 *                can be reviewed and merged.
 */

export type GitRunner = (
  args: string[],
  cwd: string,
) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

export type WorkspaceResult =
  | { ok: true; cwd: string | null; worktreePath?: string }
  | { ok: false; error: string };

export function workspaceModeOf(card: Pick<Card, 'config'>): WorkspaceMode {
  return card.config.workspaceMode ?? (card.config.workingDirectory ? 'dir' : 'board');
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'task';
}

/** Folder and branch for a card's worktree. Stable, so a later run finds the same one. */
export function worktreePlan(repoRoot: string, card: Pick<Card, 'id' | 'title'>): { path: string; branch: string } {
  const short = card.id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase() || 'card';
  return {
    path: join(repoRoot, '.worktrees', short),
    branch: `kanban/${slugify(card.title)}-${short}`,
  };
}

function lastLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() ?? 'git gave no reason'
  );
}

/** The top folder of the repository holding `dir`, or why there is none. */
export async function repoRootOf(
  dir: string,
  git: GitRunner,
): Promise<{ ok: true; root: string } | { ok: false; error: string }> {
  if (!existsSync(dir)) return { ok: false, error: `Folder not found: ${dir}` };
  const top = await git(['rev-parse', '--show-toplevel'], dir);
  if (!top.ok || !top.stdout.trim()) {
    return { ok: false, error: `${dir} is not inside a git repository.` };
  }
  return { ok: true, root: join(top.stdout.trim()) };
}

/**
 * Keep `.worktrees/` out of the main checkout's `git status`.
 *
 * Without this an agent running `git add -A` in the main checkout would add a
 * card's worktree as an embedded repository. `info/exclude` is git's local-only
 * ignore list: it changes no tracked file and is never committed.
 */
async function excludeWorktrees(repoRoot: string, git: GitRunner): Promise<void> {
  const common = await git(['rev-parse', '--git-common-dir'], repoRoot);
  if (!common.ok) return;
  const gitDir = common.stdout.trim();
  const exclude = join(isAbsolute(gitDir) ? gitDir : join(repoRoot, gitDir), 'info', 'exclude');
  try {
    const current = existsSync(exclude) ? await fs.readFile(exclude, 'utf8') : '';
    const listed = current.split(/\r?\n/).some((l) => ['/.worktrees/', '.worktrees/'].includes(l.trim()));
    if (listed) return;
    await fs.mkdir(dirname(exclude), { recursive: true });
    const sep = current && !current.endsWith('\n') ? '\n' : '';
    await fs.appendFile(exclude, `${sep}# Agent Kanban task worktrees\n/.worktrees/\n`, 'utf8');
  } catch {
    // Best effort: the worktree still works, it just shows up in git status.
  }
}

/**
 * Resolve — and for worktrees, create — the folder a card's run uses.
 * `cwd: null` means "no folder of its own", for agents reached over HTTP.
 */
export async function prepareWorkspace(
  card: Pick<Card, 'id' | 'title' | 'config' | 'worktreePath'>,
  boardFolder: string | null,
  git: GitRunner,
): Promise<WorkspaceResult> {
  const mode = workspaceModeOf(card);

  if (mode === 'board') return { ok: true, cwd: boardFolder };

  if (mode === 'dir') {
    const dir = card.config.workingDirectory;
    if (!dir) return { ok: false, error: 'This card is set to use its own folder, but none is chosen.' };
    if (!existsSync(dir)) return { ok: false, error: `Working folder not found: ${dir}` };
    return { ok: true, cwd: dir };
  }

  if (card.worktreePath && existsSync(card.worktreePath)) {
    return { ok: true, cwd: card.worktreePath, worktreePath: card.worktreePath };
  }
  const base = card.config.workingDirectory || boardFolder;
  if (!base) return { ok: false, error: 'Choose the repository folder to make the worktree from.' };
  const repo = await repoRootOf(base, git);
  if (!repo.ok) return { ok: false, error: `A git worktree needs a git repository: ${repo.error}` };

  const plan = worktreePlan(repo.root, card);
  if (existsSync(plan.path)) return { ok: true, cwd: plan.path, worktreePath: plan.path };

  await excludeWorktrees(repo.root, git);
  let add = await git(['worktree', 'add', '-b', plan.branch, plan.path], repo.root);
  if (!add.ok && /already exists/i.test(add.stderr)) {
    // The branch survives from an earlier worktree of this card; reuse it.
    add = await git(['worktree', 'add', plan.path, plan.branch], repo.root);
  }
  if (!add.ok) return { ok: false, error: `Could not create the git worktree: ${lastLine(add.stderr)}` };
  return { ok: true, cwd: plan.path, worktreePath: plan.path };
}
