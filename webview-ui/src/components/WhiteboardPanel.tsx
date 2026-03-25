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

interface ChatLogEntry {
  id: number;
  timestamp: number;
  agentName: string;
  type: string;
  message: string;
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
      } else if (msg.type === 'chatLogEntry') {
        // Live chat log entry from the backend
        // Skip user_reply — already shown locally when user submits via the input
        const e = msg.entry;
        if (!e || e.type === 'user_reply') return;
        setChatMessages((prev) => [
          ...prev,
          {
            id: String(e.id),
            type: 'question' as const,
            text: `[${e.agentName}] ${e.message}`,
            timestamp: e.timestamp,
          },
        ]);
      } else if (msg.type === 'chatLogBulk') {
        // Bulk restore of persisted chat entries
        const entries = msg.entries ?? [];
        const restored = entries.map((e: ChatLogEntry) => ({
          id: String(e.id),
          type: e.type === 'user_reply' ? 'response' : 'question',
          text: `[${e.agentName}] ${e.message}`,
          timestamp: e.timestamp,
        }));
        setChatMessages(restored);
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

  const menuItemBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    padding: '6px 10px',
    fontSize: '24px',
    color: 'rgba(255, 255, 255, 0.8)',
    background: 'transparent',
    border: 'none',
    borderRadius: 0,
    cursor: 'pointer',
    textAlign: 'left',
  };

  return (
    <>
      {/* Dark backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 49,
        }}
      />
      {/* Centered modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 50,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          width: '95%',
          maxWidth: 600,
          maxHeight: '90%',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>Whiteboard</span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            X
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--pixel-border)' }}>
          {(['quests', 'chat'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                ...menuItemBase,
                background: tab === t ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                color: tab === t ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.5)',
                borderBottom: tab === t ? '2px solid var(--pixel-accent)' : '2px solid transparent',
                fontWeight: tab === t ? 'bold' : 'normal',
              }}
            >
              {t === 'quests' ? 'Quests' : 'Chat'}
              {t === 'chat' && pendingQuestionId && (
                <span style={{ color: '#e74c3c', marginLeft: 6 }}>●</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 120, maxHeight: 500 }}>
          {tab === 'quests' && (
            <div style={{ padding: '6px 10px' }}>
              {quests.length === 0 && (
                <div
                  style={{
                    color: 'rgba(255, 255, 255, 0.5)',
                    textAlign: 'center',
                    padding: '24px 8px',
                    fontSize: '22px',
                  }}
                >
                  No quests yet.
                </div>
              )}
              {quests.map((q) => (
                <div
                  key={q.id}
                  style={{
                    padding: '8px 10px',
                    marginBottom: '6px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--pixel-border)',
                    borderLeft: `3px solid ${priorityColor[q.priority] ?? '#888'}`,
                    borderRadius: 0,
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
                    <span
                      style={{
                        fontWeight: 'bold',
                        color: 'rgba(255, 255, 255, 0.9)',
                        fontSize: '22px',
                      }}
                    >
                      {statusIcon[q.status] ?? '?'} {q.title}
                    </span>
                    <span
                      style={{
                        fontSize: '18px',
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
                        color: 'rgba(255, 255, 255, 0.6)',
                        fontSize: '20px',
                        marginBottom: '4px',
                      }}
                    >
                      {q.description}
                    </div>
                  )}
                  <div style={{ fontSize: '18px', color: 'rgba(255, 255, 255, 0.5)' }}>
                    {q.assignee && <span>{q.assignee}</span>}
                    <span style={{ marginLeft: q.assignee ? 8 : 0 }}>
                      {q.status === 'done'
                        ? 'Done'
                        : q.status === 'in-progress'
                          ? 'In Progress'
                          : 'Open'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'chat' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '6px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  minHeight: 80,
                }}
              >
                {chatMessages.length === 0 && (
                  <div
                    style={{
                      color: 'rgba(255, 255, 255, 0.5)',
                      textAlign: 'center',
                      padding: '24px 8px',
                      fontSize: '22px',
                    }}
                  >
                    Agent questions appear here...
                  </div>
                )}
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 0,
                      maxWidth: '90%',
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                      fontSize: '20px',
                      ...(msg.type === 'question'
                        ? {
                            alignSelf: 'flex-start',
                            background: 'rgba(255, 255, 255, 0.06)',
                            color: 'rgba(255, 255, 255, 0.9)',
                            border: '1px solid var(--pixel-border)',
                          }
                        : {
                            alignSelf: 'flex-end',
                            background: 'var(--pixel-accent)',
                            color: '#fff',
                          }),
                    }}
                  >
                    <div style={{ fontSize: '16px', opacity: 0.6, marginBottom: '2px' }}>
                      {msg.type === 'question' ? 'Agent' : 'You'}
                    </div>
                    {msg.text}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <div
                style={{
                  padding: '8px 10px',
                  borderTop: '1px solid var(--pixel-border)',
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
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: 'rgba(255, 255, 255, 0.9)',
                    border: '1px solid var(--pixel-border)',
                    borderRadius: 0,
                    padding: '6px 10px',
                    fontSize: '20px',
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
                      ? 'var(--pixel-accent)'
                      : 'rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    border: '2px solid var(--pixel-accent)',
                    borderRadius: 0,
                    padding: '6px 16px',
                    cursor: pendingQuestionId ? 'pointer' : 'default',
                    fontSize: '22px',
                    alignSelf: 'flex-end',
                    boxShadow: 'var(--pixel-shadow)',
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
