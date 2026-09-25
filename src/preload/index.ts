import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccountActionResult,
  AccountProvider,
  AccountSignInProgress,
  AccountStatus,
  AgentTestResult,
  AppSettings,
  BoardState,
  DiscoveryReport,
  DispatchRequest,
  EndpointSettings,
  RendererApi,
  RunUpdate,
  SecretKey,
} from '@shared/types';
import { IPC } from '@shared/types';

/**
 * The entire surface the renderer is allowed to touch.
 *
 * Every method is an explicit, typed call — the renderer never receives the
 * ipcRenderer object itself. That is what keeps a compromised page from
 * inventing its own channel names and reaching parts of the main process this
 * app never meant to expose. Note there is deliberately no `getSecret`:
 * credential values only ever travel from the renderer inward.
 */
const api: RendererApi = {
  loadBoard: () => ipcRenderer.invoke(IPC.boardLoad) as Promise<BoardState>,
  saveBoard: (state) =>
    ipcRenderer.invoke(IPC.boardSave, state) as Promise<{ ok: boolean; error?: string }>,
  revealBoardFile: () => ipcRenderer.invoke(IPC.boardReveal) as Promise<void>,

  getDiscovery: () => ipcRenderer.invoke(IPC.discoveryGet) as Promise<DiscoveryReport>,
  refreshDiscovery: () => ipcRenderer.invoke(IPC.discoveryRefresh) as Promise<DiscoveryReport>,

  getSettings: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<AppSettings>,
  setEndpoints: (endpoints: EndpointSettings) =>
    ipcRenderer.invoke(IPC.settingsSetEndpoints, endpoints) as Promise<AppSettings>,
  setSecret: (key: SecretKey, value: string) =>
    ipcRenderer.invoke(IPC.settingsSetSecret, key, value) as Promise<AppSettings>,
  clearSecret: (key: SecretKey) =>
    ipcRenderer.invoke(IPC.settingsClearSecret, key) as Promise<AppSettings>,
  testAgent: (agentId: string) =>
    ipcRenderer.invoke(IPC.settingsTestAgent, agentId) as Promise<AgentTestResult>,

  getAccounts: () => ipcRenderer.invoke(IPC.accountsStatus) as Promise<AccountStatus[]>,
  signIn: (provider: AccountProvider) =>
    ipcRenderer.invoke(IPC.accountsSignIn, provider) as Promise<AccountActionResult>,
  signOut: (provider: AccountProvider) =>
    ipcRenderer.invoke(IPC.accountsSignOut, provider) as Promise<AccountActionResult>,
  onSignInProgress: (cb) => {
    const listener = (_e: unknown, progress: AccountSignInProgress): void => cb(progress);
    ipcRenderer.on(IPC.accountsProgress, listener);
    return () => {
      ipcRenderer.removeListener(IPC.accountsProgress, listener);
    };
  },

  startDispatch: (req: DispatchRequest) =>
    ipcRenderer.invoke(IPC.dispatchStart, req) as Promise<{
      ok: boolean;
      runId?: string;
      error?: string;
    }>,
  cancelDispatch: (cardId: string) =>
    ipcRenderer.invoke(IPC.dispatchCancel, cardId) as Promise<{ ok: boolean }>,

  onRunUpdate: (cb) => {
    const listener = (_e: unknown, update: RunUpdate): void => cb(update);
    ipcRenderer.on(IPC.runUpdate, listener);
    // Returning the unsubscribe closure lets React clean up on unmount; without
    // it a hot reload would stack duplicate listeners and double-apply updates.
    return () => {
      ipcRenderer.removeListener(IPC.runUpdate, listener);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
