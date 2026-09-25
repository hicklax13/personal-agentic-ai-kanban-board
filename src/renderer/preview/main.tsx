/**
 * Browser preview of the real renderer, driven by sample data instead of the
 * Electron bridge. Development only — see vite.preview.config.ts.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMockApi } from './mockApi.js';
import '../fonts.js';
import '../styles.css';

/** URL of the owner's private crest when it exists locally; injected by the preview config. */
declare const __PREVIEW_CREST__: string | null;

window.api = createMockApi(__PREVIEW_CREST__);

// Imported after the stand-in bridge is installed, exactly as the app would see it.
const { default: App } = await import('../App.js');

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing from preview.html');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
