import { useCallback, useEffect, useRef, useState } from 'react';

import { vscode } from '../vscodeApi.js';

interface ChatMessage {
  id: string;
  type: 'question' | 'response';
  text: string;
  timestamp: number;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const handleSubmit = useCallback(() => {
    const text = inputValue.trim();
    if (!text || !pendingQuestionId) return;

    // Add user response to chat
    setMessages((prev) => [
      ...prev,
      {
        id: `resp-${Date.now()}`,
        type: 'response',
        text,
        timestamp: Date.now(),
      },
    ]);

    // Send response back to extension
    vscode.postMessage({ type: 'askUserResponse', response: text });

    setInputValue('');
    setPendingQuestionId(null);
  }, [inputValue, pendingQuestionId]);

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
          gap: '6px',
        }}
      >
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            pendingQuestionId ? 'Type your response...' : 'Waiting for agent question...'
          }
          disabled={!pendingQuestionId}
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
          disabled={!pendingQuestionId || !inputValue.trim()}
          style={{
            background: pendingQuestionId
              ? 'var(--vscode-button-background, #007acc)'
              : 'var(--vscode-button-secondaryBackground, #555)',
            color: 'var(--vscode-button-foreground, #fff)',
            border: 'none',
            borderRadius: '2px',
            padding: '4px 12px',
            cursor: pendingQuestionId ? 'pointer' : 'default',
            fontSize: '12px',
            alignSelf: 'flex-end',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
