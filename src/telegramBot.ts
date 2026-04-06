import { TELEGRAM_API_BASE } from './constants.js';

/**
 * Lightweight Telegram Bot API client for ask_user/notify_user MCP tools.
 * Uses long-polling to receive user replies.
 */

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  photo?: TelegramPhotoSize[];
  caption?: string;
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramReply {
  text?: string;
  image?: {
    data: string; // base64-encoded
    mimeType: string;
  };
}

export class TelegramBot {
  private botToken: string;
  private chatId: string;
  private lastUpdateId = 0;

  // Pending reply tracking for async ask_user
  private pendingReplies = new Map<
    string,
    {
      resolve: (reply: TelegramReply) => void;
      reject: (err: Error) => void;
      deadline: number; // 0 = no deadline
    }
  >();
  private pollingActive = false;
  private pollingAbort: AbortController | null = null;

  // Background polling for unsolicited messages (queuing)
  private bgPollingActive = false;
  private bgPollingAbort: AbortController | null = null;

  /**
   * Callback for messages that arrive when no ask_user is pending.
   * The MCP server uses this to feed the user message queue.
   */
  onUnsolicitedMessage?: (reply: TelegramReply) => void;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  private get apiBase(): string {
    return `${TELEGRAM_API_BASE}/bot${this.botToken}`;
  }

