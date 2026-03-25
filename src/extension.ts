import * as vscode from 'vscode';

import { ChatLog } from './chatLog.js';
import {
  COMMAND_EXPORT_DEFAULT_LAYOUT,
  COMMAND_SHOW_PANEL,
  COMMAND_START_MCP_SERVER,
  COMMAND_STOP_MCP_SERVER,
  COPILOT_TERMINAL_PREFIX_DEFAULT,
  MCP_DEFAULT_PORT,
  VIEW_ID,
} from './constants.js';
import { CopilotDetector } from './copilotDetector.js';
import { PixelAgentsMcpServer } from './mcpServer.js';
import { PixelAgentsViewProvider } from './PixelAgentsViewProvider.js';

let providerInstance: PixelAgentsViewProvider | undefined;
let mcpServerInstance: PixelAgentsMcpServer | undefined;
let copilotDetectorInstance: CopilotDetector | undefined;
let chatLogInstance: ChatLog | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let extensionContext: vscode.ExtensionContext | undefined;

const WORKSPACE_KEY_QUESTS = 'pixelAgents.quests';

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;

  outputChannel = vscode.window.createOutputChannel('Pixel Agents');
  context.subscriptions.push(outputChannel);

  // Create chat log early so ask_user (LM Tool) entries persist even without MCP server
  chatLogInstance = new ChatLog();
  chatLogInstance.setWorkspaceState(context.workspaceState);
  context.subscriptions.push(chatLogInstance);

  const provider = new PixelAgentsViewProvider(context);
  providerInstance = provider;

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider));

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_SHOW_PANEL, () => {
      vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_EXPORT_DEFAULT_LAYOUT, () => {
      provider.exportDefaultLayout();
    }),
  );

  // Wire webview submit response for ask_user → MCP server
  provider.onAskUserResponse = (response: string) => {
    if (mcpServerInstance?.submitAskUserResponse(response)) {
      outputChannel?.appendLine('[AskUser] Response submitted via webview → MCP');
    }
  };

  // Send persisted quests and chat entries when webview loads
  provider.onWebviewReady = () => {
    const webview = provider.webviewView?.webview;
    if (!webview) return;

    // Send persisted chat entries
    const chatEntries = chatLogInstance?.getEntries() ?? [];
    if (chatEntries.length > 0) {
      webview.postMessage({ type: 'chatLogBulk', entries: chatEntries });
      outputChannel?.appendLine(`[Webview] Sent ${chatEntries.length} persisted chat entries`);
    }

    // Send persisted quests
    const quests = context.workspaceState.get<import('./mcpServer.js').Quest[]>(
      WORKSPACE_KEY_QUESTS,
      [],
    );
    if (quests.length > 0) {
      webview.postMessage({ type: 'questBoardUpdate', quests });
      outputChannel?.appendLine(`[Webview] Sent ${quests.length} persisted quests`);
    }
  };

  // ── Copilot Detection ────────────────────────────────────
  const config = vscode.workspace.getConfiguration('pixelAgents');
  const agentMode = config.get<string>('agentMode', 'both');

  if (agentMode === 'copilot' || agentMode === 'both') {
    const terminalPrefix = config.get<string>(
      'copilotTerminalPrefix',
      COPILOT_TERMINAL_PREFIX_DEFAULT,
    );
    copilotDetectorInstance = new CopilotDetector(terminalPrefix, {
      onAgentActivity: (info) => {
        // Track Copilot agent in provider for persistence across webview reloads
        provider.addCopilotAgent(info.id, info.label);
        provider.webviewView?.webview.postMessage({
          type: 'agentCreated',
          id: info.id,
          folderName: info.label,
          agentType: 'copilot',
        });
        if (info.currentTool) {
          provider.webviewView?.webview.postMessage({
            type: 'agentToolStart',
            id: info.id,
            toolId: `copilot-${info.id}-${Date.now()}`,
            status: info.toolStatus || `Using ${info.currentTool}`,
          });
        }
      },
      onAgentIdle: (id) => {
        provider.webviewView?.webview.postMessage({
          type: 'agentStatus',
          id,
          status: 'waiting',
        });
      },
    });
    copilotDetectorInstance.start();
    context.subscriptions.push(copilotDetectorInstance);
    outputChannel.appendLine(`[Extension] Copilot detection started (prefix: "${terminalPrefix}")`);
  }

  // ── MCP Server Commands ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_START_MCP_SERVER, async () => {
      await startMcpServer();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_STOP_MCP_SERVER, async () => {
      if (!mcpServerInstance?.isRunning()) {
        vscode.window.showInformationMessage('Pixel Agents MCP server is not running.');
        return;
      }
      await mcpServerInstance.stop();
      vscode.window.showInformationMessage('Pixel Agents MCP server stopped.');
    }),
  );

  // ── Register MCP Server Definition Provider for Copilot ──
  // This lets VS Code Copilot discover our MCP server automatically
  registerMcpServerProvider(context);

  // Auto-start MCP server if configured
  if (config.get<boolean>('mcp.enabled', false)) {
    startMcpServer().catch((e) => {
      outputChannel!.appendLine(`[MCP] Auto-start failed: ${e}`);
    });
  }
}

