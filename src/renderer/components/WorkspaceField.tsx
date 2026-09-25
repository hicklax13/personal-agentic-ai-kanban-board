import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, FolderOpen } from 'lucide-react';
import type { GitRepoInfo, WorkspaceMode } from '@shared/types';

interface Props {
  idPrefix: string;
  mode: WorkspaceMode;
  path: string | null;
  /** The board's folder, used when the card names none. */
  boardFolder: string | null;
  onChange: (next: { mode: WorkspaceMode; path: string | null }) => void;
}

/**
 * Where the agent works: the board's folder, a folder of the task's own, or a
 * fresh git worktree (its own branch and checkout under `<repo>/.worktrees/`),
 * so parallel tasks in one repository never edit the same files.
 */
export default function WorkspaceField({ idPrefix, mode, path, boardFolder, onChange }: Props): React.JSX.Element {
  const [repo, setRepo] = useState<GitRepoInfo | null>(null);
  const repoFolder = path || boardFolder;

  // Say straight away whether a worktree can be made from the chosen folder,
  // rather than letting the task fail when it starts.
  useEffect(() => {
    if (mode !== 'worktree' || !repoFolder) {
      setRepo(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void window.api.gitRepoInfo(repoFolder).then((info) => {
        if (!cancelled) setRepo(info);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, repoFolder]);

  const browse = async (): Promise<void> => {
    const picked = await window.api.pickFolder(path || boardFolder);
    if (picked) onChange({ mode, path: picked });
  };

  return (
    <div className="field">
      <label htmlFor={`${idPrefix}-workspace`}>Workspace</label>
      <select
        id={`${idPrefix}-workspace`}
        value={mode}
        onChange={(e) => onChange({ mode: e.target.value as WorkspaceMode, path })}
      >
        <option value="board">Board folder{boardFolder ? ` · ${boardFolder}` : ''}</option>
        <option value="dir">A folder of its own</option>
        <option value="worktree">New git worktree</option>
      </select>

      {mode !== 'board' ? (
        <div className="row" style={{ marginTop: 6 }}>
          <input
            id={`${idPrefix}-workspace-path`}
            value={path ?? ''}
            placeholder={
              mode === 'dir'
                ? 'Folder the agent works in'
                : `Repository folder (default: ${boardFolder ?? 'the board folder'})`
            }
            onChange={(e) => onChange({ mode, path: e.target.value || null })}
          />
          <button type="button" style={{ flex: '0 0 auto' }} onClick={() => void browse()}>
            <FolderOpen size={15} aria-hidden="true" />
            Browse…
          </button>
        </div>
      ) : null}

      {mode === 'dir' && !path ? <div className="hint warn">Choose the folder for this task.</div> : null}
      {mode === 'worktree' ? (
        repo === null ? (
          <div className="hint">Checking the folder…</div>
        ) : repo.ok ? (
          <div className="hint">
            <CircleCheck className="inline-icon ok" size={14} aria-hidden="true" /> Git repository {repo.root}. The
            task gets its own branch and a checkout in{' '}
            <code className="inline">.worktrees</code> there, kept after it finishes.
          </div>
        ) : (
          <div className="hint warn">
            <CircleX className="inline-icon fail" size={14} aria-hidden="true" /> {repo.error} A worktree needs a git
            repository.
          </div>
        )
      ) : null}
    </div>
  );
}
