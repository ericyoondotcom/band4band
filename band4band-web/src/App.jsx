import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { wsClient } from './utils/websocket';
import Home from './components/Home';
import Lobby from './components/Lobby';
import VerseConfig from './components/VerseConfig';
import BattleArena from './components/BattleArena';

function GameFlow() {
  const [gameState, setGameState] = useState('HOME');
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayers] = useState([]);
  const [settings, setSettings] = useState({ numVerses: 8 });
  const [battleSequence, setBattleSequence] = useState([]);
  const [beatSeed, setBeatSeed] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [versesGenerated, setVersesGenerated] = useState(0);
  const [audioGenerated, setAudioGenerated] = useState(0);

  useEffect(() => {
    const unsubRoom = wsClient.on('ROOM_CREATED', (data) => {
      setRoomCode(data.code);
      setGameState('LOBBY');
    });

    const unsubState = wsClient.on('STATE_UPDATE', (data) => {
      setGameState(data.state);
      setPlayers(data.players);
      if (data.settings) {
        setSettings(data.settings);
      }
    });

    const unsubReady = wsClient.on('GAME_READY', (data) => {
      setBattleSequence(data.sequence);
      setBeatSeed(data.beatSeed);
      setGameState('PLAYING');
    });

    const unsubError = wsClient.on('ERROR', (data) => {
      alert("Error: " + data.message);
    });

    const unsubProgress = wsClient.on('GENERATION_PROGRESS', (data) => {
      setVersesGenerated(data.versesGenerated);
      setAudioGenerated(data.audioGenerated);
    });

    const unsubDisconnect = wsClient.on('DISCONNECT', () => {
      alert("Disconnected.");
      setGameState('HOME');
      setRoomCode('');
      setPlayers([]);
      setBattleSequence([]);
      setVersesGenerated(0);
      setAudioGenerated(0);
    });

    return () => {
      unsubRoom();
      unsubState();
      unsubReady();
      unsubError();
      unsubProgress();
      unsubDisconnect();
    };
  }, []);

  const totalSteps = (settings.numVerses || 8) * 2;
  const versesPct = Math.round((versesGenerated / totalSteps) * 100);
  const audioPct = Math.round((audioGenerated / totalSteps) * 100);

  return (
    <div className="app-shell">
      <button
        className="mute-btn"
        onClick={() => setIsMuted(!isMuted)}
        title="Toggle Mute"
      >
        {isMuted ? '🔇' : '🔊'}
      </button>

      {gameState === 'HOME' && <Home setGameState={setGameState} setRoomCode={setRoomCode} />}
      {gameState === 'LOBBY' && <Lobby roomCode={roomCode} players={players} settings={settings} />}
      {gameState === 'CONFIG' && <VerseConfig players={players} settings={settings} />}
      {gameState === 'GENERATING' && (
        <div className="gen-screen">
          <h1 className="glitch-text" data-text="COOKING">COOKING</h1>

          <div className="gen-bars">
            <div className="gen-row">
              <span>BARS</span>
              <div className="progress-bar">
                <div className="progress-fill p1-bg" style={{ width: `${versesPct}%` }} />
              </div>
              <span className="gen-count">{versesGenerated}/{totalSteps}</span>
            </div>
            <div className="gen-row">
              <span>VOICE</span>
              <div className="progress-bar">
                <div className="progress-fill p2-bg" style={{ width: `${audioPct}%` }} />
              </div>
              <span className="gen-count">{audioGenerated}/{totalSteps}</span>
            </div>
          </div>
        </div>
      )}
      {gameState === 'PLAYING' && <BattleArena sequence={battleSequence} players={players} isMuted={isMuted} beatSeed={beatSeed} />}
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
