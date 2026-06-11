import { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { wsClient } from '../utils/websocket';

export default function Lobby({ roomCode, players, settings }) {
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [linkToken, setLinkToken] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [localTokensCount, setLocalTokensCount] = useState(() => 
    JSON.parse(localStorage.getItem('plaid_access_tokens') || '[]').length
  );

  const fetchLinkToken = useCallback(() => {
    const clientUserId = 'user_' + Math.random().toString(36).substr(2, 9);
    fetch('http://localhost:8080/create_link_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientUserId }),
    })
      .then(res => res.json())
      .then(data => setLinkToken(data.link_token))
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchLinkToken();

    const cachedTokens = JSON.parse(localStorage.getItem('plaid_access_tokens') || '[]');
    if (cachedTokens.length > 0) {
      wsClient.send({
        type: 'RESTORE_ACCESS_TOKENS',
        accessTokens: cachedTokens
      });
    }

    const unsub = wsClient.on('TOKEN_EXCHANGED', (data) => {
      if (data.accessToken) {
        const currentTokens = JSON.parse(localStorage.getItem('plaid_access_tokens') || '[]');
        if (!currentTokens.includes(data.accessToken)) {
          currentTokens.push(data.accessToken);
          localStorage.setItem('plaid_access_tokens', JSON.stringify(currentTokens));
          setLocalTokensCount(currentTokens.length);
        }
      }
    });

    return () => unsub();
  }, [fetchLinkToken]);

  const onSuccess = useCallback((public_token) => {
    wsClient.send({
      type: 'EXCHANGE_PUBLIC_TOKEN',
      publicToken: public_token,
    });
    fetchLinkToken();
  }, [fetchLinkToken]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  const handleSaveProfile = () => {
    if (!name || !nickname) {
      alert("Need name + rapper name");
      return;
    }
    wsClient.send({ type: 'SET_PROFILE', name, nickname });
  };

  const handleSetReady = () => {
    wsClient.send({ type: 'SET_READY' });
    setIsReady(true);
  };

  const myProfileSaved = name && nickname;
  const isHost = players.find(p => p.isHost && p.nickname === nickname);

  return (
    <div className="lobby-screen">
      <div className="room-code-display">
        <span className="room-code-label">ROOM</span>
        <h1 className="room-code">{roomCode}</h1>
      </div>

      <div className="lobby-grid">
        {/* Profile Card */}
        <div className="card p1-accent">
          <h3>YOU</h3>
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Rapper name"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
          />
          <button className="secondary" onClick={handleSaveProfile}>SAVE</button>
        </div>

        {/* Bank Link Card */}
        <div className="card p2-accent">
          <h3>BANK</h3>
          <button
            className="primary"
            onClick={() => open()}
            disabled={!ready}
          >
            LINK ACCOUNT
          </button>
          {localTokensCount > 0 && (
            <div className="tag mt-4" style={{ alignSelf: 'flex-start' }}>
              {localTokensCount} {localTokensCount === 1 ? 'ACCOUNT' : 'ACCOUNTS'} LINKED 🏦
            </div>
          )}
        </div>
      </div>

      {/* Player Status */}
      <div className="players-status">
        {players.map((p, idx) => (
          <div key={idx} className={`player-row ${idx === 0 ? 'p1-border' : 'p2-border'}`}>
            <div className="player-info">
              <span className="player-name">{p.nickname || '???'}</span>
              {p.isHost && <span className="tag">HOST</span>}
            </div>
            <div className="player-stats">
              <span className="tag">{p.linkedCount || 0} 🏦</span>
              <span className={`tag ${p.isReady ? 'tag-ready' : 'tag-waiting'}`}>
                {p.isReady ? '✓' : '...'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Settings */}
      {isHost ? (
        <div className="settings-row">
          <span>ROUNDS</span>
          <select
            value={settings?.numVerses || 8}
            onChange={(e) => wsClient.send({ type: 'SET_SETTINGS', numVerses: parseInt(e.target.value) })}
          >
            <option value={4}>4</option>
            <option value={6}>6</option>
            <option value={8}>8</option>
            <option value={10}>10</option>
          </select>
        </div>
      ) : (
        <div className="settings-row">
          <span>ROUNDS</span>
          <span className="settings-value">{settings?.numVerses || 8}</span>
        </div>
      )}

      {/* Ready Button */}
      <button
        className={`primary big ready-btn ${isReady ? 'locked' : ''}`}
        onClick={handleSetReady}
        disabled={!myProfileSaved || isReady}
      >
        {isReady ? 'LOCKED IN' : 'READY'}
      </button>
    </div>
  );
}
