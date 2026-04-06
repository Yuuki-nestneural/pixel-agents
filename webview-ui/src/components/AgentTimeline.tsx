import { useEffect, useState } from 'react';

import { AGENT_PROFILE_UPTIME_INTERVAL_MS } from '../constants.js';
import type { AgentProfile, ToolHistoryEntry } from '../hooks/useExtensionMessages.js';

/* ── Helpers ─────────────────────────────────────────────────── */

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function toolIcon(toolName: string): string {
  const t = toolName.toLowerCase();
  if (t.includes('read') || t.includes('grep') || t.includes('glob') || t.includes('search'))
    return '📖';
  if (t.includes('write') || t.includes('edit') || t.includes('replace')) return '✏️';
  if (t.includes('bash') || t.includes('terminal') || t.includes('run')) return '⌨️';
  if (t.includes('task') || t.includes('agent') || t.includes('subtask')) return '🤖';
  if (t.includes('web') || t.includes('fetch') || t.includes('url')) return '🌐';
  if (t.includes('mcp')) return '🔌';
  return '🔧';
}

function toolColor(toolName: string): string {
  const t = toolName.toLowerCase();
  if (t.includes('read') || t.includes('grep') || t.includes('glob') || t.includes('search'))
    return '#3498db';
  if (t.includes('write') || t.includes('edit') || t.includes('replace')) return '#e74c3c';
  if (t.includes('bash') || t.includes('terminal') || t.includes('run')) return '#f39c12';
  if (t.includes('task') || t.includes('agent') || t.includes('subtask')) return '#9b59b6';
  if (t.includes('web') || t.includes('fetch') || t.includes('url')) return '#1abc9c';
  if (t.includes('mcp')) return '#e67e22';
  return '#95a5a6';
}

interface TurnGroup {
  startedAt: number;
  endedAt: number;
  tools: ToolHistoryEntry[];
}

function groupByTurns(history: ToolHistoryEntry[]): TurnGroup[] {
  if (history.length === 0) return [];

  const groups: TurnGroup[] = [];
  let current: TurnGroup = {
    startedAt: history[0].startedAt,
    endedAt: history[0].endedAt ?? history[0].startedAt,
    tools: [history[0]],
  };

  for (let i = 1; i < history.length; i++) {
    const entry = history[i];
    const gap = entry.startedAt - current.endedAt;
    // If more than 10 seconds between tools, start a new group (likely new turn)
    if (gap > 10000) {
      groups.push(current);
      current = {
        startedAt: entry.startedAt,
        endedAt: entry.endedAt ?? entry.startedAt,
        tools: [entry],
      };
    } else {
      current.tools.push(entry);
      if ((entry.endedAt ?? entry.startedAt) > current.endedAt) {
        current.endedAt = entry.endedAt ?? entry.startedAt;
      }
    }
  }
  groups.push(current);
  return groups;
}

/* ── Component ───────────────────────────────────────────────── */

interface AgentTimelineProps {
  profile: AgentProfile;
  onClose: () => void;
}

export function AgentTimeline({ profile, onClose }: AgentTimelineProps) {
  // Tick to update "running" durations
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), AGENT_PROFILE_UPTIME_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const turnGroups = groupByTurns(profile.toolHistory).reverse(); // Most recent first

  return (
    <div
      style={{
        position: 'absolute',
        right: 8,
        top: 40,
        zIndex: 61,
        width: 320,
        maxHeight: 'calc(100% - 60px)',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        boxShadow: 'var(--pixel-shadow)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '2px solid var(--pixel-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255, 255, 255, 0.06)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '22px', fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.9)' }}>
          Activity Timeline
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pixel-close-text)',
            cursor: 'pointer',
            padding: '0 2px',
            fontSize: '26px',
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-text)';
          }}
        >
          ×
        </button>
      </div>

      {/* Timeline content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 10px',
        }}
      >
        {turnGroups.length === 0 && (
          <div
            style={{
              color: 'rgba(255, 255, 255, 0.4)',
              fontSize: '20px',
              textAlign: 'center',
              padding: '20px 0',
            }}
          >
            No activity yet
          </div>
        )}

        {turnGroups.map((group, gi) => (
          <TurnGroupView key={group.startedAt} group={group} isLatest={gi === 0} now={now} />
        ))}
      </div>

      {/* Footer summary */}
      <div
        style={{
          padding: '6px 10px',
          borderTop: '1px solid var(--pixel-border)',
          fontSize: '16px',
          color: 'rgba(255, 255, 255, 0.4)',
          flexShrink: 0,
        }}
      >
        {profile.totalToolsRun} tools · {profile.turnsCompleted} turns · {turnGroups.length} groups
      </div>
    </div>
  );
}

/* ── Turn group view ─────────────────────────────────────────── */

function TurnGroupView({
  group,
  isLatest,
  now,
}: {
  group: TurnGroup;
  isLatest: boolean;
  now: number;
}) {
  const duration = group.endedAt - group.startedAt;

  return (
    <div
      style={{
        marginBottom: 8,
        borderLeft: `2px solid ${isLatest ? 'var(--pixel-accent)' : 'rgba(255, 255, 255, 0.15)'}`,
        paddingLeft: 8,
      }}
    >
      {/* Time header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: '16px', color: 'rgba(255, 255, 255, 0.5)' }}>
          {formatTime(group.startedAt)}
        </span>
        {duration > 0 && (
          <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.3)' }}>
            {formatDuration(duration)}
          </span>
        )}
      </div>

      {/* Tool entries */}
      {group.tools.map((entry, i) => (
        <TimelineEntry
          key={`${entry.startedAt}-${i}`}
          entry={entry}
          isRunning={!entry.endedAt && isLatest}
          now={now}
        />
      ))}
    </div>
  );
}

/* ── Timeline entry ──────────────────────────────────────────── */

function TimelineEntry({
  entry,
  isRunning,
  now,
}: {
  entry: ToolHistoryEntry;
  isRunning: boolean;
  now: number;
}) {
  const color = toolColor(entry.toolName);
  const duration = entry.endedAt ? entry.endedAt - entry.startedAt : now - entry.startedAt;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 4,
        padding: '2px 0',
        fontSize: '18px',
      }}
    >
      {/* Timeline dot */}
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          marginTop: 5,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ flexShrink: 0 }}>{toolIcon(entry.toolName)}</span>
          <span
            style={{
              color: isRunning ? '#2ecc71' : 'rgba(255, 255, 255, 0.7)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {entry.status}
          </span>
          <span
            style={{
              fontSize: '14px',
              color: isRunning ? '#2ecc71' : 'rgba(255, 255, 255, 0.3)',
              flexShrink: 0,
            }}
          >
            {isRunning ? `${formatDuration(duration)}…` : formatDuration(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
