import * as http from 'http';
import * as vscode from 'vscode';
import { z } from 'zod';

import type { ChatLog } from './chatLog.js';
import { MCP_DEFAULT_PORT, MCP_SERVER_NAME, MCP_SERVER_VERSION } from './constants.js';
import type { CopilotDetector } from './copilotDetector.js';
import { removeMcpConfig, writeMcpConfig } from './mcpConfig.js';
import { TelegramBot } from './telegramBot.js';

// Use `any` for the MCP server instance because the SDK has dual CJS/ESM type declarations
// that cause assignment issues under Node16 module resolution.

type McpServerInstance = any;

interface AgentMessage {
  from: string;
  fromId?: string;
  message: string;
  timestamp: number;
}

export interface Quest {
  id: string;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'done' | 'failed';
  createdBy: string;
  assignedTo?: string;
  notes?: string[];
  createdAt: number;
  updatedAt?: number;
}

/**
 * MCP Server embedded in the VS Code extension.
 *
 * Provides tools that GitHub Copilot (or any MCP client) can invoke:
 * - ask_user: Send a question to Telegram and wait for a reply
 * - notify_user: Send a one-way notification to Telegram
 * - report_activity: Report agent activity to the pixel office visualization
 * - report_idle: Report agent is idle/waiting
 *
 * Transport: Streamable HTTP on a configurable port.
 */
export class PixelAgentsMcpServer implements vscode.Disposable {
  private server: McpServerInstance | null = null;
  private httpServer: http.Server | null = null;
  private telegramBot: TelegramBot | null = null;
  private copilotDetector: CopilotDetector | null = null;
  private chatLog: ChatLog | null = null;
  private port: number;

  // Agent registration: each register_agent call creates a unique agent
  private registeredAgents = new Map<string, string>(); // agentId → agentName
  private nextRegisteredId = 1;

  // Agent-to-agent message queues
  private agentMessageQueues = new Map<string, AgentMessage[]>();

  // Quest board
  private quests = new Map<string, Quest>();
  private nextQuestId = 1;

  // Callback when a new agent registers
  onAgentRegistered?: (agentId: string, agentName: string) => void;
  // Callback when an agent unregisters
  onAgentUnregistered?: (agentId: string, agentName: string) => void;

  // Callbacks for subagent events (set by extension.ts)
  onSubagentActivity?: (
    parentId: number,
    toolId: string,
    subagentName: string,
    toolName: string,
    status: string,
  ) => void;
  onSubagentDone?: (parentId: number, toolId: string) => void;

  // Callback when quest board changes (set by extension.ts)
  onQuestChanged?: (quests: Quest[]) => void;

  constructor(private readonly outputChannel: vscode.OutputChannel) {
    const config = vscode.workspace.getConfiguration('pixelAgents');
    this.port = config.get<number>('mcp.port', MCP_DEFAULT_PORT);
  }

  setCopilotDetector(detector: CopilotDetector): void {
    this.copilotDetector = detector;
  }

  setChatLog(log: ChatLog): void {
    this.chatLog = log;
  }

  /**
   * Get all quests as an array (for webview sync).
   */
  getQuestList(): Quest[] {
    return [...this.quests.values()];
  }

  /**
   * Resolve the effective agent name from an agent_id.
   * If agent_id is provided and registered, use that agent's name.
   * Otherwise, fall back to the provided agent_name.
   */
  private resolveAgentName(agentId?: string, fallbackName?: string): string {
    if (agentId && this.registeredAgents.has(agentId)) {
      return this.registeredAgents.get(agentId)!;
    }
    return fallbackName || 'Copilot';
  }

