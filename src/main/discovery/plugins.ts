import { promises as fs } from 'node:fs';
import type { DiscoveredPlugin } from '@shared/types';

/**
 * Turn a Claude Code settings object into the plugin list.
 *
 * Entries are keyed `name@marketplace` with a boolean value. Disabled plugins
 * are kept rather than filtered out so the card editor can show them greyed
 * out — hiding them entirely makes it look like the plugin is not installed.
 */
export function parseEnabledPlugins(settings: unknown): DiscoveredPlugin[] {
  if (!settings || typeof settings !== 'object') return [];
  const enabled = (settings as { enabledPlugins?: Record<string, boolean> }).enabledPlugins;
  if (!enabled || typeof enabled !== 'object') return [];

  return Object.entries(enabled)
    .map(([key, value]) => {
      const at = key.lastIndexOf('@');
      const name = at > 0 ? key.slice(0, at) : key;
      const marketplace = at > 0 ? key.slice(at + 1) : 'unknown';
      return { id: key, name, marketplace, enabled: Boolean(value) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function discoverPlugins(settingsPath: string): Promise<DiscoveredPlugin[]> {
  try {
    const text = await fs.readFile(settingsPath, 'utf8');
    return parseEnabledPlugins(JSON.parse(text) as unknown);
  } catch {
    // No settings file is a perfectly normal state (fresh Claude install).
    return [];
  }
}
