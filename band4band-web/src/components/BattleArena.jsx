import { useState, useEffect, useRef } from 'react';

export default function BattleArena({ sequence, players }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentVerseIdx, setCurrentVerseIdx] = useState(-1);
  const [currentLineIdx, setCurrentLineIdx] = useState(-1);
  const audioRef = useRef(null);
  
  // Flatten sequence into an array of lines to speak, with timing logic
  const startBattle = async () => {
    setIsPlaying(true);
    
    let activeBeat = { file: '/beat1.mp3', bpm: 90, introOffsetSeconds: 0 };
    try {
      const res = await fetch('/beats.json');
      if (res.ok) {
        const beats = await res.json();
        if (beats && beats.length > 0) {
          activeBeat = beats[Math.floor(Math.random() * beats.length)];
        }
      }
    } catch (e) {
      console.warn("Failed to load beats.json", e);
    }
    
    try {
      audioRef.current = new Audio(activeBeat.file);
      audioRef.current.loop = true;
      audioRef.current.volume = 0.5;
      await audioRef.current.play().catch(e => console.warn("Audio playback failed (maybe no file or autoplay blocked):", e));
    } catch (e) {
      console.warn("Audio setup failed:", e);
    }

    const bpm = activeBeat.bpm;
    const bps = bpm / 60;
    const barDurationMs = (4 / bps) * 1000;

    // Intro delay based on the JSON configuration
    const offsetMs = (activeBeat.introOffsetSeconds || 0) * 1000;
    if (offsetMs > 0) {
      await new Promise(resolve => setTimeout(resolve, offsetMs));
    }

    for (let vIdx = 0; vIdx < sequence.length; vIdx++) {
      setCurrentVerseIdx(vIdx);
      const verseData = sequence[vIdx];
      
      // Clean up markdown/newlines and split into exactly 4 lines
      const lines = verseData.verse.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      for (let lIdx = 0; lIdx < Math.min(4, lines.length); lIdx++) {
        setCurrentLineIdx(lIdx);
        
        // Speak using Web Speech API
        const utterance = new SpeechSynthesisUtterance(lines[lIdx]);
        
        // Find a decent voice
        const voices = window.speechSynthesis.getVoices();
        // Give each player a distinct voice if possible (using hash of playerId)
        const voiceHash = verseData.playerId.split('').reduce((a,b)=>a+b.charCodeAt(0), 0);
        if (voices.length > 0) {
          utterance.voice = voices[voiceHash % voices.length];
        }
        
        utterance.rate = 1.2; // Rap a bit faster
        utterance.pitch = 0.8 + ((voiceHash % 10) / 20); // slightly different pitch

        window.speechSynthesis.speak(utterance);

        // Wait 1 bar before next line
        await new Promise(resolve => setTimeout(resolve, barDurationMs));
      }
    }

    // Outro
    setCurrentVerseIdx(-1);
    setCurrentLineIdx(-1);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
    }
  };

  useEffect(() => {
    // Ensure voices are loaded
    window.speechSynthesis.getVoices();
  }, []);

  if (!isPlaying && currentVerseIdx === -1) {
    return (
      <div className="flex-col flex-center glass-panel" style={{ margin: 'auto' }}>
        <h1 style={{ fontSize: '5rem' }}>BATTLE READY</h1>
        <p style={{ opacity: 0.8, marginBottom: '2rem' }}>The beats are loaded. The verses are written.</p>
        <button className="primary" style={{ fontSize: '2rem', padding: '1rem 3rem' }} onClick={startBattle}>
          PLAY BATTLE
        </button>
      </div>
    );
  }

  const activeVerse = sequence[currentVerseIdx];
  const lines = activeVerse ? activeVerse.verse.split('\n').map(l => l.trim()).filter(l => l.length > 0) : [];

  return (
    <div className="flex-col flex-center" style={{ margin: 'auto', width: '100%' }}>
      {activeVerse ? (
        <>
          <div style={{ marginBottom: '4rem', textAlign: 'center' }}>
            <h2 style={{ fontSize: '3rem', margin: 0 }}>{activeVerse.nickname}</h2>
            <p style={{ opacity: 0.6, fontSize: '1.2rem', textTransform: 'uppercase' }}>is spitting...</p>
          </div>

          <div className="flex-col gap-4 text-center">
            {lines.map((line, idx) => (
              <div 
                key={idx} 
                className={`lyric-line ${idx === currentLineIdx ? 'active' : ''}`}
                style={{ 
                  color: idx === currentLineIdx ? '#fff' : 'rgba(255,255,255,0.3)',
                  transform: idx === currentLineIdx ? 'scale(1.1)' : 'scale(1)',
                  transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-center">
          <h1 style={{ fontSize: '6rem' }}>GAME OVER</h1>
        </div>
      )}
    </div>
  );
}
