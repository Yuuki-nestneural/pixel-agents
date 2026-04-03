import type { ToolActivity } from '../office/types.js';

interface StatsBarProps {
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  questCount: number;
  completedQuestCount: number;
}

export function StatsBar({
  agents,
  agentTools,
  agentStatuses,
  questCount,
  completedQuestCount,
}: StatsBarProps) {
  const totalAgents = agents.length;
  const activeAgents = agents.filter(
    (id) => (agentTools[id]?.length ?? 0) > 0 || agentStatuses[id] === 'active',
  ).length;
  const idleAgents = totalAgents - activeAgents;

  if (totalAgents === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 45,
        display: 'flex',
        gap: 8,
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        padding: '3px 8px',
        boxShadow: 'var(--pixel-shadow)',
        fontSize: '18px',
        color: 'rgba(255, 255, 255, 0.7)',
        pointerEvents: 'none',
      }}
    >
      <span title="Total agents">
        <span style={{ color: 'var(--pixel-accent)' }}>●</span> {totalAgents}
      </span>
      <span style={{ color: 'rgba(255, 255, 255, 0.3)' }}>|</span>
      <span title="Active agents" style={{ color: '#2ecc71' }}>
        ▶ {activeAgents}
      </span>
      <span title="Idle agents" style={{ color: 'rgba(255, 255, 255, 0.4)' }}>
        ◼ {idleAgents}
      </span>
      {questCount > 0 && (
        <>
          <span style={{ color: 'rgba(255, 255, 255, 0.3)' }}>|</span>
          <span title="Quests completed / total" style={{ color: '#f39c12' }}>
            📋 {completedQuestCount}/{questCount}
          </span>
        </>
      )}
    </div>
  );
}
