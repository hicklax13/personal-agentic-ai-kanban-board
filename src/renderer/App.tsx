import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  BoardState,
  Card,
  CardAgentConfig,
  DiscoveryReport,
  EndpointSettings,
  RendererApi,
  SecretKey,
} from '@shared/types';
import {
  addCard,
  addChatSession,
  addColumn,
  deleteCard,
  deleteColumn,
  findCard,
  moveCard,
  updateCard,
  updateCardConfig,
  updateColumn,
  upsertRun,
} from '@shared/boardOps';
import Board from './components/Board.js';
import CardDetail from './components/CardDetail.js';
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
  const [scanning, setScanning] = useState(true);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ kind: 'err' | 'info'; text: string } | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardRef = useRef<BoardState | null>(null);
  boardRef.current = board;

  // --------------------------------------------------------------- startup
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [loaded, initialSettings] = await Promise.all([
        window.api.loadBoard(),
        window.api.getSettings(),
      ]);
      if (cancelled) return;
      setBoard(loaded);
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
        return next;
      });

      // The main process already persisted this update, so no save is scheduled
      // here — doing so would race the writer that owns run history.
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

  // --------------------------------------------------------------- saving
  const scheduleSave = useCallback((next: BoardState) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void window.api.saveBoard(next).then((res) => {
        if (!res.ok) setToast({ kind: 'err', text: `Could not save the board: ${res.error}` });
      });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  /** Apply a pure board operation and persist the result. */
  const mutate = useCallback(
    (fn: (prev: BoardState) => BoardState) => {
      setBoard((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        scheduleSave(next);
        return next;
      });
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
        void window.api.saveBoard(boardRef.current);
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

  const agentsById = useMemo(
    () => new Map((discovery?.agents ?? []).map((a) => [a.id, a])),
    [discovery],
  );

  /**
   * Apply an operation and hand back the entity it created.
   *
   * Reading a new id out of a `setState` updater is unreliable: React may defer
   * or double-invoke the updater, so the value is either stale or from a run
   * that got discarded. Computing the next state from the ref first means the
   * id is real before anything is scheduled.
   */
  const mutateAndRead = useCallback(
    <T,>(fn: (prev: BoardState) => BoardState, read: (next: BoardState) => T): T | null => {
      const prev = boardRef.current;
      if (!prev) return null;
      const next = fn(prev);
      boardRef.current = next;
      setBoard(next);
      scheduleSave(next);
      return read(next);
    },
    [scheduleSave],
  );

  const handleAddCard = (columnId: string): void => {
    const createdId = mutateAndRead(
      (prev) => addCard(prev, columnId, { title: 'New task' }),
      (next) => next.cards[next.cards.length - 1].id,
    );
    // Select it straight away: the point of adding a card is to configure it.
    if (createdId) setSelectedCardId(createdId);
  };

  const handleDispatch = async (): Promise<void> => {
    if (!selectedCard || !board) return;
    setToast(null);
    setRunning((prev) => new Set(prev).add(selectedCard.id));

    const res = await window.api.startDispatch({
      cardId: selectedCard.id,
      card: selectedCard,
      workspaceRoot: board.workspaceRoot,
    });

    if (!res.ok && res.error) {
      setToast({ kind: 'err', text: res.error });
    }
    setRunning((prev) => {
      const next = new Set(prev);
      next.delete(selectedCard.id);
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
        {running.size > 0 ? (
          <span className="chip st-running pulsing">{running.size} running</span>
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
          <button
            type="button"
            className="ghost"
            style={{ float: 'right' }}
            onClick={() => setToast(null)}
          >
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
          onMoveCard={(cardId, columnId, index) =>
            mutate((prev) => moveCard(prev, cardId, columnId, index))
          }
          onAddCard={handleAddCard}
          onAddColumn={() => mutate((prev) => addColumn(prev, 'New column'))}
          onRenameColumn={(columnId, title) =>
            mutate((prev) => updateColumn(prev, columnId, { title }))
          }
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
            discovery={discovery}
            chatSessions={board.chatSessions}
            workspaceRoot={board.workspaceRoot}
            isRunning={running.has(selectedCard.id)}
            onPatchCard={(patch) => mutate((prev) => updateCard(prev, selectedCard.id, patch))}
            onPatchConfig={(patch: Partial<CardAgentConfig>) =>
              mutate((prev) => updateCardConfig(prev, selectedCard.id, patch))
            }
            onDelete={() => {
              if (!window.confirm('Delete this card and its run history?')) return;
              mutate((prev) => deleteCard(prev, selectedCard.id));
              setSelectedCardId(null);
            }}
            onDispatch={() => void handleDispatch()}
            onCancel={() => void window.api.cancelDispatch(selectedCard.id)}
            onCreateChatSession={(name) =>
              mutateAndRead(
                (prev) => addChatSession(prev, name, selectedCard.config.agentId),
                (next) => next.chatSessions[next.chatSessions.length - 1].id,
              ) ?? ''
            }
            onClose={() => setSelectedCardId(null)}
          />
        ) : null}
      </div>

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
        />
      ) : null}
    </div>
  );
}
