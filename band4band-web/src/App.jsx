import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { wsClient } from './utils/websocket';
import Home from './components/Home';
import Lobby from './components/Lobby';
import VerseConfig from './components/VerseConfig';
import BattleArena from './components/BattleArena';

function GameFlow() {
  const [gameState, setGameState] = useState('HOME'); // HOME, LOBBY, CONFIG, GENERATING, PLAYING
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayers] = useState([]);
  const [battleSequence, setBattleSequence] = useState([]);

  useEffect(() => {
    const unsubRoom = wsClient.on('ROOM_CREATED', (data) => {
      setRoomCode(data.code);
      setGameState('LOBBY');
    });

    const unsubState = wsClient.on('STATE_UPDATE', (data) => {
      setGameState(data.state);
      setPlayers(data.players);
    });

    const unsubReady = wsClient.on('GAME_READY', (data) => {
      setBattleSequence(data.sequence);
      setGameState('PLAYING');
    });

    const unsubError = wsClient.on('ERROR', (data) => {
      alert("Error: " + data.message);
    });

    const unsubDisconnect = wsClient.on('DISCONNECT', () => {
      alert("Disconnected from server. Game over.");
      setGameState('HOME');
      setRoomCode('');
      setPlayers([]);
      setBattleSequence([]);
    });

    return () => {
      unsubRoom();
      unsubState();
      unsubReady();
      unsubError();
      unsubDisconnect();
    };
  }, []);

  // Dynamically set hue based on first player's name if available
  useEffect(() => {
    if (players.length > 0 && players[0].name) {
      const hash = players[0].name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const hue = hash % 360;
      document.documentElement.style.setProperty('--player-hue', hue);
    }
  }, [players]);

  return (
    <div className="container">
      {gameState === 'HOME' && <Home setGameState={setGameState} setRoomCode={setRoomCode} />}
      {gameState === 'LOBBY' && <Lobby roomCode={roomCode} players={players} />}
      {gameState === 'CONFIG' && <VerseConfig players={players} />}
      {gameState === 'GENERATING' && (
        <div className="flex-col flex-center glass-panel animate-float" style={{ margin: 'auto' }}>
          <h2>Spitting bars with Gemini...</h2>
          <p>Please wait while the AI writes the ultimate diss tracks.</p>
        </div>
      )}
      {gameState === 'PLAYING' && <BattleArena sequence={battleSequence} players={players} />}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<GameFlow />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
