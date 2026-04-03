import { useState } from 'react';

import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { vscode } from '../vscodeApi.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  alwaysShowOverlay: boolean;
  onToggleAlwaysShowOverlay: () => void;
  externalAssetDirectories: string[];
  autoPilotEnabled: boolean;
  autoPilotMessages: string[];
}

const menuItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
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

export function SettingsModal({
  isOpen,
  onClose,
  isDebugMode,
  onToggleDebugMode,
  alwaysShowOverlay,
  onToggleAlwaysShowOverlay,
  externalAssetDirectories,
  autoPilotEnabled,
  autoPilotMessages,
}: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);
  const [apLocal, setApLocal] = useState(autoPilotEnabled);
  const [apMessagesLocal, setApMessagesLocal] = useState(autoPilotMessages.join('\n'));

  if (!isOpen) return null;

  return (
    <>
      {/* Dark backdrop — click to close */}
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
          minWidth: 200,
        }}
      >
        {/* Header with title and X button */}
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
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>Settings</span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
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
        {/* Menu items */}
        <button
          onClick={() => {
            vscode.postMessage({ type: 'openSessionsFolder' });
            onClose();
          }}
          onMouseEnter={() => setHovered('sessions')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sessions' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Open Sessions Folder
        </button>
        <button
          onClick={() => {
            vscode.postMessage({ type: 'exportLayout' });
            onClose();
          }}
          onMouseEnter={() => setHovered('export')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'export' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Export Layout
        </button>
        <button
          onClick={() => {
            vscode.postMessage({ type: 'importLayout' });
            onClose();
          }}
          onMouseEnter={() => setHovered('import')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'import' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Import Layout
        </button>
        <button
          onClick={() => {
            vscode.postMessage({ type: 'addExternalAssetDirectory' });
            onClose();
          }}
          onMouseEnter={() => setHovered('addAssets')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'addAssets' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Add Asset Directory
        </button>
        {externalAssetDirectories.map((dir) => (
          <div
            key={dir}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 10px',
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: '18px',
                color: 'rgba(255, 255, 255, 0.5)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 180,
              }}
              title={dir}
            >
              {dir.split(/[/\\]/).pop() ?? dir}
            </span>
            <button
              onClick={() =>
                vscode.postMessage({ type: 'removeExternalAssetDirectory', path: dir })
              }
              onMouseEnter={() => setHovered(`remove-${dir}`)}
              onMouseLeave={() => setHovered(null)}
              style={{
                background: hovered === `remove-${dir}` ? 'rgba(255, 80, 80, 0.2)' : 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 0,
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: '18px',
                cursor: 'pointer',
                padding: '1px 6px',
                flexShrink: 0,
              }}
            >
              X
            </button>
          </div>
        ))}
        <button
          onClick={() => {
            const newVal = !isSoundEnabled();
            setSoundEnabled(newVal);
            setSoundLocal(newVal);
            vscode.postMessage({ type: 'setSoundEnabled', enabled: newVal });
          }}
          onMouseEnter={() => setHovered('sound')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sound' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Sound Notifications</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: soundLocal ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {soundLocal ? 'X' : ''}
          </span>
        </button>
        <button
          onClick={() => {
            const newVal = !apLocal;
            setApLocal(newVal);
            vscode.postMessage({ type: 'setAutoPilotEnabled', enabled: newVal });
          }}
          onMouseEnter={() => setHovered('autopilot')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'autopilot' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Autopilot Mode</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: apLocal ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {apLocal ? 'X' : ''}
          </span>
        </button>
        {apLocal && (
          <div style={{ padding: '4px 10px' }}>
            <label
              style={{
                fontSize: '18px',
                color: 'rgba(255, 255, 255, 0.5)',
                display: 'block',
                marginBottom: 4,
              }}
            >
              Auto responses (one per line):
            </label>
            <textarea
              value={apMessagesLocal}
              onChange={(e) => setApMessagesLocal(e.target.value)}
              onBlur={() => {
                const lines = apMessagesLocal
                  .split('\n')
                  .map((s) => s.trim())
                  .filter((s) => s);
                vscode.postMessage({ type: 'setAutoPilotMessages', messages: lines });
              }}
              style={{
                width: '100%',
                height: 80,
                background: 'rgba(30, 30, 46, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 0,
                color: 'rgba(255, 255, 255, 0.8)',
                padding: '4px 6px',
                fontFamily: 'inherit',
                fontSize: '16px',
                resize: 'none',
              }}
              placeholder={'continue\nyes\nproceed'}
            />
          </div>
        )}
        <button
          onClick={onToggleAlwaysShowOverlay}
          onMouseEnter={() => setHovered('overlay')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'overlay' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Always Show Labels</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: alwaysShowOverlay ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {alwaysShowOverlay ? 'X' : ''}
          </span>
        </button>
        <button
          onClick={onToggleDebugMode}
          onMouseEnter={() => setHovered('debug')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'debug' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Debug View</span>
          {isDebugMode && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'rgba(90, 140, 255, 0.8)',
                flexShrink: 0,
              }}
            />
          )}
        </button>
      </div>
    </>
  );
}