async function startMcpServer(): Promise<void> {
  if (mcpServerInstance?.isRunning()) {
    vscode.window.showInformationMessage('Pixel Agents MCP server is already running.');
    return;
  }
  mcpServerInstance = new PixelAgentsMcpServer(outputChannel!);
  if (copilotDetectorInstance) {
    mcpServerInstance.setCopilotDetector(copilotDetectorInstance);
  }

  // Wire chat log (already created in activate())
  if (!chatLogInstance) {
    chatLogInstance = new ChatLog();
  }
  mcpServerInstance.setChatLog(chatLogInstance);

  // Restore persisted quests
  if (extensionContext) {
    const savedQuests = extensionContext.workspaceState.get<import('./mcpServer.js').Quest[]>(
      WORKSPACE_KEY_QUESTS,
      [],
    );
    if (savedQuests.length > 0) {
      mcpServerInstance.restoreQuests(savedQuests);
      outputChannel?.appendLine(`[MCP] Restored ${savedQuests.length} persisted quests`);
    }
  }

  // Forward chat log entries to webview
  chatLogInstance.onDidChange((entry) => {
    providerInstance?.webviewView?.webview.postMessage({
      type: 'chatLogEntry',
      entry,
    });
  });

  // Wire agent registration lifecycle
  mcpServerInstance.onAgentRegistered = (agentId, agentName) => {
    outputChannel?.appendLine(`[MCP] Agent registered: ${agentId} → "${agentName}"`);
  };

  mcpServerInstance.onAgentUnregistered = (agentId, agentName) => {
    outputChannel?.appendLine(`[MCP] Agent unregistered: ${agentId} → "${agentName}"`);
    // Find the agent by name and remove it from the provider
    if (copilotDetectorInstance && providerInstance) {
      const id = copilotDetectorInstance.getParentAgentId(agentName);
      if (id !== null) {
        providerInstance.removeCopilotAgent(id);
      }
    }
  };

  // Wire subagent events to the webview
  mcpServerInstance.onSubagentActivity = (parentId, toolId, subagentName, toolName, status) => {
    const webview = providerInstance?.webviewView?.webview;
    if (!webview) return;

    // First, trigger the subagent spawn via agentToolStart with "Subtask:" prefix
    webview.postMessage({
      type: 'agentToolStart',
      id: parentId,
      toolId,
      status: `Subtask: ${subagentName}`,
    });

    // Then report the subagent's own tool activity
    webview.postMessage({
      type: 'subagentToolStart',
      id: parentId,
      parentToolId: toolId,
      toolId: `${toolId}-${Date.now()}`,
      status: `${toolName}: ${status}`,
    });
  };

  mcpServerInstance.onSubagentDone = (parentId, toolId) => {
    const webview = providerInstance?.webviewView?.webview;
    if (!webview) return;

    webview.postMessage({
      type: 'subagentClear',
      id: parentId,
      parentToolId: toolId,
    });
  };

  // Wire quest board updates to the webview + persist
  mcpServerInstance.onQuestChanged = (quests) => {
    providerInstance?.webviewView?.webview.postMessage({
      type: 'questBoardUpdate',
      quests,
    });
    // Persist quests to workspaceState
    extensionContext?.workspaceState.update(WORKSPACE_KEY_QUESTS, quests);
  };

  // Wire MCP ask_user questions to the webview panel
  mcpServerInstance.onAskUserForWebview = (question: string) => {
    const id = `mcp-${Date.now()}`;
    providerInstance?.webviewView?.webview.postMessage({
      type: 'askUserQuestion',
      id,
      question,
    });
  };

  try {
    await mcpServerInstance.start();
  } catch (e) {
    vscode.window.showErrorMessage(
      `Failed to start MCP server: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Register our MCP server with VS Code's Copilot integration.
 * This makes Copilot automatically discover our tools (ask_user, notify_user, etc.)
 * via the `vscode.lm.registerMcpServerDefinitionProvider` API.
 */
function registerMcpServerProvider(context: vscode.ExtensionContext): void {
  try {
    // Check if the API is available (VS Code 1.99+)
    if (!vscode.lm || typeof vscode.lm.registerMcpServerDefinitionProvider !== 'function') {
      outputChannel?.appendLine(
        '[Extension] vscode.lm.registerMcpServerDefinitionProvider not available — Copilot MCP discovery requires VS Code 1.99+',
      );
      return;
    }

    const didChangeEmitter = new vscode.EventEmitter<void>();
    context.subscriptions.push(didChangeEmitter);

    const config = vscode.workspace.getConfiguration('pixelAgents');
    const port = config.get<number>('mcp.port', MCP_DEFAULT_PORT);

    context.subscriptions.push(
      vscode.lm.registerMcpServerDefinitionProvider('pixel-agents-mcp-provider', {
        onDidChangeMcpServerDefinitions: didChangeEmitter.event,
        provideMcpServerDefinitions: async () => {
          const servers: vscode.McpServerDefinition[] = [];

          // Register as an HTTP/SSE server pointing to our running MCP server
          if (typeof vscode.McpHttpServerDefinition === 'function') {
            servers.push(
              new vscode.McpHttpServerDefinition(
                'Pixel Agents',
                vscode.Uri.parse(`http://127.0.0.1:${port}/sse`),
                undefined,
                '1.0.0',
              ),
            );
            outputChannel?.appendLine(
              `[Extension] MCP server definition registered at http://127.0.0.1:${port}/sse`,
            );
          }

          return servers;
        },
        resolveMcpServerDefinition: async (server: vscode.McpServerDefinition) => {
          // Auto-start the MCP server when Copilot tries to use it
          if (!mcpServerInstance?.isRunning()) {
            outputChannel?.appendLine('[Extension] Auto-starting MCP server for Copilot...');
            await startMcpServer();
          }
          return server;
        },
      }),
    );

    outputChannel?.appendLine('[Extension] MCP server definition provider registered for Copilot');
  } catch (e) {
    outputChannel?.appendLine(`[Extension] Failed to register MCP server provider: ${e}`);
  }
}

export function deactivate() {
  providerInstance?.dispose();
  mcpServerInstance?.dispose();
  copilotDetectorInstance?.dispose();
  chatLogInstance?.dispose();
}
