import { useCallback, useEffect, useRef, useState } from 'react';

import { vscode } from '../vscodeApi.js';

interface ChatMessage {
  id: string;
  type: 'question' | 'response';
  text: string;
  timestamp: number;
  /** Base64 data URI for an attached image */
  imageDataUri?: string;
}

interface PendingImage {
  dataUri: string; // data:image/...;base64,...
  mimeType: string;
  base64: string; // raw base64 without prefix
}

/**
 * Chat panel for ask_user interactions.
 * Displays agent questions and lets the user type responses.
 * Slides up from the bottom of the Pixel Agents panel.
 */
export function ChatPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [pendingQuestionId, setPendingQuestionId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Listen for ask_user questions from the extension
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'askUserQuestion') {
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id,
            type: 'question',
            text: msg.question,
            timestamp: Date.now(),
          },
        ]);
        setPendingQuestionId(msg.id);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when a question arrives
  useEffect(() => {
    if (pendingQuestionId && visible) {
      inputRef.current?.focus();
    }
  }, [pendingQuestionId, visible]);

  // Read an image File into a PendingImage
  const readImageFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      // Extract base64 and mime from data URI
      const match = dataUri.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        setPendingImage({ dataUri, mimeType: match[1], base64: match[2] });
      }
    };
    reader.readAsDataURL(file);
  }, []);

  // Handle paste events for images
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) readImageFile(file);
          return;
        }
      }
    },
    [readImageFile],
  );

  // Handle file input change
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && file.type.startsWith('image/')) {
        readImageFile(file);
      }
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [readImageFile],
  );

  const handleSubmit = useCallback(() => {
    const text = inputValue.trim();
    if (!text && !pendingImage) return;

    // Add user response to chat
    setMessages((prev) => [
      ...prev,
      {
        id: `resp-${Date.now()}`,
        type: 'response',
        text: text || (pendingImage ? '[Image]' : ''),
        timestamp: Date.now(),
        imageDataUri: pendingImage?.dataUri,
      },
    ]);

    // Send response back to extension (with optional image)
    vscode.postMessage({
      type: 'askUserResponse',
      response: text || (pendingImage ? '[Image]' : ''),
      image: pendingImage
        ? { base64: pendingImage.base64, mimeType: pendingImage.mimeType }
        : undefined,
    });

    setInputValue('');
    setPendingImage(null);
    if (pendingQuestionId) {
      setPendingQuestionId(null);
    }
  }, [inputValue, pendingQuestionId, pendingImage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: '60%',
        background: 'var(--vscode-sideBar-background, #1e1e1e)',
        borderTop: '2px solid var(--vscode-panel-border, #333)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 60,
        fontSize: '12px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 8px',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          background: 'var(--vscode-titleBar-activeBackground, #2d2d2d)',
        }}
      >
        <span style={{ fontWeight: 'bold', color: 'var(--vscode-foreground)' }}>💬 Agent Chat</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--vscode-foreground)',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '2px 6px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          minHeight: 60,
          maxHeight: 200,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              color: 'var(--vscode-descriptionForeground)',
              textAlign: 'center',
              padding: '16px',
            }}
          >
            Agent questions will appear here...
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              padding: '6px 10px',
              borderRadius: '4px',
              maxWidth: '90%',
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
              ...(msg.type === 'question'
                ? {
                    alignSelf: 'flex-start',
                    background: 'var(--vscode-textCodeBlock-background, #2d2d2d)',
                    color: 'var(--vscode-foreground)',
                    border: '1px solid var(--vscode-panel-border, #444)',
                  }
                : {
                    alignSelf: 'flex-end',
                    background: 'var(--vscode-button-background, #007acc)',
                    color: 'var(--vscode-button-foreground, #fff)',
                  }),
            }}
          >
            <div style={{ fontSize: '10px', opacity: 0.6, marginBottom: '2px' }}>
              {msg.type === 'question' ? '🤖 Agent' : '👤 You'}
            </div>
            {msg.text}
            {msg.imageDataUri && (
              <img
                src={msg.imageDataUri}
                alt="Attached"
                style={{
                  maxWidth: '100%',
                  maxHeight: 120,
                  borderRadius: '2px',
                  marginTop: '4px',
                  display: 'block',
                }}
              />
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: '6px 8px',
          borderTop: '1px solid var(--vscode-panel-border, #333)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        {/* Image preview */}
        {pendingImage && (
          <div style={{ position: 'relative', display: 'inline-block', alignSelf: 'flex-start' }}>
            <img
              src={pendingImage.dataUri}
              alt="Pending attachment"
              style={{
                maxWidth: '120px',
                maxHeight: '80px',
                borderRadius: '2px',
                border: '1px solid var(--vscode-panel-border, #444)',
              }}
            />
            <button
              onClick={() => setPendingImage(null)}
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                background: 'var(--vscode-errorForeground, #f44)',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                width: 16,
                height: 16,
                fontSize: '10px',
                lineHeight: '16px',
                textAlign: 'center',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px' }}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          {/* Attachment button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach image"
            style={{
              background: 'none',
              border: '1px solid var(--vscode-input-border, #555)',
              color: 'var(--vscode-foreground)',
              borderRadius: '2px',
              padding: '4px 6px',
              cursor: 'pointer',
              fontSize: '14px',
              alignSelf: 'flex-end',
            }}
          >
            📎
          </button>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              pendingQuestionId
                ? 'Type your response... (paste images)'
                : 'Type a message to queue... (paste images)'
            }
            rows={2}
            style={{
              flex: 1,
              background: 'var(--vscode-input-background, #3c3c3c)',
              color: 'var(--vscode-input-foreground, #ccc)',
              border: '1px solid var(--vscode-input-border, #555)',
              borderRadius: '2px',
              padding: '4px 8px',
              fontSize: '12px',
              resize: 'none',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!inputValue.trim() && !pendingImage}
            style={{
              background:
                inputValue.trim() || pendingImage
                  ? 'var(--vscode-button-background, #007acc)'
                  : 'var(--vscode-button-secondaryBackground, #555)',
              color: 'var(--vscode-button-foreground, #fff)',
              border: 'none',
              borderRadius: '2px',
              padding: '4px 12px',
              cursor: inputValue.trim() || pendingImage ? 'pointer' : 'default',
              fontSize: '12px',
              alignSelf: 'flex-end',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