  async start(): Promise<void> {
    this.refreshTelegramBot();

    // Dynamic imports for the MCP SDK (ESM-compatible)
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');

    this.server = new McpServer(
      { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      { capabilities: { logging: {} } },
    );

    this.registerTools();
    await this.startHttpTransport();

    this.outputChannel.appendLine(`[MCP] Server started on port ${this.port}`);
    vscode.window.showInformationMessage(`Pixel Agents MCP server running on port ${this.port}`);

    // Write MCP config for CLI discovery
    writeMcpConfig(this.port);
  }

  /**
   * Refresh the Telegram bot instance from current VS Code settings.
   * Called at start and before each Telegram tool call to pick up config changes.
   */
  private refreshTelegramBot(): TelegramBot | null {
    const config = vscode.workspace.getConfiguration('pixelAgents');
    const botToken = config.get<string>('telegram.botToken', '');
    const chatId = config.get<string>('telegram.chatId', '');

    if (botToken && chatId) {
      // Only recreate if settings changed
      if (!this.telegramBot) {
        this.telegramBot = new TelegramBot(botToken, chatId);
        this.outputChannel.appendLine('[MCP] Telegram bot configured');
      }
      return this.telegramBot;
    }

    this.outputChannel.appendLine('[MCP] Telegram not configured — bot token or chat ID missing');
    return null;
  }

  private registerTools(): void {
    if (!this.server) return;
    const srv = this.server;

    // ── register_agent: Create a new unique agent ────────────────
    srv.tool(
      'register_agent',
      'Register a new agent in the Pixel Agents office. Call this FIRST before any other reporting tools. Returns your unique agent_id that you must use in all subsequent tool calls. Each chat session should register its own agent.',
      {
        agent_name: z
          .string()
          .optional()
          .describe('Display name for this agent (default: "Copilot")'),
      },
      async ({ agent_name }: { agent_name?: string }) => {
        const baseName = agent_name || 'Copilot';
        const agentId = `agent-${this.nextRegisteredId++}`;

        // Generate unique display name
        const usedNames = new Set(this.registeredAgents.values());
        let displayName = baseName;
        if (usedNames.has(displayName)) {
          let counter = 2;
          while (usedNames.has(`${baseName} #${counter}`)) counter++;
          displayName = `${baseName} #${counter}`;
        }

        this.registeredAgents.set(agentId, displayName);
        this.outputChannel.appendLine(`[MCP] Agent registered: ${agentId} → "${displayName}"`);

        // Create the agent character in the office
        if (this.copilotDetector) {
          this.copilotDetector.reportMcpActivity(displayName, 'register', 'Joining office');
        }
        this.onAgentRegistered?.(agentId, displayName);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Agent registered. Your agent_id is "${agentId}" and display name is "${displayName}". Use this agent_id in all subsequent tool calls.`,
            },
          ],
        };
      },
    );

    // ── unregister_agent: Remove an agent ────────────────────────
    srv.tool(
      'unregister_agent',
      'Unregister an agent from the Pixel Agents office. Call this when your chat session is ending.',
      {
        agent_id: z.string().describe('Your agent_id from register_agent'),
      },
      async ({ agent_id }: { agent_id: string }) => {
        const name = this.registeredAgents.get(agent_id);
        if (!name) {
          return {
            content: [{ type: 'text' as const, text: 'Unknown agent_id.' }],
            isError: true,
          };
        }
        this.registeredAgents.delete(agent_id);
        if (this.copilotDetector) {
          this.copilotDetector.reportMcpIdle(name);
        }
        this.onAgentUnregistered?.(agent_id, name);
        return {
          content: [{ type: 'text' as const, text: 'Agent unregistered.' }],
        };
      },
    );

    // ── ask_user: Send question to Telegram, wait for reply ──────
    srv.tool(
      'ask_user',
      'Send a question to the user via Telegram and wait for their reply. Returns a request_id. If the reply arrives quickly, it is returned directly. Otherwise, use get_user_reply to poll for the response. Supports sending an image alongside the question.',
      {
        message: z.string().describe('The question or message to send to the user'),
        timeout_seconds: z
          .number()
          .optional()
          .describe('Max seconds to wait for reply (0 or omit for no limit)'),
        image_url: z
          .string()
          .optional()
          .describe(
            'Optional HTTP URL of an image to send alongside the question. Telegram will fetch the image from this URL.',
          ),
      },
      async ({
        message,
        timeout_seconds,
        image_url,
      }: {
        message: string;
        timeout_seconds?: number;
        image_url?: string;
      }) => {
        const bot = this.refreshTelegramBot();
        if (!bot) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Telegram bot not configured. Set pixelAgents.telegram.botToken and pixelAgents.telegram.chatId in VS Code settings.',
              },
            ],
            isError: true,
          };
        }
        try {
          const timeoutMs = timeout_seconds ? timeout_seconds * 1000 : 0;

          // Log the outgoing question
          this.chatLog?.addEntry({
            agentName: 'Agent',
            type: 'ask_user',
            message,
          });

          // Send question and get request ID (non-blocking)
          const requestId = await bot.sendQuestion(message, timeoutMs, image_url);

          // Wait briefly (up to 15 seconds) for an immediate reply to avoid unnecessary polling
          const reply = await bot.getReply(requestId, 15000);

          if (reply) {
            // Reply arrived quickly — return it directly
            this.chatLog?.addEntry({
              agentName: 'User',
              type: 'user_reply',
              message: reply.text || '[Photo]',
              imageBase64: reply.image?.data,
              imageMimeType: reply.image?.mimeType,
            });

            const content: Array<
              { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
            > = [];

            if (reply.text) {
              content.push({ type: 'text' as const, text: reply.text });
            }
            if (reply.image) {
              content.push({
                type: 'image' as const,
                data: reply.image.data,
                mimeType: reply.image.mimeType,
              });
              if (!reply.text) {
                content.push({ type: 'text' as const, text: '[User sent a photo]' });
              }
            }
            if (content.length === 0) {
              content.push({ type: 'text' as const, text: '[Empty reply]' });
            }
            return { content };
          }

          // Reply not yet received — return request_id for polling
          return {
            content: [
              {
                type: 'text' as const,
                text: `Message sent. Reply not yet received. Use get_user_reply with request_id "${requestId}" to check for responses. You can continue working while waiting.`,
              },
            ],
          };
        } catch (e) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    // ── get_user_reply: Poll for async Telegram reply ────────────
    srv.tool(
      'get_user_reply',
      'Check for a reply to a previously sent ask_user question. Returns the user reply if available, or indicates still waiting. Use this after ask_user returns a request_id without an immediate reply.',
      {
        request_id: z.string().describe('The request_id returned by ask_user'),
        wait_seconds: z
          .number()
          .optional()
          .describe('Seconds to wait for a reply before returning (default: 10, max: 25)'),
      },
      async ({ request_id, wait_seconds }: { request_id: string; wait_seconds?: number }) => {
        const bot = this.refreshTelegramBot();
        if (!bot) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Telegram bot not configured.',
              },
            ],
            isError: true,
          };
        }

        const waitMs = Math.min((wait_seconds || 10) * 1000, 25000);

        if (!bot.hasPendingRequest(request_id)) {
          // Check if already resolved
          const reply = await bot.getReply(request_id, 0);
          if (reply) {
            this.chatLog?.addEntry({
              agentName: 'User',
              type: 'user_reply',
              message: reply.text || '[Photo]',
              imageBase64: reply.image?.data,
              imageMimeType: reply.image?.mimeType,
            });

            const content: Array<
              { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
            > = [];
            if (reply.text) content.push({ type: 'text' as const, text: reply.text });
            if (reply.image) {
              content.push({
                type: 'image' as const,
                data: reply.image.data,
                mimeType: reply.image.mimeType,
              });
            }
            if (content.length === 0) {
              content.push({ type: 'text' as const, text: '[Empty reply]' });
            }
            return { content };
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: `Request "${request_id}" not found or already completed.`,
              },
            ],
          };
        }

        const reply = await bot.getReply(request_id, waitMs);
        if (reply) {
          this.chatLog?.addEntry({
            agentName: 'User',
            type: 'user_reply',
            message: reply.text || '[Photo]',
            imageBase64: reply.image?.data,
            imageMimeType: reply.image?.mimeType,
          });

          const content: Array<
            { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
          > = [];
          if (reply.text) content.push({ type: 'text' as const, text: reply.text });
          if (reply.image) {
            content.push({
              type: 'image' as const,
              data: reply.image.data,
              mimeType: reply.image.mimeType,
            });
          }
          if (content.length === 0) {
            content.push({ type: 'text' as const, text: '[Empty reply]' });
          }
          return { content };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Still waiting for user reply. Call get_user_reply again with request_id "${request_id}" to check. You can continue working while waiting.`,
            },
          ],
        };
      },
    );

    // ── notify_user: One-way notification to Telegram ────────────
    srv.tool(
      'notify_user',
      'Send a one-way notification to the user via Telegram. Does not wait for a reply. Supports sending an image alongside the notification.',
      {
        message: z.string().describe('The notification message to send'),
        image_url: z
          .string()
          .optional()
          .describe(
            'Optional HTTP URL of an image to send alongside the notification. Telegram will fetch the image from this URL.',
          ),
      },
      async ({ message, image_url }: { message: string; image_url?: string }) => {
        const bot = this.refreshTelegramBot();
        if (!bot) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Telegram bot not configured.',
              },
            ],
            isError: true,
          };
        }
        try {
          await bot.notifyUser(message, image_url);

          // Log the notification
          this.chatLog?.addEntry({
            agentName: 'Agent',
            type: 'notify_user',
            message,
          });

          return {
            content: [{ type: 'text' as const, text: 'Notification sent successfully.' }],
          };
        } catch (e) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    // ── report_activity: Agent reports what it's doing ───────────
    srv.tool(
      'report_activity',
      'Report current agent activity to the Pixel Agents office visualization. Call this when starting a new tool/action so the user can see your character animate.',
      {
        agent_id: z
          .string()
          .optional()
          .describe('Your agent_id from register_agent (recommended for multi-agent support)'),
        agent_name: z
          .string()
          .optional()
          .describe('Display name for this agent (fallback if agent_id not provided)'),
        tool_name: z
          .string()
          .describe(
            'Name of the tool/action being performed (e.g., "edit_file", "search", "run_command")',
          ),
        status: z
          .string()
          .describe(
            'Human-readable status text (e.g., "Editing main.ts", "Searching for references")',
          ),
      },
      async ({
        agent_id,
        agent_name,
        tool_name,
        status,
      }: {
        agent_id?: string;
        agent_name?: string;
        tool_name: string;
        status: string;
      }) => {
        const effectiveName = this.resolveAgentName(agent_id, agent_name);
        if (this.copilotDetector) {
          this.copilotDetector.reportMcpActivity(effectiveName, tool_name, status);
        }
        return {
          content: [{ type: 'text' as const, text: `Activity reported as "${effectiveName}".` }],
        };
      },
    );

    // ── report_idle: Agent reports it's done / waiting ───────────
    srv.tool(
      'report_idle',
      'Report that the agent has finished its current task and is idle or waiting. Call this when you complete a task or are waiting for input.',
      {
        agent_id: z.string().optional().describe('Your agent_id from register_agent'),
        agent_name: z
          .string()
          .optional()
          .describe('Display name for this agent (fallback if agent_id not provided)'),
      },
      async ({ agent_id, agent_name }: { agent_id?: string; agent_name?: string }) => {
        const effectiveName = this.resolveAgentName(agent_id, agent_name);
        if (this.copilotDetector) {
          this.copilotDetector.reportMcpIdle(effectiveName);
        }
        return {
          content: [{ type: 'text' as const, text: 'Idle state reported.' }],
        };
      },
    );

    // ── report_subagent_activity: Spawn a subagent character ─────
    srv.tool(
      'report_subagent_activity',
      'Report that a sub-agent (sub-task) has started working under a parent agent. This spawns a new pixel character near the parent agent. Use this when you delegate work to a sub-agent or start a parallel task.',
      {
        agent_id: z.string().optional().describe('Your agent_id from register_agent'),
        parent_agent_name: z
          .string()
          .optional()
          .describe('Display name of the parent agent (fallback if agent_id not provided)'),
        subagent_name: z
          .string()
          .describe('Display name for the subagent (e.g., "Search Agent", "Test Runner")'),
        tool_name: z.string().describe('Name of the tool/action the subagent is performing'),
        status: z
          .string()
          .describe('Human-readable status (e.g., "Running tests", "Searching codebase")'),
      },
      async ({
        agent_id,
        parent_agent_name,
        subagent_name,
        tool_name,
        status,
      }: {
        agent_id?: string;
        parent_agent_name?: string;
        subagent_name: string;
        tool_name: string;
        status: string;
      }) => {
        const effectiveParent = this.resolveAgentName(agent_id, parent_agent_name);
        if (this.copilotDetector) {
          const result = this.copilotDetector.reportSubagentActivity(
            effectiveParent,
            subagent_name,
            tool_name,
            status,
          );
          if (result && this.onSubagentActivity) {
            this.onSubagentActivity(
              result.parentId,
              result.toolId,
              subagent_name,
              tool_name,
              status,
            );
          }
        }
        return {
          content: [{ type: 'text' as const, text: 'Subagent activity reported.' }],
        };
      },
    );

    // ── report_subagent_done: Remove a subagent character ────────
    srv.tool(
      'report_subagent_done',
      'Report that a sub-agent (sub-task) has finished its work. This removes the subagent pixel character from the office.',
      {
        agent_id: z.string().optional().describe('Your agent_id from register_agent'),
        parent_agent_name: z
          .string()
          .optional()
          .describe('Display name of the parent agent (fallback if agent_id not provided)'),
        subagent_name: z.string().describe('Display name of the subagent that finished'),
      },
      async ({
        agent_id,
        parent_agent_name,
        subagent_name,
      }: {
        agent_id?: string;
        parent_agent_name?: string;
        subagent_name: string;
      }) => {
        const effectiveParent = this.resolveAgentName(agent_id, parent_agent_name);
        if (this.copilotDetector) {
          const parentId = this.copilotDetector.getParentAgentId(effectiveParent);
          const toolId = `copilot-sub-${subagent_name}`;
          if (parentId !== null && this.onSubagentDone) {
            this.onSubagentDone(parentId, toolId);
          }
        }
        return {
          content: [{ type: 'text' as const, text: 'Subagent completion reported.' }],
        };
      },
    );

    // ── message_agent: Agent-to-agent messaging ──────────────────
    srv.tool(
      'message_agent',
      'Send a message to another agent. The message is logged in the chat log and forwarded to the target agent. Use this for agent-to-agent coordination.',
      {
        agent_id: z.string().optional().describe('Your agent_id (sender)'),
        target_agent_id: z.string().describe('The agent_id of the target agent to message'),
        message: z.string().describe('The message to send to the target agent'),
      },
      async ({
        agent_id,
        target_agent_id,
        message,
      }: {
        agent_id?: string;
        target_agent_id: string;
        message: string;
      }) => {
        const senderName = this.resolveAgentName(agent_id);
        const targetName = this.registeredAgents.get(target_agent_id);
        if (!targetName) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Target agent "${target_agent_id}" not found. Available agents: ${[...this.registeredAgents.entries()].map(([id, name]) => `${id} (${name})`).join(', ') || 'none'}`,
              },
            ],
            isError: true,
          };
        }

        // Log the agent-to-agent message
        this.chatLog?.addEntry({
          agentId: agent_id,
          agentName: senderName,
          type: 'agent_message',
          message,
          targetAgentId: target_agent_id,
          targetAgentName: targetName,
        });

        // Queue the message for the target agent
        if (!this.agentMessageQueues.has(target_agent_id)) {
          this.agentMessageQueues.set(target_agent_id, []);
        }
        this.agentMessageQueues.get(target_agent_id)!.push({
          from: senderName,
          fromId: agent_id,
          message,
          timestamp: Date.now(),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `Message sent to "${targetName}" (${target_agent_id}).`,
            },
          ],
        };
      },
    );

    // ── check_messages: Receive messages from other agents ───────
    srv.tool(
      'check_messages',
      'Check for messages from other agents. Returns all unread messages and clears the queue. Call this periodically to receive agent-to-agent communications.',
      {
        agent_id: z.string().describe('Your agent_id to check messages for'),
      },
      async ({ agent_id }: { agent_id: string }) => {
        const messages = this.agentMessageQueues.get(agent_id) || [];
        this.agentMessageQueues.set(agent_id, []); // Clear queue

        if (messages.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No new messages.' }],
          };
        }

        const formatted = messages
          .map((m) => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.from}: ${m.message}`)
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `${messages.length} new message(s):\n${formatted}`,
            },
          ],
        };
      },
    );

    // ── list_agents: List all registered agents ──────────────────
    srv.tool(
      'list_agents',
      'List all currently registered agents in the Pixel Agents office. Useful for finding agent_ids for agent-to-agent messaging.',
      {},
      async () => {
        if (this.registeredAgents.size === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No agents currently registered.' }],
          };
        }
        const list = [...this.registeredAgents.entries()]
          .map(([id, name]) => `- ${name} (${id})`)
          .join('\n');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Registered agents:\n${list}`,
            },
          ],
        };
      },
    );

    // ── add_quest: Add a quest to the quest board ────────────────
    srv.tool(
      'add_quest',
      'Add a new quest/task to the Pixel Agents quest board. Quests are displayed on the whiteboard in the office.',
      {
        agent_id: z.string().optional().describe('Your agent_id (quest creator)'),
        title: z.string().describe('Short quest title (e.g., "Fix login bug")'),
        description: z.string().optional().describe('Detailed quest description'),
        priority: z
          .enum(['low', 'medium', 'high', 'critical'])
          .optional()
          .describe('Quest priority level (default: medium)'),
        assigned_to: z.string().optional().describe('Agent ID to assign this quest to'),
      },
      async ({
        agent_id,
        title,
        description,
        priority,
        assigned_to,
      }: {
        agent_id?: string;
        title: string;
        description?: string;
        priority?: 'low' | 'medium' | 'high' | 'critical';
        assigned_to?: string;
      }) => {
        const questId = `quest-${this.nextQuestId++}`;
        const creatorName = this.resolveAgentName(agent_id);
        const assigneeName = assigned_to ? this.resolveAgentName(assigned_to) : undefined;

        const quest: Quest = {
          id: questId,
          title,
          description,
          priority: priority || 'medium',
          status: 'open',
          createdBy: creatorName,
          assignedTo: assigneeName,
          createdAt: Date.now(),
        };

        this.quests.set(questId, quest);

        // Log to chat
        this.chatLog?.addEntry({
          agentId: agent_id,
          agentName: creatorName,
          type: 'system',
          message: `📋 New quest: "${title}" [${quest.priority}]${assigneeName ? ` → assigned to ${assigneeName}` : ''}`,
        });

        // Notify webview
        this.onQuestChanged?.(this.getQuestList());

        return {
          content: [
            {
              type: 'text' as const,
              text: `Quest created: "${title}" (${questId})`,
            },
          ],
        };
      },
    );

    // ── update_quest: Update a quest's status ────────────────────
    srv.tool(
      'update_quest',
      'Update the status of an existing quest on the quest board.',
      {
        quest_id: z.string().describe('The quest ID to update'),
        status: z
          .enum(['open', 'in_progress', 'done', 'failed'])
          .optional()
          .describe('New status for the quest'),
        assigned_to: z.string().optional().describe('Agent ID to reassign the quest to'),
        note: z.string().optional().describe('A note or progress update for the quest'),
      },
      async ({
        quest_id,
        status,
        assigned_to,
        note,
      }: {
        quest_id: string;
        status?: 'open' | 'in_progress' | 'done' | 'failed';
        assigned_to?: string;
        note?: string;
      }) => {
        const quest = this.quests.get(quest_id);
        if (!quest) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Quest "${quest_id}" not found.`,
              },
            ],
            isError: true,
          };
        }

        if (status) quest.status = status;
        if (assigned_to) quest.assignedTo = this.resolveAgentName(assigned_to);
        if (note) quest.notes = [...(quest.notes || []), note];
        quest.updatedAt = Date.now();

        // Log to chat
        const changes: string[] = [];
        if (status) changes.push(`status → ${status}`);
        if (assigned_to) changes.push(`assigned → ${quest.assignedTo}`);
        if (note) changes.push(`note: "${note}"`);

        this.chatLog?.addEntry({
          agentName: 'System',
          type: 'system',
          message: `📋 Quest "${quest.title}" updated: ${changes.join(', ')}`,
        });

        // Notify webview
        this.onQuestChanged?.(this.getQuestList());

        return {
          content: [
            {
              type: 'text' as const,
              text: `Quest "${quest.title}" updated: ${changes.join(', ')}`,
            },
          ],
        };
      },
    );

    // ── list_quests: View all quests ─────────────────────────────
    srv.tool(
      'list_quests',
      'List all quests on the quest board. Returns all quests with their status, priority, and assignee.',
      {
        status_filter: z
          .enum(['open', 'in_progress', 'done', 'failed', 'all'])
          .optional()
          .describe('Filter quests by status (default: all)'),
      },
      async ({ status_filter }: { status_filter?: string }) => {
        let quests = this.getQuestList();
        if (status_filter && status_filter !== 'all') {
          quests = quests.filter((q) => q.status === status_filter);
        }

        if (quests.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No quests found.' }],
          };
        }

        const formatted = quests
          .map((q) => {
            const parts = [`[${q.priority?.toUpperCase()}]`, `${q.title}`, `(${q.status})`];
            if (q.assignedTo) parts.push(`→ ${q.assignedTo}`);
            if (q.notes?.length) parts.push(`| ${q.notes[q.notes.length - 1]}`);
            return `- ${q.id}: ${parts.join(' ')}`;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Quest board (${quests.length} quests):\n${formatted}`,
            },
          ],
        };
      },
    );

    // ── get_chat_log: Retrieve chat history ──────────────────────
    srv.tool(
      'get_chat_log',
      'Retrieve the agent chat log history. Shows all ask_user questions, user replies, notifications, and agent-to-agent messages.',
      {
        last_n: z.number().optional().describe('Number of recent entries to return (default: 20)'),
      },
      async ({ last_n }: { last_n?: number }) => {
        if (!this.chatLog) {
          return {
            content: [{ type: 'text' as const, text: 'Chat log not available.' }],
          };
        }
        const entries = this.chatLog.getEntries();
        const count = last_n || 20;
        const recent = entries.slice(-count);

        if (recent.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'Chat log is empty.' }],
          };
        }

        const formatted = recent
          .map((e) => {
            const time = new Date(e.timestamp).toLocaleTimeString();
            const prefix =
              e.type === 'ask_user'
                ? '❓'
                : e.type === 'user_reply'
                  ? '💬'
                  : e.type === 'notify_user'
                    ? '📢'
                    : e.type === 'agent_message'
                      ? '🤝'
                      : 'ℹ️';
            let line = `[${time}] ${prefix} ${e.agentName}: ${e.message}`;
            if (e.targetAgentName) line += ` → ${e.targetAgentName}`;
            if (e.imageBase64) line += ' [📷 Image]';
            return line;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Chat log (last ${recent.length} entries):\n${formatted}`,
            },
          ],
        };
      },
    );

    this.outputChannel.appendLine(
      '[MCP] Tools registered: register_agent, unregister_agent, ask_user, get_user_reply, notify_user, report_activity, report_idle, report_subagent_activity, report_subagent_done, message_agent, check_messages, list_agents, add_quest, update_quest, list_quests, get_chat_log',
    );
  }

  private async startHttpTransport(): Promise<void> {
    if (!this.server) return;

    // Use the SSE transport for maximum compatibility with MCP clients
    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');

    // Track active sessions
    const sessions = new Map<string, InstanceType<typeof SSEServerTransport>>();

    this.httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);

      // CORS headers for local development
      res.setHeader('Access-Control-Allow-Origin', '127.0.0.1');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (url.pathname === '/sse' && req.method === 'GET') {
        // SSE endpoint — client connects here to establish the session
        const transport = new SSEServerTransport('/messages', res);
        sessions.set(transport.sessionId, transport);
        this.outputChannel.appendLine(`[MCP] New SSE session: ${transport.sessionId}`);

        transport.onclose = () => {
          sessions.delete(transport.sessionId);
          this.outputChannel.appendLine(`[MCP] SSE session closed: ${transport.sessionId}`);
        };

        await this.server!.connect(transport);
        // SSE connection stays open
        return;
      }

      if (url.pathname === '/messages' && req.method === 'POST') {
        // Message endpoint — client sends JSON-RPC messages here
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or missing sessionId' }));
          return;
        }
        const transport = sessions.get(sessionId)!;

        // Read request body
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            await transport.handlePostMessage(req, res, body);
          } catch {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
        return;
      }

      // Health check
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ status: 'ok', name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }),
        );
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.port, '127.0.0.1', () => {
        this.outputChannel.appendLine(`[MCP] HTTP server listening on 127.0.0.1:${this.port}`);
        resolve();
      });
      this.httpServer!.on('error', (err) => {
        this.outputChannel.appendLine(`[MCP] HTTP server error: ${err.message}`);
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    // Remove MCP config file
    removeMcpConfig();

    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer!.close(() => {
          this.outputChannel.appendLine('[MCP] HTTP server stopped');
          this.httpServer = null;
          resolve();
        });
      });
    }
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
    if (this.telegramBot) {
      this.telegramBot.dispose();
      this.telegramBot = null;
    }
  }

  isRunning(): boolean {
    return this.httpServer !== null;
  }

  getPort(): number {
    return this.port;
  }

  dispose(): void {
    this.stop().catch(console.error);
  }
}
