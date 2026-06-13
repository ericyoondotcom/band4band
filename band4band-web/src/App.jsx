import { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { wsClient } from './utils/websocket';
import { WS_URL } from './utils/env';
import Home from './components/Home';
import Lobby from './components/Lobby';
import VerseConfig from './components/VerseConfig';
import BattleArena from './components/BattleArena';

function GameFlow() {
  const navigate = useNavigate();
  const { roomCodeParam } = useParams();
  const connectingTo = useRef(null);
  const [gameState, setGameState] = useState('HOME');
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayers] = useState([]);
  const [settings, setSettings] = useState({ numVerses: 8 });
  const [battleSequence, setBattleSequence] = useState([]);
  const [beatSeed, setBeatSeed] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [versesGenerated, setVersesGenerated] = useState(0);
  const [audioGenerated, setAudioGenerated] = useState(0);
  const [reconnectStatus, setReconnectStatus] = useState(null); // null | { attempt, maxRetries }

  useEffect(() => {
    if (!roomCodeParam) {
      connectingTo.current = null;
    } else if (gameState === 'HOME' && connectingTo.current !== roomCodeParam) {
      connectingTo.current = roomCodeParam;
      const joinRoom = async () => {
        try {
          await wsClient.connect(`${WS_URL}?action=join&code=${roomCodeParam.toUpperCase()}`);
          setRoomCode(roomCodeParam.toUpperCase());
          setGameState('LOBBY');
        } catch (e) {
          alert("Failed to connect or room not found");
          connectingTo.current = null;
          navigate('/', { replace: true });
        }
      };
      joinRoom();
    }
  }, [roomCodeParam, gameState, navigate]);

  useEffect(() => {
    const unsubRoom = wsClient.on('ROOM_CREATED', (data) => {
      setRoomCode(data.code);
      setGameState('LOBBY');
      navigate(`/${data.code}`, { replace: true });
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

    // ── Reconnection events ────────────────────────────────────────────────

    const unsubReconnecting = wsClient.on('RECONNECTING', (data) => {
      setReconnectStatus({ attempt: data.attempt, maxRetries: data.maxRetries });
    });

    const unsubReconnected = wsClient.on('RECONNECTED', (data) => {
      // Server sends full current state on reconnect
      setReconnectStatus(null);
      setRoomCode(data.roomCode || roomCode);

      if (data.state) setGameState(data.state);
      if (data.settings) setSettings(data.settings);

      // If already in PLAYING state, restore the battle sequence
      if (data.state === 'PLAYING' && data.sequence) {
        setBattleSequence(data.sequence);
        setBeatSeed(data.beatSeed);
      }
    });

    const unsubReconnectSuccess = wsClient.on('RECONNECT_SUCCESS', () => {
      setReconnectStatus(null);
    });

    const unsubOpponentDisconnected = wsClient.on('OPPONENT_DISCONNECTED', (data) => {
      setReconnectStatus({ opponentWaiting: true, gracePeriodMs: data.gracePeriodMs });
    });

    const unsubRoomDestroyed = wsClient.on('ROOM_DESTROYED', () => {
      // Server explicitly told us the room is gone — reset cleanly
      setReconnectStatus(null);
      setGameState('HOME');
      setRoomCode('');
      setPlayers([]);
      setBattleSequence([]);
      setVersesGenerated(0);
      setAudioGenerated(0);
      navigate('/', { replace: true });
    });

    // Final disconnect — all retries exhausted or intentional close
    const unsubDisconnect = wsClient.on('DISCONNECT', () => {
      setReconnectStatus(null);
      setGameState('HOME');
      setRoomCode('');
      setPlayers([]);
      setBattleSequence([]);
      setVersesGenerated(0);
      setAudioGenerated(0);
      navigate('/', { replace: true });
    });

    return () => {
      unsubRoom();
      unsubState();
      unsubReady();
      unsubError();
      unsubProgress();
      unsubReconnecting();
      unsubReconnected();
      unsubReconnectSuccess();
      unsubOpponentDisconnected();
      unsubRoomDestroyed();
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

      {/* ── Reconnection / opponent-disconnect banner ── */}
      {reconnectStatus && (
        <div className="reconnect-banner">
          {reconnectStatus.opponentWaiting ? (
            <span>⚠️ Opponent disconnected — waiting for them to reconnect…</span>
          ) : (
            <span>
              🔄 Reconnecting… (attempt {reconnectStatus.attempt}/{reconnectStatus.maxRetries})
            </span>
          )}
        </div>
      )}

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
        <Route path="/:roomCodeParam?" element={<GameFlow />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
