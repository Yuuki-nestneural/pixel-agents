import * as vscode from 'vscode';

export interface AskUserInput {
  question: string;
}

export interface AskUserResult {
  response: string;
  attachments: string[];
}

interface PendingRequest {
  resolve: (result: AskUserResult) => void;
  question: string;
  id: string;
}

/**
 * Manages the VS Code native LM tool `ask_user` for the Pixel Agents extension.
 *
 * This uses `vscode.lm.registerTool` — the same API TaskSync uses — which means
 * Copilot gives us a CancellationToken instead of a hard timeout. The tool can
 * wait indefinitely for the user's response.
 *
 * The question is displayed in the Pixel Agents webview panel, and the user
 * types their response directly in the panel's chat input.
 */
export class AskUserTool implements vscode.Disposable {
  private pendingRequest: PendingRequest | null = null;
  private disposables: vscode.Disposable[] = [];
  private nextId = 1;

  /** Fires when a new question arrives (webview should display it) */
  private readonly onQuestionEmitter = new vscode.EventEmitter<{
    id: string;
    question: string;
  }>();
  readonly onQuestion = this.onQuestionEmitter.event;

  /** Fires when a question is answered (for chat log etc.) */
  private readonly onAnswerEmitter = new vscode.EventEmitter<{
    id: string;
    question: string;
    response: string;
  }>();
  readonly onAnswer = this.onAnswerEmitter.event;

  constructor() {}

  /**
   * Register the native LM tool with VS Code.
   * Call this in activate() and push the returned disposable.
   */
  register(): vscode.Disposable {
    const tool = vscode.lm.registerTool('ask_user', {
      prepareInvocation: (
        options: vscode.LanguageModelToolInvocationPrepareOptions<AskUserInput>,
      ) => {
        const raw = typeof options?.input?.question === 'string' ? options.input.question : '';
        const preview = raw.trim().replace(/\s+/g, ' ');
        const maxLen = 40;
        const truncated = preview.length > maxLen ? preview.slice(0, maxLen - 3) + '...' : preview;
        return {
          invocationMessage: truncated ? `ask_user: ${truncated}` : 'ask_user',
        };
      },
      invoke: async (
        options: vscode.LanguageModelToolInvocationOptions<AskUserInput>,
        token: vscode.CancellationToken,
      ) => {
        const question = options.input.question;

        try {
          const result = await this.waitForResponse(question, token);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              JSON.stringify({
                response: result.response,
                queued: false,
                attachmentCount: result.attachments.length,
              }),
            ),
          ]);
        } catch (err: unknown) {
          if (err instanceof vscode.CancellationError) {
            throw err;
          }
          const message = err instanceof Error ? err.message : 'Unknown error';
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: ' + message),
          ]);
        }
      },
    });

    this.disposables.push(tool);
    return tool;
  }

  /**
   * Wait for the user to respond to a question.
   * The Promise resolves when the user submits a response via the webview.
   * Respects the CancellationToken from Copilot.
   */
  private waitForResponse(
    question: string,
    token: vscode.CancellationToken,
  ): Promise<AskUserResult> {
    // Cancel any existing pending request
    if (this.pendingRequest) {
      this.pendingRequest.resolve({ response: '[Superseded by new request]', attachments: [] });
      this.pendingRequest = null;
    }

    const id = `pa-ask-${this.nextId++}`;

    return new Promise<AskUserResult>((resolve, reject) => {
      // Handle cancellation
      if (token.isCancellationRequested) {
        reject(new vscode.CancellationError());
        return;
      }

      const cancelDisposable = token.onCancellationRequested(() => {
        if (this.pendingRequest?.id === id) {
          this.pendingRequest = null;
        }
        cancelDisposable.dispose();
        reject(new vscode.CancellationError());
      });

      this.pendingRequest = {
        resolve: (result) => {
          cancelDisposable.dispose();
          resolve(result);
        },
        question,
        id,
      };

      // Notify webview to display the question
      this.onQuestionEmitter.fire({ id, question });
    });
  }

  /**
   * Submit a response from the webview.
   * Called when the user types and sends a reply in the Pixel Agents panel.
   */
  submitResponse(response: string): boolean {
    if (!this.pendingRequest) {
      return false;
    }

    const { id, question } = this.pendingRequest;
    this.pendingRequest.resolve({ response, attachments: [] });
    this.pendingRequest = null;

    // Fire answer event for chat log
    this.onAnswerEmitter.fire({ id, question, response });
    return true;
  }

  /**
   * Check if there's a pending question waiting for a response.
   */
  hasPendingQuestion(): boolean {
    return this.pendingRequest !== null;
  }

  /**
   * Get the current pending question (if any).
   */
  getPendingQuestion(): { id: string; question: string } | null {
    if (!this.pendingRequest) return null;
    return { id: this.pendingRequest.id, question: this.pendingRequest.question };
  }

  dispose(): void {
    if (this.pendingRequest) {
      this.pendingRequest.resolve({ response: '[Tool disposed]', attachments: [] });
      this.pendingRequest = null;
    }
    this.onQuestionEmitter.dispose();
    this.onAnswerEmitter.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
