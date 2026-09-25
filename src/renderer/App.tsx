import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Plus, Search, Settings, X } from 'lucide-react';
import type {
  AppSettings,
  BoardState,
  Card,
  CardAgentConfig,
  DiscoveryReport,
  EndpointSettings,
  JudgeSettings,
  RendererApi,
  SecretKey,
} from '@shared/types';
import {
  addCard,
  addChatSession,
  addColumn,
  applyCardPatch,
  deleteCard,
  deleteColumn,
  findCard,
  moveCard,
  sortedColumns,
  uid,
  updateCard,
  updateCardConfig,
  updateColumn,
  upsertRun,
} from '@shared/boardOps';
import { type FlowKey, flowColumn, flowKeyOf, placeNewCard } from '@shared/flow';
import Board from './components/Board.js';
import CardDetail from './components/CardDetail.js';
import NewTaskModal, { type TaskDraft } from './components/NewTaskModal.js';
import SettingsModal, { type SettingsTab } from './components/SettingsModal.js';
import { Crest, StationMark, type StationTone } from './components/heraldry.js';
import { cardMatches, searchWords } from './components/search.js';

declare global {
  interface Window {
    api: RendererApi;
  }
}

const SAVE_DEBOUNCE_MS = 400;
/** How long a station stays pointed out after a click on the status line. */
const FLASH_MS = 1400;
/** The title a new board starts with; any other is the owner's and is shown. */
const DEFAULT_BOARD_TITLE = 'Agent Board';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function App(): React.JSX.Element {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryReport | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [newTaskColumnId, setNewTaskColumnId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ kind: 'err' | 'info'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [flashKey, setFlashKey] = useState<FlowKey | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardRef = useRef<BoardState | null>(null);
  boardRef.current = board;
  /**
   * The highest workflow change from the main process applied to `board`. It is
   * updated in the same state update that applies the change, so a save always
   * reports exactly what the board it carries has seen.
   */
  const seenSeq = useRef(0);

  // --------------------------------------------------------------- startup
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [loaded, initialSettings] = await Promise.all([window.api.loadBoard(), window.api.getSettings()]);
      if (cancelled) return;
      seenSeq.current = loaded.patchSeq;
      setBoard(loaded.board);
      setSettings(initialSettings);

      // Discovery is slow (subprocess probes plus MCP health checks), so the
      // board renders first and the pickers populate when the scan lands.
      const report = await window.api.getDiscovery();
      if (cancelled) return;
      setDiscovery(report);
      setScanning(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------- run updates in
  useEffect(() => {
    const unsubscribe = window.api.onRunUpdate((update) => {
      setBoard((prev) => {
        if (!prev) return prev;
        let next = upsertRun(prev, update.run);
        if (update.moveToColumnId) {
          const card = findCard(next, update.cardId);
          if (card && card.columnId !== update.moveToColumnId) {
            next = moveCard(next, update.cardId, update.moveToColumnId, Number.MAX_SAFE_INTEGER);
          }
        }
        boardRef.current = next;
        return next;
      });

      // The main process already persisted this update, so no save is scheduled
      // here — it owns run history and keeps its own copy on every save.
      setRunning((prev) => {
        const active = ['queued', 'acknowledged', 'running'].includes(update.run.status);
        const next = new Set(prev);
        if (active) next.add(update.cardId);
        else next.delete(update.cardId);
        return next;
      });
    });
    return unsubscribe;
  }, []);

  // ------------------------------------------- workflow changes from main
  useEffect(
    () =>
      window.api.onCardPatch((update) => {
        setBoard((prev) => {
          if (!prev) return prev;
          const next = applyCardPatch(prev, update.cardId, update.patch);
          seenSeq.current = Math.max(seenSeq.current, update.seq);
          boardRef.current = next;
          return next;
        });
      }),
    [],
  );

  // --------------------------------------------------------------- saving
  const saveNow = useCallback(async (): Promise<void> => {
    const current = boardRef.current;
    if (!current) return;
    const res = await window.api.saveBoard(current, seenSeq.current);
    if (!res.ok) setToast({ kind: 'err', text: `Could not save the board: ${res.error}` });
  }, []);

  /** Save shortly after the last change; the newest board is read when the timer fires. */
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void saveNow();
    }, SAVE_DEBOUNCE_MS);
  }, [saveNow]);

  /** Save any pending change right away — before asking the main process to act on the board. */
  const flushSave = useCallback(async (): Promise<void> => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    await saveNow();
  }, [saveNow]);

  /** Apply a pure board operation and persist the result. */
  const mutate = useCallback(
    (fn: (prev: BoardState) => BoardState) => {
      setBoard((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        boardRef.current = next;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  // Flush a pending save when the window goes away, so the last keystroke is
  // never the one that gets lost.
  useEffect(() => {
    const flush = (): void => {
      if (saveTimer.current && boardRef.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void window.api.saveBoard(boardRef.current, seenSeq.current);
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // Ctrl+K goes to the search box from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!flashKey) return;
    const timer = setTimeout(() => setFlashKey(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashKey]);

  // ------------------------------------------------------------- handlers
  const selectedCard: Card | null = useMemo(
    () => (board && selectedCardId ? (findCard(board, selectedCardId) ?? null) : null),
    [board, selectedCardId],
  );

  const agentsById = useMemo(() => new Map((discovery?.agents ?? []).map((a) => [a.id, a])), [discovery]);

  const handleCreateTask = (draft: TaskDraft, requestedColumnId: string): void => {
    const current = boardRef.current;
    if (!current) return;
    // A future schedule waits in SCHEDULED and an unfinished parent in TODO,
    // whichever column the task was started in.
    const columnId = placeNewCard(current, requestedColumnId, draft, new Date());
    const id = uid();
    mutate((prev) => addCard(prev, columnId, { id, ...draft }));
    setNewTaskColumnId(null);
    setSelectedCardId(id);
  };

  const handleSetSchedule = (cardId: string, scheduledAt: string | null): void => {
    mutate((prev) => {
      const card = findCard(prev, cardId);
      if (!card) return prev;
      let next = updateCard(prev, cardId, { scheduledAt });
      const scheduled = flowColumn(prev.columns, 'scheduled');
      const todo = flowColumn(prev.columns, 'todo');
      const key = flowKeyOf(prev.columns, card.columnId);
      const future = Boolean(scheduledAt && Date.parse(scheduledAt) > Date.now());
      // A schedule only means something in SCHEDULED; clearing one there parks
      // the card in TODO rather than starting it.
      if (future && scheduled && key !== 'scheduled' && key !== 'running') {
        next = moveCard(next, cardId, scheduled.id, Number.MAX_SAFE_INTEGER);
      } else if (!scheduledAt && key === 'scheduled' && todo) {
        next = moveCard(next, cardId, todo.id, Number.MAX_SAFE_INTEGER);
      }
      return next;
    });
  };

  /** Retry and Approve: the same move as dragging the card to that station. */
  const handleQuickMove = (cardId: string, to: FlowKey): void => {
    mutate((prev) => {
      const column = flowColumn(prev.columns, to);
      return column ? moveCard(prev, cardId, column.id, Number.MAX_SAFE_INTEGER) : prev;
    });
  };

  const handleDispatch = async (): Promise<void> => {
    if (!selectedCard || !board) return;
    const cardId = selectedCard.id;
    setToast(null);
    // The main process runs its own copy of the card, so it must hold the
    // latest edits (a just-changed model, say) before it starts.
    await flushSave();
    setRunning((prev) => new Set(prev).add(cardId));

    const res = await window.api.startDispatch({ cardId, card: selectedCard, workspaceRoot: board.workspaceRoot });

    if (res.queued && res.info) setToast({ kind: 'info', text: res.info });
    else if (!res.ok && res.error) setToast({ kind: 'err', text: res.error });
    setRunning((prev) => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
  };

  const refreshDiscovery = async (): Promise<void> => {
    setScanning(true);
    setDiscovery(await window.api.refreshDiscovery());
    setScanning(false);
  };

  /** Bring a station into view and point it out. */
  const goToStation = (key: FlowKey): void => {
    document
      .getElementById(`station-${key}`)
      ?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
    setFlashKey(key);
  };

  // ---------------------------------------------------------------- render
  if (!board || !settings) {
    return (
      <div className="loading" role="status">
        <Crest height={132} />
        <span>Opening the board…</span>
      </div>
    );
  }

  const columnOf = (key: FlowKey): string | undefined => flowColumn(board.columns, key)?.id;
  const countIn = (key: FlowKey): number => {
    const id = columnOf(key);
    return id ? board.cards.filter((c) => c.columnId === id).length : 0;
  };
  // Live work: cards in RUNNING, plus any run going elsewhere.
  const liveCount = board.cards.filter(
    (c) => c.columnId === columnOf('running') || running.has(c.id) || c.goal?.status === 'running',
  ).length;
  const readyCount = countIn('ready');
  const blockedCount = countIn('blocked');
  const reviewCount = countIn('review');

  // Each state wears its station's tincture, and its own word.
  const statusPills: { key: FlowKey; count: number; label: string; tone: StationTone }[] = [
    { key: 'ready', count: readyCount, label: 'ready', tone: 'or' },
    { key: 'blocked', count: blockedCount, label: 'blocked', tone: blockedCount ? 'gules' : 'plain' },
    { key: 'review', count: reviewCount, label: 'to review', tone: reviewCount ? 'purpure' : 'plain' },
  ];

  const availableAgents = (discovery?.agents ?? []).filter((a) => a.availability === 'available');
  const words = searchWords(query);
  const matchCount = board.cards.filter((c) =>
    cardMatches(c, words, c.config.agentId ? (agentsById.get(c.config.agentId)?.name ?? c.config.agentId) : ''),
  ).length;
  const newTaskColumn = columnOf('todo') ?? sortedColumns(board)[0]?.id ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Crest height={58} />
          <h1 className="brand-name">
            Agent Kanban
            {board.boardTitle && board.boardTitle !== DEFAULT_BOARD_TITLE ? <span>{board.boardTitle}</span> : null}
          </h1>
        </div>

        <nav className="status" aria-label="Board status">
          <button
            type="button"
            className={`status-pill${liveCount ? ' live' : ' zero'}`}
            onClick={() => goToStation('running')}
            title="Show RUNNING"
          >
            <span className={`live-dot${liveCount ? '' : ' idle'}`} aria-hidden="true" />
            <b>{liveCount}</b>
            <span className="status-label">running</span>
          </button>
          {statusPills.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`status-pill tone-${p.tone}${p.count ? '' : ' zero'}`}
              onClick={() => goToStation(p.key)}
              title={`Show ${p.key.toUpperCase()}`}
            >
              <StationMark tone={p.tone} />
              <b>{p.count}</b>
              <span className="status-label">{p.label}</span>
            </button>
          ))}
          <span className="status-rule" aria-hidden="true" />
          <button
            type="button"
            className="status-pill"
            onClick={() => setSettingsTab('connections')}
            title={scanning ? 'Checking which agents are set up' : discovery?.agents.map((a) => `${a.name}: ${a.statusDetail}`).join('\n')}
          >
            {scanning ? (
              <>
                <span className="live-dot scanning" aria-hidden="true" />
                <span className="status-label">Checking agents…</span>
              </>
            ) : (
              <>
                <span className={`dot ${availableAgents.length > 0 ? 'available' : 'degraded'}`} aria-hidden="true" />
                <b>{availableAgents.length}</b>
                <span className="status-label">of {discovery?.agents.length ?? 0} agents ready</span>
              </>
            )}
          </button>
        </nav>

        <span className="spacer" />

        <div className="search" role="search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            placeholder="Find a task"
            aria-label="Find a task"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                e.currentTarget.blur();
              }
            }}
          />
          {query ? (
            <>
              <span className="search-count" aria-live="polite">
                {matchCount} found
              </span>
              <button type="button" className="search-clear" aria-label="Clear the search" onClick={() => setQuery('')}>
                <X size={14} aria-hidden="true" />
              </button>
            </>
          ) : (
            <kbd aria-hidden="true">Ctrl K</kbd>
          )}
        </div>

        <button type="button" className="primary new-task" disabled={!newTaskColumn} onClick={() => setNewTaskColumnId(newTaskColumn)}>
          <Plus size={17} aria-hidden="true" />
          New task
        </button>
        <button
          type="button"
          className="band-button"
          onClick={() => void window.api.revealBoardFile()}
          title="Show the board file in its folder"
        >
          <FolderOpen size={18} aria-hidden="true" />
          <span className="band-label">Board file</span>
        </button>
        <button type="button" className="band-button" onClick={() => setSettingsTab('accounts')} title="Settings">
          <Settings size={18} aria-hidden="true" />
          <span className="band-label">Settings</span>
        </button>
      </header>

      {toast ? (
        <div className={`banner toast ${toast.kind}`} role={toast.kind === 'err' ? 'alert' : 'status'}>
          <span>{toast.text}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setToast(null)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <main className="main">
        <Board
          board={board}
          agentsById={agentsById}
          selectedCardId={selectedCardId}
          query={query}
          flashKey={flashKey}
          onSelectCard={setSelectedCardId}
          onMoveCard={(cardId, columnId, index) => mutate((prev) => moveCard(prev, cardId, columnId, index))}
          onQuickMove={handleQuickMove}
          onAddCard={setNewTaskColumnId}
          onAddColumn={() => mutate((prev) => addColumn(prev, 'New column'))}
          onRenameColumn={(columnId, title) => mutate((prev) => updateColumn(prev, columnId, { title }))}
          onDeleteColumn={(columnId) => mutate((prev) => deleteColumn(prev, columnId))}
        />

        {selectedCard ? (
          <CardDetail
            card={selectedCard}
            board={board}
            discovery={discovery}
            settings={settings}
            chatSessions={board.chatSessions}
            workspaceRoot={board.workspaceRoot}
            isRunning={running.has(selectedCard.id) || selectedCard.goal?.status === 'running'}
            onPatchCard={(patch) => mutate((prev) => updateCard(prev, selectedCard.id, patch))}
            onPatchConfig={(patch: Partial<CardAgentConfig>) =>
              mutate((prev) => updateCardConfig(prev, selectedCard.id, patch))
            }
            onSetSchedule={(scheduledAt) => handleSetSchedule(selectedCard.id, scheduledAt)}
            onMove={(to) => handleQuickMove(selectedCard.id, to)}
            onDelete={() => {
              mutate((prev) => deleteCard(prev, selectedCard.id));
              setSelectedCardId(null);
            }}
            onDispatch={() => void handleDispatch()}
            onCancel={() => void window.api.cancelDispatch(selectedCard.id)}
            onCreateChatSession={(name) => {
              const id = uid();
              mutate((prev) => addChatSession(prev, name, selectedCard.config.agentId, id));
              return id;
            }}
            onClose={() => setSelectedCardId(null)}
          />
        ) : null}
      </main>

      {newTaskColumnId ? (
        <NewTaskModal
          board={board}
          columnId={newTaskColumnId}
          discovery={discovery}
          settings={settings}
          onCancel={() => setNewTaskColumnId(null)}
          onCreate={handleCreateTask}
        />
      ) : null}

      {settingsTab ? (
        <SettingsModal
          initialTab={settingsTab}
          settings={settings}
          discovery={discovery}
          onClose={() => setSettingsTab(null)}
          onSaveEndpoints={async (endpoints: EndpointSettings) => {
            setSettings(await window.api.setEndpoints(endpoints));
          }}
          onSaveSecret={async (key: SecretKey, value: string) => {
            setSettings(await window.api.setSecret(key, value));
          }}
          onClearSecret={async (key: SecretKey) => {
            setSettings(await window.api.clearSecret(key));
          }}
          onTestAgent={(agentId) => window.api.testAgent(agentId)}
          onRefreshDiscovery={refreshDiscovery}
          onRefreshCatalog={async () => {
            setDiscovery(await window.api.refreshCatalog());
          }}
          onSetProviderDefault={async (providerId, value) => {
            setSettings(await window.api.setProviderDefault(providerId, value));
          }}
          onSaveJudge={async (judge: JudgeSettings) => {
            setSettings(await window.api.setJudge(judge));
          }}
        />
      ) : null}
    </div>
  );
}
