import { useCallback, useEffect, useRef, useState } from 'react';

import { vscode } from '../vscodeApi.js';

/* ── Types ──────────────────────────────────────────────────── */

interface Quest {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in-progress' | 'done';
  assignee?: string;
}

interface ChatMessage {
  id: string;
  type: 'question' | 'response';
  text: string;
  timestamp: number;
}

type Tab = 'quests' | 'chat';

/* ── Component ──────────────────────────────────────────────── */

export function WhiteboardPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('quests');
  const [quests, setQuests] = useState<Quest[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [pendingQuestionId, setPendingQuestionId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Listen for messages from the extension
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'questBoardUpdate') {
        setQuests(msg.quests ?? []);
      } else if (msg.type === 'askUserQuestion') {
        setChatMessages((prev) => [
          ...prev,
          { id: msg.id, type: 'question', text: msg.question, timestamp: Date.now() },
        ]);
        setPendingQuestionId(msg.id);
        setTab('chat'); // auto-switch to chat tab
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Focus input on pending question
  useEffect(() => {
    if (pendingQuestionId && visible && tab === 'chat') {
      inputRef.current?.focus();
    }
  }, [pendingQuestionId, visible, tab]);

  const handleSendChat = useCallback(() => {
    const text = inputValue.trim();
    if (!text || !pendingQuestionId) return;
    setChatMessages((prev) => [
      ...prev,
      { id: `resp-${Date.now()}`, type: 'response', text, timestamp: Date.now() },
    ]);
    vscode.postMessage({ type: 'askUserResponse', response: text });
    setInputValue('');
    setPendingQuestionId(null);
  }, [inputValue, pendingQuestionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendChat();
      }
    },
    [handleSendChat],
  );

  if (!visible) return null;

  const priorityColor: Record<string, string> = {
    high: '#e74c3c',
    medium: '#f39c12',
    low: '#2ecc71',
  };

  const statusIcon: Record<string, string> = {
    open: '⬚',
    'in-progress': '▶',
    done: '✓',
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: '100%',
        height: '100%',
        background: 'var(--vscode-sideBar-background, #1e1e1e)',
        borderLeft: 'none',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 60,
        fontSize: '16px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 8px',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          background: 'var(--vscode-titleBar-activeBackground, #2d2d2d)',
        }}
      >
        <span style={{ fontWeight: 'bold', color: 'var(--vscode-foreground)' }}>📋 Whiteboard</span>
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

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
        }}
      >
        {(['quests', 'chat'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '6px 0',
              background: tab === t ? 'var(--vscode-tab-activeBackground, #1e1e1e)' : 'transparent',
              color:
                tab === t
                  ? 'var(--vscode-foreground)'
                  : 'var(--vscode-descriptionForeground, #888)',
              border: 'none',
              borderBottom:
                tab === t
                  ? '2px solid var(--vscode-focusBorder, #007acc)'
                  : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: tab === t ? 'bold' : 'normal',
            }}
          >
            {t === 'quests' ? '📌 Quests' : '💬 Chat'}
            {t === 'chat' && pendingQuestionId && (
              <span style={{ color: '#e74c3c', marginLeft: 4 }}>●</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'quests' && (
          <div style={{ padding: '8px' }}>
            {quests.length === 0 && (
              <div
                style={{
                  color: 'var(--vscode-descriptionForeground)',
                  textAlign: 'center',
                  padding: '24px 8px',
                }}
              >
                No quests yet.
                <br />
                Agents can add quests via MCP tools.
              </div>
            )}
            {quests.map((q) => (
              <div
                key={q.id}
                style={{
                  padding: '8px',
                  marginBottom: '4px',
                  background: 'var(--vscode-textCodeBlock-background, #2d2d2d)',
                  border: '1px solid var(--vscode-panel-border, #444)',
                  borderLeft: `3px solid ${priorityColor[q.priority] ?? '#888'}`,
                  borderRadius: '2px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '4px',
                  }}
                >
                  <span style={{ fontWeight: 'bold', color: 'var(--vscode-foreground)' }}>
                    {statusIcon[q.status] ?? '?'} {q.title}
                  </span>
                  <span
                    style={{
                      fontSize: '14px',
                      color: priorityColor[q.priority] ?? '#888',
                      textTransform: 'uppercase',
                    }}
                  >
                    {q.priority}
                  </span>
                </div>
                {q.description && (
                  <div
                    style={{
                      color: 'var(--vscode-descriptionForeground)',
                      fontSize: '15px',
                      marginBottom: '4px',
                    }}
                  >
                    {q.description}
                  </div>
                )}
                <div style={{ fontSize: '14px', color: 'var(--vscode-descriptionForeground)' }}>
                  {q.assignee && <span>👤 {q.assignee}</span>}
                  <span style={{ marginLeft: q.assignee ? 8 : 0 }}>
                    {q.status === 'done'
                      ? '✅ Done'
                      : q.status === 'in-progress'
                        ? '🔄 In Progress'
                        : '📭 Open'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'chat' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
            }}
          >
            {/* Messages */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              {chatMessages.length === 0 && (
                <div
                  style={{
                    color: 'var(--vscode-descriptionForeground)',
                    textAlign: 'center',
                    padding: '24px 8px',
                  }}
                >
                  Agent questions appear here...
                </div>
              )}
              {chatMessages.map((msg) => (
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
                  <div style={{ fontSize: '13px', opacity: 0.6, marginBottom: '2px' }}>
                    {msg.type === 'question' ? '🤖 Agent' : '👤 You'}
                  </div>
                  {msg.text}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div
              style={{
                padding: '8px 12px',
                borderTop: '1px solid var(--vscode-panel-border, #333)',
                display: 'flex',
                gap: '8px',
              }}
            >
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={pendingQuestionId ? 'Type your response...' : 'Waiting for agent...'}
                disabled={!pendingQuestionId}
                rows={2}
                style={{
                  flex: 1,
                  background: 'var(--vscode-input-background, #3c3c3c)',
                  color: 'var(--vscode-input-foreground, #ccc)',
                  border: '1px solid var(--vscode-input-border, #555)',
                  borderRadius: '2px',
                  padding: '6px 10px',
                  fontSize: '16px',
                  resize: 'none',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              <button
                onClick={handleSendChat}
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
                  fontSize: '16px',
                  alignSelf: 'flex-end',
                }}
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