  /**
   * Send a message to the configured Telegram chat.
   * Returns the sent message ID.
   */
  async sendMessage(text: string): Promise<number> {
    const url = `${this.apiBase}/sendMessage`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Telegram sendMessage failed (${resp.status}): ${body}`);
    }
    const data = (await resp.json()) as { result: TelegramMessage };
    return data.result.message_id;
  }

  /**
   * Send a photo to the configured Telegram chat via URL.
   * Telegram will fetch the image from the provided URL.
   */
  async sendPhoto(imageUrl: string, caption?: string): Promise<number> {
    const url = `${this.apiBase}/sendPhoto`;
    const payload: Record<string, string> = {
      chat_id: this.chatId,
      photo: imageUrl,
    };
    if (caption) {
      payload.caption = caption;
      payload.parse_mode = 'Markdown';
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Telegram sendPhoto failed (${resp.status}): ${body}`);
    }
    const data = (await resp.json()) as { result: TelegramMessage };
    return data.result.message_id;
  }

  /**
   * Send a photo to the configured Telegram chat via base64 data upload.
   * Uses multipart/form-data to upload the image directly.
   */
  async sendPhotoBase64(base64Data: string, mimeType: string, caption?: string): Promise<number> {
    const url = `${this.apiBase}/sendPhoto`;
    const ext = mimeType.split('/')[1] || 'png';
    const binaryData = Buffer.from(base64Data, 'base64');
    const boundary = `----PixelAgents${Date.now()}`;

    let body = '';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="chat_id"\r\n\r\n`;
    body += `${this.chatId}\r\n`;

    if (caption) {
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="caption"\r\n\r\n`;
      body += `${caption}\r\n`;
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="parse_mode"\r\n\r\n`;
      body += `Markdown\r\n`;
    }

    // Build multipart body with binary photo
    const prefix = Buffer.from(
      `${body}--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="image.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const multipartBody = Buffer.concat([prefix, binaryData, suffix]);

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: multipartBody,
    });
    if (!resp.ok) {
      const respBody = await resp.text();
      throw new Error(`Telegram sendPhoto (base64) failed (${resp.status}): ${respBody}`);
    }
    const result = (await resp.json()) as { result: TelegramMessage };
    return result.result.message_id;
  }

  /**
   * Send a document/file to the configured Telegram chat via binary upload.
   * Uses multipart/form-data to upload the file directly.
   */
  async sendDocument(fileData: Buffer, filename: string, caption?: string): Promise<number> {
    const url = `${this.apiBase}/sendDocument`;
    const boundary = `----PixelAgents${Date.now()}`;

    let preamble = '';
    preamble += `--${boundary}\r\n`;
    preamble += `Content-Disposition: form-data; name="chat_id"\r\n\r\n`;
    preamble += `${this.chatId}\r\n`;

    if (caption) {
      preamble += `--${boundary}\r\n`;
      preamble += `Content-Disposition: form-data; name="caption"\r\n\r\n`;
      preamble += `${caption}\r\n`;
    }

    const prefix = Buffer.from(
      `${preamble}--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const multipartBody = Buffer.concat([prefix, fileData, suffix]);

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: multipartBody,
    });
    if (!resp.ok) {
      const respBody = await resp.text();
      throw new Error(`Telegram sendDocument failed (${resp.status}): ${respBody}`);
    }
    const data = (await resp.json()) as { result: TelegramMessage };
    return data.result.message_id;
  }

  /**
   * Get file info from Telegram servers.
   * Returns the file_path needed to download the file.
   */
  private async getFile(fileId: string): Promise<string> {
    const url = `${this.apiBase}/getFile`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Telegram getFile failed (${resp.status}): ${body}`);
    }
    const data = (await resp.json()) as { result: { file_path: string } };
    return data.result.file_path;
  }

  /**
   * Download a file from Telegram servers and return it as a base64-encoded string.
   */
  private async downloadFile(filePath: string): Promise<{ data: string; mimeType: string }> {
    const url = `${TELEGRAM_API_BASE}/file/bot${this.botToken}/${filePath}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Telegram file download failed (${resp.status})`);
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    const mimeType = resp.headers.get('content-type') || 'image/jpeg';
    return { data: buffer.toString('base64'), mimeType };
  }

  /**
   * Send a message and wait for the user's reply.
   * Implements long-polling on Telegram's getUpdates API.
   * Supports receiving text and photo replies.
   * @param text The question to send
   * @param timeoutMs Maximum time to wait for a reply (0 = no limit, default: no limit)
   * @param imageUrl Optional image URL to send alongside the question
   */
  async askUser(text: string, timeoutMs = 0, imageUrl?: string): Promise<TelegramReply> {
    // First flush any old pending updates so we only get new messages
    await this.flushOldUpdates();

    // Send the question (with optional image)
    if (imageUrl) {
      await this.sendPhoto(imageUrl, `🤖 *Agent Question:*\n${text}`);
    } else {
      await this.sendMessage(`🤖 *Agent Question:*\n${text}`);
    }

    // Poll for a reply — no timeout by default (loops until reply arrives)
    const hasDeadline = timeoutMs > 0;
    const deadline = hasDeadline ? Date.now() + timeoutMs : 0;

    while (!hasDeadline || Date.now() < deadline) {
      try {
        // Use Telegram long-polling: server holds connection for up to 30 seconds
        let pollTimeout = 30;
        if (hasDeadline) {
          const remaining = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
          pollTimeout = Math.min(remaining, 30);
        }
        const url = `${this.apiBase}/getUpdates`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offset: this.lastUpdateId + 1,
            timeout: pollTimeout,
            allowed_updates: ['message'],
          }),
        });

        if (!resp.ok) {
          console.error(`[Pixel Agents] Telegram getUpdates failed: ${resp.status}`);
          // Brief pause before retrying
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        const data = (await resp.json()) as { result: TelegramUpdate[] };
        for (const update of data.result) {
          this.lastUpdateId = update.update_id;
          const msg = update.message;
          if (!msg || msg.chat.id.toString() !== this.chatId) continue;

          // Handle text replies
          if (msg.text) {
            console.log(`[Pixel Agents] Telegram reply received: ${msg.text}`);
            return { text: msg.text };
          }

          // Handle photo replies
          if (msg.photo && msg.photo.length > 0) {
            // Get the largest photo (last in array)
            const largestPhoto = msg.photo[msg.photo.length - 1];
            try {
              const filePath = await this.getFile(largestPhoto.file_id);
              const downloaded = await this.downloadFile(filePath);
              console.log(`[Pixel Agents] Telegram photo reply received`);
              return {
                text: msg.caption || undefined,
                image: downloaded,
              };
            } catch (e) {
              console.error(`[Pixel Agents] Failed to download photo: ${e}`);
              return { text: msg.caption || '[Photo received but download failed]' };
            }
          }
        }
      } catch (e) {
        console.error(`[Pixel Agents] Telegram poll error: ${e}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Only reachable if there was a deadline
    throw new Error(`No reply received within ${(timeoutMs || 0) / 1000}s`);
  }

  /**
   * Flush old pending updates so we only process messages received after this point.
   */
  private async flushOldUpdates(): Promise<void> {
    try {
      const url = `${this.apiBase}/getUpdates`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offset: this.lastUpdateId + 1,
          timeout: 0,
          allowed_updates: ['message'],
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { result: TelegramUpdate[] };
        for (const update of data.result) {
          this.lastUpdateId = update.update_id;
        }
      }
    } catch {
      /* ignore flush errors */
    }
  }

  /**
   * Send a one-way notification (no reply expected).
   * @param text The notification message
   * @param imageUrl Optional image URL to send alongside the notification
   */
  async notifyUser(
    text: string,
    imageUrl?: string,
    imageBase64?: string,
    imageMimeType?: string,
  ): Promise<void> {
    if (imageBase64 && imageMimeType) {
      await this.sendPhotoBase64(imageBase64, imageMimeType, `📋 *Agent Notification:*\n${text}`);
    } else if (imageUrl) {
      await this.sendPhoto(imageUrl, `📋 *Agent Notification:*\n${text}`);
    } else {
      await this.sendMessage(`📋 *Agent Notification:*\n${text}`);
    }
  }

  /**
   * Send a question and return a request ID. The reply will be collected asynchronously.
   * Use `getReply(requestId)` to poll for the response.
   * This avoids MCP tool timeouts by returning immediately.
   */
  async sendQuestion(
    text: string,
    timeoutMs = 0,
    imageUrl?: string,
    imageBase64?: string,
    imageMimeType?: string,
  ): Promise<string> {
    // Flush old updates
    await this.flushOldUpdates();

    // Send the question
    if (imageBase64 && imageMimeType) {
      await this.sendPhotoBase64(imageBase64, imageMimeType, `🤖 *Agent Question:*\n${text}`);
    } else if (imageUrl) {
      await this.sendPhoto(imageUrl, `🤖 *Agent Question:*\n${text}`);
    } else {
      await this.sendMessage(`🤖 *Agent Question:*\n${text}`);
    }

    // Create a pending reply entry
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0;

    const promise = new Promise<TelegramReply>((resolve, reject) => {
      this.pendingReplies.set(requestId, { resolve, reject, deadline });
    });

    // Store the promise for later retrieval
    this.replyPromises.set(requestId, promise);

    // Start background polling if not already running
    this.ensurePolling();

    return requestId;
  }

  // Stores pending promises for sendQuestion
  private replyPromises = new Map<string, Promise<TelegramReply>>();

  /**
   * Check if a reply has arrived for a given request ID.
   * Returns the reply if available, or null if still waiting.
   * Pass `wait` to block for a short period before returning.
   */
  async getReply(requestId: string, waitMs = 0): Promise<TelegramReply | null> {
    const promise = this.replyPromises.get(requestId);
    if (!promise) {
      return null; // Unknown request
    }

    // Check if deadline has passed
    const pending = this.pendingReplies.get(requestId);
    if (pending && pending.deadline > 0 && Date.now() > pending.deadline) {
      this.pendingReplies.delete(requestId);
      this.replyPromises.delete(requestId);
      return null; // Timed out
    }

    if (waitMs > 0) {
      // Race: either get the reply or timeout after waitMs
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs));
      const result = await Promise.race([promise.then((r) => r), timeout]);
      if (result !== null) {
        this.replyPromises.delete(requestId);
      }
      return result;
    }

    // Non-blocking check: see if promise is already resolved
    const sentinel = Symbol('pending');
    const result = await Promise.race([
      promise.then((r) => r as TelegramReply | typeof sentinel),
      Promise.resolve(sentinel),
    ]);
    if (result === sentinel) {
      return null; // Still waiting
    }
    this.replyPromises.delete(requestId);
    return result as TelegramReply;
  }

  /**
   * Check if a request is still pending (no reply yet).
   */
  hasPendingRequest(requestId: string): boolean {
    return this.pendingReplies.has(requestId);
  }

  /**
   * Start the background polling loop if not already running.
   */
  private ensurePolling(): void {
    if (this.pollingActive) return;

    // Stop background polling to prevent concurrent getUpdates calls
    // (two loops polling simultaneously can steal each other's messages)
    if (this.bgPollingActive && this.bgPollingAbort) {
      this.bgPollingAbort.abort();
      this.bgPollingActive = false;
    }

    this.pollingActive = true;
    this.pollingAbort = new AbortController();
    this.pollLoop(this.pollingAbort.signal).catch(() => {});
  }

  /**
   * Background polling loop that resolves pending reply promises.
   */
  private async pollLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && this.pendingReplies.size > 0) {
      try {
        // Clean up expired requests
        for (const [id, entry] of this.pendingReplies) {
          if (entry.deadline > 0 && Date.now() > entry.deadline) {
            entry.reject(new Error('Telegram reply timed out'));
            this.pendingReplies.delete(id);
            this.replyPromises.delete(id);
          }
        }

        if (this.pendingReplies.size === 0) break;

        const url = `${this.apiBase}/getUpdates`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offset: this.lastUpdateId + 1,
            timeout: 30,
            allowed_updates: ['message'],
          }),
          signal,
        });

        if (!resp.ok) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        const data = (await resp.json()) as { result: TelegramUpdate[] };
        for (const update of data.result) {
          this.lastUpdateId = update.update_id;
          const msg = update.message;
          if (!msg || msg.chat.id.toString() !== this.chatId) continue;

          let reply: TelegramReply | null = null;

          if (msg.text) {
            reply = { text: msg.text };
          } else if (msg.photo && msg.photo.length > 0) {
            const largestPhoto = msg.photo[msg.photo.length - 1];
            try {
              const filePath = await this.getFile(largestPhoto.file_id);
              const downloaded = await this.downloadFile(filePath);
              reply = { text: msg.caption || undefined, image: downloaded };
            } catch {
              reply = { text: msg.caption || '[Photo received but download failed]' };
            }
          }

          if (reply) {
            // Resolve the oldest pending request, or forward as unsolicited
            const [oldestId, oldestEntry] = [...this.pendingReplies.entries()][0] ?? [];
            if (oldestEntry) {
              oldestEntry.resolve(reply);
              this.pendingReplies.delete(oldestId);
            } else if (this.onUnsolicitedMessage) {
              this.onUnsolicitedMessage(reply);
            }
          }
        }
      } catch (e) {
        if (signal.aborted) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    this.pollingActive = false;

    // Restart background polling now that the per-request poll is done
    if (!this.bgPollingActive) {
      this.startBackgroundPolling();
    }
  }

  /**
   * Cancel a pending request (e.g., when another channel responded first).
   * Removes the request from pending maps so polling can stop if no others remain.
   */
  cancelPendingRequest(requestId: string): void {
    const entry = this.pendingReplies.get(requestId);
    if (entry) {
      entry.reject(new Error('Request cancelled — answered via another channel'));
      this.pendingReplies.delete(requestId);
      this.replyPromises.delete(requestId);
    }
  }

  /**
   * Start continuous background polling for unsolicited Telegram messages.
   * Messages that arrive when no ask_user is pending will be forwarded
   * to `onUnsolicitedMessage` for queuing.
   */
  startBackgroundPolling(): void {
    if (this.bgPollingActive) return;
    this.bgPollingActive = true;
    this.bgPollingAbort = new AbortController();
    this.bgPollLoop(this.bgPollingAbort.signal).catch(() => {});
  }

  /**
   * Stop background polling.
   */
  stopBackgroundPolling(): void {
    this.bgPollingAbort?.abort();
    this.bgPollingActive = false;
  }

  /**
   * Background polling loop: runs continuously and dispatches messages.
   * When pending requests exist, the regular pollLoop handles replies.
   * When no pending requests exist, messages go to onUnsolicitedMessage.
   */
  private async bgPollLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        // Yield to the regular poll loop if it's active
        // (ensurePolling will abort this loop, but check just in case)
        if (this.pollingActive) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

        const url = `${this.apiBase}/getUpdates`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offset: this.lastUpdateId + 1,
            timeout: 30,
            allowed_updates: ['message'],
          }),
          signal,
        });

        if (!resp.ok) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        const data = (await resp.json()) as { result: TelegramUpdate[] };
        for (const update of data.result) {
          this.lastUpdateId = update.update_id;
          const msg = update.message;
          if (!msg || msg.chat.id.toString() !== this.chatId) continue;

          let reply: TelegramReply | null = null;

          if (msg.text) {
            reply = { text: msg.text };
          } else if (msg.photo && msg.photo.length > 0) {
            const largestPhoto = msg.photo[msg.photo.length - 1];
            try {
              const filePath = await this.getFile(largestPhoto.file_id);
              const downloaded = await this.downloadFile(filePath);
              reply = { text: msg.caption || undefined, image: downloaded };
            } catch {
              reply = { text: msg.caption || '[Photo received but download failed]' };
            }
          }

          if (reply && this.onUnsolicitedMessage) {
            this.onUnsolicitedMessage(reply);
          }
        }
      } catch (e) {
        if (signal.aborted) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    this.bgPollingActive = false;
  }

  dispose(): void {
    this.pollingAbort?.abort();
    this.bgPollingAbort?.abort();
    // Reject all pending requests
    for (const [id, entry] of this.pendingReplies) {
      entry.reject(new Error('TelegramBot disposed'));
      this.replyPromises.delete(id);
    }
    this.pendingReplies.clear();
  }
}
