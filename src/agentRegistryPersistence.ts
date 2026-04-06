import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  AGENT_REGISTRY_FILE_NAME,
  AGENT_REGISTRY_POLL_INTERVAL_MS,
  AGENT_REGISTRY_STALE_MS,
  LAYOUT_FILE_DIR,
} from './constants.js';

/* ── Types ──────────────────────────────────────────────────── */

export interface RegisteredAgentEntry {
  id: number;
  palette: number;
  hueShift: number;
  seatId: string | null;
  isActive: boolean;
  currentTool: string | null;
  folderName?: string;
}

export interface WindowRegistryEntry {
  windowId: string;
  agents: RegisteredAgentEntry[];
  timestamp: number; // Last heartbeat (Date.now())
}

export interface AgentRegistry {
  windows: Record<string, WindowRegistryEntry>;
}

export interface RegistryWatcher {
  dispose(): void;
}

/* ── File path ──────────────────────────────────────────────── */

function getRegistryFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, AGENT_REGISTRY_FILE_NAME);
}

/* ── Read / Write ───────────────────────────────────────────── */

export function readRegistry(): AgentRegistry {
  const filePath = getRegistryFilePath();
  try {
    if (!fs.existsSync(filePath)) return { windows: {} };
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as AgentRegistry;
    if (!parsed.windows || typeof parsed.windows !== 'object') return { windows: {} };
    return parsed;
  } catch {
    return { windows: {} };
  }
}

function writeRegistry(registry: AgentRegistry): void {
  const filePath = getRegistryFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(registry, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Pixel Agents] Failed to write agent registry:', err);
  }
}

/* ── Update own window's agents ─────────────────────────────── */

export function updateRegistryEntry(windowId: string, agents: RegisteredAgentEntry[]): void {
  const registry = readRegistry();
  registry.windows[windowId] = {
    windowId,
    agents,
    timestamp: Date.now(),
  };
  // Prune stale windows
  const now = Date.now();
  for (const [wId, entry] of Object.entries(registry.windows)) {
    if (now - entry.timestamp > AGENT_REGISTRY_STALE_MS) {
      delete registry.windows[wId];
    }
  }
  writeRegistry(registry);
}

/* ── Remove own window from registry ────────────────────────── */

export function removeRegistryEntry(windowId: string): void {
  const registry = readRegistry();
  if (windowId in registry.windows) {
    delete registry.windows[windowId];
    writeRegistry(registry);
  }
}

/* ── Get remote agents (from other windows) ─────────────────── */

export function getRemoteAgents(
  ownWindowId: string,
): { windowId: string; agents: RegisteredAgentEntry[] }[] {
  const registry = readRegistry();
  const now = Date.now();
  const result: { windowId: string; agents: RegisteredAgentEntry[] }[] = [];

  for (const [wId, entry] of Object.entries(registry.windows)) {
    if (wId === ownWindowId) continue;
    // Skip stale entries
    if (now - entry.timestamp > AGENT_REGISTRY_STALE_MS) continue;
    if (entry.agents.length > 0) {
      result.push({ windowId: wId, agents: entry.agents });
    }
  }

  return result;
}

/* ── Heartbeat (keeps our entry fresh) ──────────────────────── */

export function heartbeatRegistry(windowId: string, agents: RegisteredAgentEntry[]): void {
  updateRegistryEntry(windowId, agents);
}

/* ── Watch for external changes ─────────────────────────────── */

export function watchAgentRegistry(
  ownWindowId: string,
  onRemoteChange: (remoteAgents: { windowId: string; agents: RegisteredAgentEntry[] }[]) => void,
): RegistryWatcher {
  const filePath = getRegistryFilePath();
  let disposed = false;
  let lastMtime = 0;
  let fsWatcher: fs.FSWatcher | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Initialize lastMtime
  try {
    if (fs.existsSync(filePath)) {
      lastMtime = fs.statSync(filePath).mtimeMs;
    }
  } catch {
    /* ignore */
  }

  function checkForChange(): void {
    if (disposed) return;
    try {
      if (!fs.existsSync(filePath)) return;
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs <= lastMtime) return;
      lastMtime = stat.mtimeMs;

      const remoteAgents = getRemoteAgents(ownWindowId);
      onRemoteChange(remoteAgents);
    } catch {
      /* ignore */
    }
  }

  function startFsWatch(): void {
    if (disposed || fsWatcher) return;
    try {
      if (!fs.existsSync(filePath)) return;
      fsWatcher = fs.watch(filePath, () => checkForChange());
      fsWatcher.on('error', () => {
        fsWatcher?.close();
        fsWatcher = null;
      });
    } catch {
      /* File may not exist yet */
    }
  }

  startFsWatch();

  pollTimer = setInterval(() => {
    if (disposed) return;
    if (!fsWatcher) startFsWatch();
    checkForChange();
  }, AGENT_REGISTRY_POLL_INTERVAL_MS);

  return {
    dispose(): void {
      disposed = true;
      fsWatcher?.close();
      fsWatcher = null;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },
  };
}
