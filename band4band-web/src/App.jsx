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
      alert("Disconnected from server. Game over.");
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
      <button 
        onClick={() => setIsMuted(!isMuted)} 
        style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'transparent', border: 'none', fontSize: '2rem', cursor: 'pointer', zIndex: 1000 }}
        title="Toggle Mute"
      >
        {isMuted ? '🔇' : '🔊'}
      </button>

      {gameState === 'HOME' && <Home setGameState={setGameState} setRoomCode={setRoomCode} />}
      {gameState === 'LOBBY' && <Lobby roomCode={roomCode} players={players} settings={settings} />}
      {gameState === 'CONFIG' && <VerseConfig players={players} settings={settings} />}
      {gameState === 'GENERATING' && (
        <div className="flex-col flex-center glass-panel animate-float" style={{ margin: 'auto', maxWidth: '600px', width: '100%' }}>
          <h2>Spitting bars with Gemini...</h2>
          <p style={{ opacity: 0.8, marginBottom: '2rem' }}>Please wait while the AI writes the ultimate diss tracks.</p>

          <div style={{ width: '100%', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span>Writing Verses</span>
              <span>{versesGenerated} / {settings.numVerses * 2}</span>
            </div>
            <div style={{ width: '100%', background: 'rgba(255,255,255,0.1)', height: '12px', borderRadius: '6px', overflow: 'hidden' }}>
              <div style={{ width: `${(versesGenerated / (settings.numVerses * 2)) * 100}%`, background: 'var(--theme-main)', height: '100%', transition: 'width 0.3s' }} />
            </div>
          </div>

          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span>Synthesizing Vocals</span>
              <span>{audioGenerated} / {settings.numVerses * 2}</span>
            </div>
            <div style={{ width: '100%', background: 'rgba(255,255,255,0.1)', height: '12px', borderRadius: '6px', overflow: 'hidden' }}>
              <div style={{ width: `${(audioGenerated / (settings.numVerses * 2)) * 100}%`, background: 'var(--theme-main)', height: '100%', transition: 'width 0.3s' }} />
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
