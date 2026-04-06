import { useEffect, useState } from 'react';

import { AGENT_PROFILE_MAX_RECENT_TOOLS, AGENT_PROFILE_UPTIME_INTERVAL_MS } from '../constants.js';
import type { AgentProfile, ToolHistoryEntry } from '../hooks/useExtensionMessages.js';
import type { ToolActivity } from '../office/types.js';

/* ── Palette colors matching character sprites ──────────────── */
const PALETTE_COLORS = ['#5b8c4a', '#c4534a', '#4a7ab5', '#b8963a', '#7b5ea7', '#c96b3c'];

/* ── Helpers ─────────────────────────────────────────────────── */

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  const rm = min % 60;
  return `${hr}h ${rm}m`;
}

function getStatusInfo(
  agentTools: ToolActivity[] | undefined,
  agentStatus: string | undefined,
  isActive: boolean,
): { label: string; color: string } {
  if (agentTools && agentTools.length > 0) {
    const activeTool = [...agentTools].reverse().find((t) => !t.done);
    if (activeTool?.permissionWait) return { label: 'Needs Approval', color: '#f39c12' };
    if (activeTool) return { label: 'Working', color: '#2ecc71' };
  }
  if (agentStatus === 'waiting') return { label: 'Waiting', color: '#2ecc71' };
  if (isActive) return { label: 'Active', color: '#2ecc71' };
  return { label: 'Idle', color: 'rgba(255, 255, 255, 0.4)' };
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

/* ── Component ───────────────────────────────────────────────── */

interface AgentProfileCardProps {
  agentId: number;
  profile: AgentProfile;
  tools: ToolActivity[] | undefined;
  status: string | undefined;
  palette: number;
  hueShift: number;
  isActive: boolean;
  folderName?: string;
  onClose: () => void;
  onShowTimeline: () => void;
}

export function AgentProfileCard({
  agentId,
  profile,
  tools,
  status,
  palette,
  isActive,
  folderName,
  onClose,
  onShowTimeline,
}: AgentProfileCardProps) {
  // Update the uptime display every second
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), AGENT_PROFILE_UPTIME_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const uptime = now - profile.createdAt;
  const statusInfo = getStatusInfo(tools, status, isActive);
  const paletteColor = PALETTE_COLORS[palette] ?? PALETTE_COLORS[0];
  const recentTools = profile.toolHistory.slice(-AGENT_PROFILE_MAX_RECENT_TOOLS).reverse();

  // Current activity
  let currentActivity = 'Idle';
  if (tools && tools.length > 0) {
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) currentActivity = activeTool.status;
  }

  return (
    <div
      style={{
        position: 'absolute',
        right: 8,
        top: 40,
        zIndex: 60,
        width: 280,
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        boxShadow: 'var(--pixel-shadow)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.06)',
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '2px solid var(--pixel-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              background: paletteColor,
              border: '1px solid rgba(255, 255, 255, 0.3)',
              flexShrink: 0,
            }}
          />
          <div>
            <div
              style={{ fontSize: '24px', fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.95)' }}
            >
              Agent #{agentId}
            </div>
            {folderName && (
              <div style={{ fontSize: '16px', color: 'var(--pixel-text-dim)' }}>{folderName}</div>
            )}
          </div>
        </div>
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

      {/* Status & Stats */}
      <div style={{ padding: '8px 10px' }}>
        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: statusInfo.color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '20px', color: statusInfo.color, fontWeight: 'bold' }}>
            {statusInfo.label}
          </span>
        </div>

        {/* Current activity */}
        {currentActivity !== 'Idle' && (
          <div
            style={{
              fontSize: '18px',
              color: 'rgba(255, 255, 255, 0.7)',
              marginBottom: 8,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentActivity}
          </div>
        )}

        {/* Stats grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '4px 12px',
            marginBottom: 8,
            padding: '6px 8px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--pixel-border)',
          }}
        >
          <StatItem label="Uptime" value={formatUptime(uptime)} />
          <StatItem label="Tools Run" value={String(profile.totalToolsRun)} />
          <StatItem label="Turns" value={String(profile.turnsCompleted)} />
          <StatItem
            label="Tools/Turn"
            value={
              profile.turnsCompleted > 0
                ? (profile.totalToolsRun / profile.turnsCompleted).toFixed(1)
                : '—'
            }
          />
        </div>

        {/* Recent tools */}
        {recentTools.length > 0 && (
          <div>
            <div
              style={{
                fontSize: '18px',
                color: 'rgba(255, 255, 255, 0.5)',
                marginBottom: 4,
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              Recent Tools
            </div>
            <div
              style={{
                maxHeight: 120,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              {recentTools.map((entry, i) => (
                <RecentToolRow key={`${entry.startedAt}-${i}`} entry={entry} now={now} />
              ))}
            </div>
          </div>
        )}

        {/* View Timeline button */}
        {profile.toolHistory.length > 0 && (
          <button
            onClick={onShowTimeline}
            style={{
              width: '100%',
              marginTop: 8,
              padding: '5px 0',
              fontSize: '20px',
              background: 'rgba(255, 255, 255, 0.06)',
              color: 'var(--pixel-accent)',
              border: '1px solid var(--pixel-border)',
              borderRadius: 0,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.1)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.06)';
            }}
          >
            View Timeline →
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────── */

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.4)', textTransform: 'uppercase' }}
      >
        {label}
      </div>
      <div style={{ fontSize: '22px', color: 'rgba(255, 255, 255, 0.9)' }}>{value}</div>
    </div>
  );
}

function RecentToolRow({ entry, now }: { entry: ToolHistoryEntry; now: number }) {
  const ago = formatUptime(now - entry.startedAt);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: '18px',
        padding: '2px 4px',
        background: 'rgba(255, 255, 255, 0.02)',
      }}
    >
      <span style={{ flexShrink: 0 }}>{toolIcon(entry.toolName)}</span>
      <span
        style={{
          color: 'rgba(255, 255, 255, 0.7)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {entry.status}
      </span>
      <span style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '14px', flexShrink: 0 }}>
        {ago} ago
      </span>
    </div>
  );
}
