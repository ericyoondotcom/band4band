import { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { wsClient } from '../utils/websocket';

export default function Lobby({ roomCode, players, settings }) {
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [linkToken, setLinkToken] = useState(null);
  const [isReady, setIsReady] = useState(false);

  // Function to fetch a new link token
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

  // Fetch initial token and restore cached tokens
  useEffect(() => {
    fetchLinkToken();

    // Check localStorage for existing tokens
    const cachedTokens = JSON.parse(localStorage.getItem('plaid_access_tokens') || '[]');
    if (cachedTokens.length > 0) {
      wsClient.send({
        type: 'RESTORE_ACCESS_TOKENS',
        accessTokens: cachedTokens
      });
    }

    // Listen for new tokens to cache them
    const unsub = wsClient.on('TOKEN_EXCHANGED', (data) => {
      if (data.accessToken) {
        const currentTokens = JSON.parse(localStorage.getItem('plaid_access_tokens') || '[]');
        if (!currentTokens.includes(data.accessToken)) {
          currentTokens.push(data.accessToken);
          localStorage.setItem('plaid_access_tokens', JSON.stringify(currentTokens));
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
    // Fetch a new token so the user can link another bank if they want
    fetchLinkToken();
  }, [fetchLinkToken]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  const handleSaveProfile = () => {
    if (!name || !nickname) {
      alert("Please enter Name and Rapper Nickname");
      return;
    }
    wsClient.send({
      type: 'SET_PROFILE',
      name,
      nickname
    });
  };

  const handleSetReady = () => {
    wsClient.send({ type: 'SET_READY' });
    setIsReady(true);
  };

  // Find my own player data from the server's list to see how many banks I've linked
  // We don't strictly have a "myId", but we can just show the status of all players
  const myProfileSaved = name && nickname;

  return (
    <div className="flex-col flex-center glass-panel" style={{ margin: 'auto', maxWidth: '800px', width: '100%' }}>
      <h1>Lobby</h1>
      <div className="glass-panel text-center mb-8" style={{ width: '100%', marginBottom: '2rem' }}>
        <p style={{ opacity: 0.8, fontSize: '1.2rem' }}>Room Code</p>
        <h2 style={{ fontSize: '4rem', margin: 0, letterSpacing: '8px' }}>{roomCode}</h2>
      </div>

      <div className="grid-2" style={{ width: '100%' }}>
        <div className="glass-panel flex-col gap-4">
          <h3>Your Profile</h3>
          <input 
            type="text" 
            placeholder="Real Name (e.g. John)" 
            value={name} 
            onChange={e => setName(e.target.value)} 
          />
          <input 
            type="text" 
            placeholder="Rapper Nickname (e.g. J-Money)" 
            value={nickname} 
            onChange={e => setNickname(e.target.value)} 
          />
          <button className="secondary" onClick={handleSaveProfile}>Save Profile</button>
        </div>

        <div className="glass-panel flex-col gap-4 flex-center text-center">
          <h3>Link Bank(s)</h3>
          <p style={{ opacity: 0.8 }}>Connect your bank accounts and credit cards.</p>
          <button 
            className="primary" 
            onClick={() => open()} 
            disabled={!ready}
          >
            Connect Plaid
          </button>
        </div>
      </div>

      <div className="mt-8 text-center glass-panel" style={{ width: '100%' }}>
        <h3>Player Status</h3>
        <div className="flex-col gap-4 mt-4">
          {players.map((p, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
              <span>{p.nickname || 'Unknown Player'} {p.isHost ? '(Host)' : ''}</span>
              <span>Banks Linked: {p.linkedCount || 0}</span>
              <span style={{ color: p.isReady ? '#4ade80' : '#f87171' }}>
                {p.isReady ? 'READY' : 'NOT READY'}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-8 text-center glass-panel" style={{ width: '100%', background: 'rgba(0,0,0,0.4)' }}>
          <h3>Game Settings</h3>
          <div className="flex-center mt-4">
            {players.find(p => p.isHost && p.nickname === nickname) ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ fontSize: '1.2rem' }}>Number of Verses (Per Player):</span>
                <select 
                  value={settings?.numVerses || 8} 
                  onChange={(e) => wsClient.send({ type: 'SET_SETTINGS', numVerses: parseInt(e.target.value) })}
                  style={{ padding: '0.5rem', background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '1.2rem' }}
                >
                  <option value={4}>4 Verses</option>
                  <option value={6}>6 Verses</option>
                  <option value={8}>8 Verses</option>
                  <option value={10}>10 Verses</option>
                </select>
              </div>
            ) : (
              <div style={{ fontSize: '1.2rem' }}>
                Number of Verses (Per Player): <strong>{settings?.numVerses || 8}</strong> <span style={{ opacity: 0.6 }}>(Host is configuring)</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8">
          <button 
            className="primary" 
            onClick={handleSetReady}
            disabled={!myProfileSaved || isReady}
            style={{ fontSize: '1.5rem', padding: '1rem 3rem' }}
          >
            {isReady ? 'WAITING FOR OPPONENT...' : 'READY TO BATTLE'}
          </button>
          {!myProfileSaved && <p style={{ color: '#f87171', marginTop: '1rem' }}>Save your profile and link at least 1 bank first.</p>}
        </div>
      </div>
    </div>
  );
}
