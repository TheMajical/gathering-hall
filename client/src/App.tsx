import React, { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useGame } from './api/socket.js';
import Home from './pages/Home.js';
import Room from './pages/Room.js';

/** Any render crash shows a readable panel instead of a blank white page. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="center-page">
          <div className="panel" style={{ maxWidth: 520, textAlign: 'center' }}>
            <h2>Something broke on this screen</h2>
            <p className="muted" style={{ wordBreak: 'break-word' }}>{this.state.error.message}</p>
            <button className="btn primary" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App(): React.JSX.Element {
  const { error, clearError, connected } = useGame();
  const [everConnected, setEverConnected] = useState(false);

  useEffect(() => {
    if (connected) setEverConnected(true);
  }, [connected]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 4000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  return (
    <ErrorBoundary>
      {!connected && everConnected && (
        <div className="conn-banner">⚠ Connection lost — reconnecting… (your seat and the game are safe)</div>
      )}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:code" element={<Room />} />
      </Routes>
      {error && <div className="toast">{error}</div>}
    </ErrorBoundary>
  );
}
