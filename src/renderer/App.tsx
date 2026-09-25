import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  uid,
  updateCard,
  updateCardConfig,
  updateColumn,
  upsertRun,
} from '@shared/boardOps';
import { flowColumn, flowKeyOf, placeNewCard } from '@shared/flow';
import Board from './components/Board.js';
import CardDetail from './components/CardDetail.js';
import NewTaskModal, { type TaskDraft } from './components/NewTaskModal.js';
import SettingsModal from './components/SettingsModal.js';

declare global {
  interface Window {
    api: RendererApi;
  }
}

const SAVE_DEBOUNCE_MS = 400;

export default function App(): React.JSX.Element {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryReport | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [newTaskColumnId, setNewTaskColumnId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ kind: 'err' | 'info'; text: string } | null>(null);

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

  // ------------------------------------------------------------- handlers
  const selectedCard: Card | null = useMemo(
    () => (board && selectedCardId ? (findCard(board, selectedCardId) ?? null) : null),
    [board, selectedCardId],
  );

  const agentsById = useMemo(() => new Map((discovery?.agents ?? []).map((a) => [a.id, a])), [discovery]);

  const handleCreateTask = (draft: TaskDraft): void => {
    const current = boardRef.current;
    if (!current || !newTaskColumnId) return;
    // A future schedule waits in SCHEDULED and an unfinished parent in TODO,
    // whichever column "+ New task" was clicked in.
    const columnId = placeNewCard(current, newTaskColumnId, draft, new Date());
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

  // ---------------------------------------------------------------- render
  if (!board || !settings) {
    return <div className="empty-state">Loading board…</div>;
  }

  const availableAgents = (discovery?.agents ?? []).filter((a) => a.availability === 'available');
  const goalsRunning = board.cards.filter((c) => c.goal?.status === 'running' && !running.has(c.id)).length;

  return (
    <div className="app">
      <div className="topbar">
        <h1>{board.boardTitle}</h1>
        <span className="chip" title="Cards on this board">
          {board.cards.length} cards
        </span>
        {scanning ? (
          <span className="chip pulsing">scanning environment…</span>
        ) : (
          <span className="chip" title={discovery?.agents.map((a) => a.name).join(', ')}>
            <span className={`dot ${availableAgents.length > 0 ? 'available' : 'degraded'}`} />
            {availableAgents.length} of {discovery?.agents.length ?? 0} agents ready
          </span>
        )}
        {running.size + goalsRunning > 0 ? (
          <span className="chip st-running pulsing">{running.size + goalsRunning} running</span>
        ) : null}

        <span className="spacer" />

        <button type="button" onClick={() => void window.api.revealBoardFile()}>
          Show board file
        </button>
        <button type="button" onClick={() => setShowSettings(true)}>
          Settings
        </button>
      </div>

      {toast ? (
        <div className={`banner ${toast.kind}`} style={{ margin: '10px 14px 0' }}>
          {toast.text}
          <button type="button" className="ghost" style={{ float: 'right' }} onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      ) : null}

      <div className="main">
        <Board
          board={board}
          agentsById={agentsById}
          selectedCardId={selectedCardId}
          onSelectCard={setSelectedCardId}
          onMoveCard={(cardId, columnId, index) => mutate((prev) => moveCard(prev, cardId, columnId, index))}
          onAddCard={setNewTaskColumnId}
          onAddColumn={() => mutate((prev) => addColumn(prev, 'New column'))}
          onRenameColumn={(columnId, title) => mutate((prev) => updateColumn(prev, columnId, { title }))}
          onDeleteColumn={(columnId) => {
            const count = board.cards.filter((c) => c.columnId === columnId).length;
            const message =
              count > 0
                ? `Delete this column? Its ${count} card(s) will move to the first column.`
                : 'Delete this column?';
            if (window.confirm(message)) mutate((prev) => deleteColumn(prev, columnId));
          }}
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
            onDelete={() => {
              if (!window.confirm('Delete this card and its run history?')) return;
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
      </div>

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

      {showSettings ? (
        <SettingsModal
          settings={settings}
          discovery={discovery}
          onClose={() => setShowSettings(false)}
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
