import * as vscode from 'vscode';

/**
 * Represents a single entry in the agent chat log.
 */
export interface ChatLogEntry {
  id: number;
  timestamp: number;
  agentId?: string;
  agentName: string;
  type: 'ask_user' | 'user_reply' | 'notify_user' | 'agent_message' | 'system';
  message: string;
  /** If the entry includes an image (e.g., user replied with a photo) */
  imageBase64?: string;
  imageMimeType?: string;
  /** For agent-to-agent messages: the target agent */
  targetAgentId?: string;
  targetAgentName?: string;
}

/**
 * Manages the chat log for all agent interactions.
 * Stores messages from ask_user, notify_user, agent-to-agent messaging,
 * and user replies. Sends updates to the webview.
 */
export class ChatLog implements vscode.Disposable {
  private entries: ChatLogEntry[] = [];
  private nextId = 1;
  private readonly maxEntries = 500;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<ChatLogEntry>();

  /** Fires whenever a new entry is added */
  readonly onDidChange = this.onDidChangeEmitter.event;

  /**
   * Add an entry to the chat log.
   */
  addEntry(entry: Omit<ChatLogEntry, 'id' | 'timestamp'>): ChatLogEntry {
    const full: ChatLogEntry = {
      ...entry,
      id: this.nextId++,
      timestamp: Date.now(),
    };
    this.entries.push(full);

    // Trim old entries if over limit
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    this.onDidChangeEmitter.fire(full);
    return full;
  }

  /**
   * Get all entries (optionally filtered by agent).
   */
  getEntries(agentId?: string): ChatLogEntry[] {
    if (agentId) {
      return this.entries.filter((e) => e.agentId === agentId || e.targetAgentId === agentId);
    }
    return [...this.entries];
  }

  /**
   * Get entries since a specific ID (for incremental updates to webview).
   */
  getEntriesSince(sinceId: number): ChatLogEntry[] {
    return this.entries.filter((e) => e.id > sinceId);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}
