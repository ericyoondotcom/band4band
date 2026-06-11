import { useState } from 'react';
import { wsClient } from '../utils/websocket';

export default function Home({ setGameState, setRoomCode }) {
  const [joinCode, setJoinCode] = useState('');

  const handleHost = async () => {
    try {
      await wsClient.connect('ws://localhost:8080?action=host');
    } catch (e) {
      alert("Failed to connect to backend");
    }
  };

  const handleJoin = async () => {
    if (joinCode.length !== 6) {
      alert("Code must be 6 letters");
      return;
    }
    try {
      await wsClient.connect(`ws://localhost:8080?action=join&code=${joinCode.toUpperCase()}`);
      setRoomCode(joinCode.toUpperCase());
      setGameState('LOBBY');
    } catch (e) {
      alert("Failed to connect or room not found");
    }
  };

  return (
    <div className="flex-col flex-center glass-panel" style={{ margin: 'auto', maxWidth: '600px' }}>
      <h1>Band4Band</h1>
      <p style={{ marginBottom: '2rem', opacity: 0.8 }}>Spit fire using your actual bank account.</p>
      
      <div className="flex-col gap-8" style={{ width: '100%' }}>
        <div className="glass-panel text-center">
          <h2>Host a Game</h2>
          <button className="primary" onClick={handleHost}>Create Room</button>
        </div>
        
        <div className="glass-panel text-center">
          <h2>Join a Game</h2>
          <div className="flex-col gap-4 mt-4">
            <input 
              type="text" 
              placeholder="Enter 6-letter code" 
              value={joinCode}
              onChange={e => setJoinCode(e.target.value)}
              maxLength={6}
              style={{ textTransform: 'uppercase', textAlign: 'center', letterSpacing: '4px', fontWeight: 'bold' }}
            />
            <button className="secondary" onClick={handleJoin}>Join Room</button>
          </div>
        </div>
      </div>
    </div>
  );
}
