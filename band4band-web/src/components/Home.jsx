import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { wsClient } from '../utils/websocket';
import { WS_URL } from '../utils/env';

export default function Home({ setGameState, setRoomCode }) {
  const [joinCode, setJoinCode] = useState('');
  const navigate = useNavigate();

  const handleHost = async () => {
    try {
      await wsClient.connect(`${WS_URL}?action=host`);
    } catch (e) {
      alert("Failed to connect to backend");
    }
  };

  const handleJoin = () => {
    if (joinCode.length !== 6) {
      alert("Code must be 6 letters");
      return;
    }
    navigate(`/${joinCode.toUpperCase()}`);
  };

  return (
    <div className="home-screen">
      <div className="home-hero">
        <h1 className="glitch-text" data-text="BAND4BAND">BAND4BAND</h1>
        <p className="home-sub">link your bank. spit bars. settle it.</p>
      </div>

      <div className="home-actions">
        <button className="primary big" onClick={handleHost}>
          HOST
        </button>

        <div className="join-row">
          <input
            type="text"
            placeholder="ROOM CODE"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value)}
            maxLength={6}
            className="code-input"
          />
          <button className="secondary" onClick={handleJoin}>JOIN</button>
        </div>
      </div>
    </div>
  );
}
