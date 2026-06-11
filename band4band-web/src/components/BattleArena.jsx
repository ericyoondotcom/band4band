import { useState, useEffect, useRef } from 'react';
import { wsClient } from '../utils/websocket';

export default function BattleArena({ sequence, players, isMuted, beatSeed }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [currentVerseIdx, setCurrentVerseIdx] = useState(-1);
  const [currentLineIdx, setCurrentLineIdx] = useState(-1);
  const audioRef = useRef(null);
  const isMutedRef = useRef(isMuted);
  // Keep a ref to the latest sequence so startBattle never reads stale closure data
  const sequenceRef = useRef(sequence);

  useEffect(() => {
    sequenceRef.current = sequence;
  }, [sequence]);

  useEffect(() => {
    isMutedRef.current = isMuted;
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  useEffect(() => {
    const unsub = wsClient.on('START_PLAYBACK', () => {
      startBattle();
    });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Flatten sequence into an array of lines to speak, with timing logic
  const startBattle = async () => {
    const seq = sequenceRef.current;
    console.log('[BattleArena] startBattle called. sequence length:', seq?.length);

    if (!seq || seq.length === 0) {
      console.error('[BattleArena] No sequence data available!');
      return;
    }

    // Create Audio objects now, at play time, from the latest sequence
    const verseAudios = seq.map((verseObj, i) => {
      if (!verseObj.audioData) {
        console.warn(`[BattleArena] Verse ${i} (${verseObj.nickname}) has no audioData!`);
        return null;
      }
      console.log(`[BattleArena] Verse ${i} audioData prefix:`, verseObj.audioData.substring(0, 40));
      const a = new Audio(verseObj.audioData);
      a.muted = isMutedRef.current;
      return a;
    });

    setIsPlaying(true);
    
    let activeBeat = { file: '/beat1.mp3', bpm: 90, introOffsetSeconds: 0 };
    try {
      const res = await fetch('/beats.json');
      if (res.ok) {
        const beats = await res.json();
        if (beats && beats.length > 0) {
          activeBeat = beats[Math.floor((beatSeed !== undefined ? beatSeed : Math.random()) * beats.length)];
          console.log('[BattleArena] Selected beat:', activeBeat.file, 'bpm:', activeBeat.bpm);
        }
      }
    } catch (e) {
      console.warn("Failed to load beats.json", e);
    }
    
    try {
      audioRef.current = new Audio(activeBeat.file);
      audioRef.current.loop = true;
      audioRef.current.volume = 0.5;
      audioRef.current.muted = isMutedRef.current;
      await audioRef.current.play().catch(e => console.warn("Beat playback failed:", e));
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

    let previousAudio = null;

    for (let vIdx = 0; vIdx < seq.length; vIdx++) {
      setCurrentVerseIdx(vIdx);
      const verseData = seq[vIdx];
      const lines = verseData.lines;

      if (previousAudio) {
        previousAudio.pause();
        previousAudio.currentTime = 0;
      }
      previousAudio = verseAudios[vIdx];
      
      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        setCurrentLineIdx(lIdx);
        
        if (lIdx === 0) {
          const a = verseAudios[vIdx];
          if (a) {
            if (isMutedRef.current) {
              console.log(`[BattleArena] Verse ${vIdx}: muted, skipping TTS play`);
            } else {
              console.log(`[BattleArena] Verse ${vIdx}: playing TTS audio`);
              a.play().catch(e => console.warn("TTS playback blocked:", e));
            }
          } else {
            console.warn(`[BattleArena] Verse ${vIdx}: no Audio object, cannot play TTS`);
          }
        }

        // Wait 1 bar before next line
        await new Promise(resolve => setTimeout(resolve, barDurationMs));
      }
    }

    // Outro
    setIsPlaying(false);
    setIsFinished(true);
    if (audioRef.current) {
      const fadeAudio = audioRef.current;
      const fadeSteps = 50;
      const fadeInterval = 5000 / fadeSteps; // 5 seconds total
      const initialVol = fadeAudio.volume;
      const volStep = initialVol / fadeSteps;
      let currentStep = 0;
      
      const fadeOutTimer = setInterval(() => {
        currentStep++;
        if (currentStep >= fadeSteps) {
          clearInterval(fadeOutTimer);
          fadeAudio.pause();
        } else {
          fadeAudio.volume = Math.max(0, initialVol - (volStep * currentStep));
        }
      }, fadeInterval);
    }
  };



  if (!isPlaying && !isFinished && currentVerseIdx === -1) {
    return (
      <div className="flex-col flex-center glass-panel" style={{ margin: 'auto' }}>
        <h1 style={{ fontSize: '5rem' }}>BATTLE READY</h1>
        <p style={{ opacity: 0.8, marginBottom: '2rem' }}>The beats are loaded. The verses are written.</p>
        <button 
          className="primary" 
          style={{ fontSize: '2rem', padding: '1rem 3rem' }} 
          onClick={() => wsClient.send({ type: 'START_PLAYBACK' })}
        >
          PLAY BATTLE
        </button>
      </div>
    );
  }

  const activeVerse = sequence[currentVerseIdx];
  const lines = activeVerse ? activeVerse.lines : [];

  const isPlayer1 = currentVerseIdx % 2 === 0;

  const LyricsSide = (
    <div className={`battle-half ${isPlayer1 ? 'left-side' : 'right-side'}`}>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '3rem', margin: 0 }}>{activeVerse?.nickname}</h2>
        <p style={{ opacity: 0.6, fontSize: '1.2rem', textTransform: 'uppercase' }}>is spitting...</p>
      </div>

      <div className="flex-col gap-4">
        {lines.map((line, idx) => (
          <div 
            key={idx} 
            className={`lyric-line ${idx === currentLineIdx ? 'active' : ''}`}
            style={{ 
              color: idx === currentLineIdx ? '#fff' : 'rgba(255,255,255,0.3)',
              transform: idx === currentLineIdx ? 'scale(1.1)' : 'scale(1)',
              transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
              transformOrigin: isPlayer1 ? 'left center' : 'right center'
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );

  const FactCheckSide = (
    <div className={`battle-half ${!isPlayer1 ? 'left-side' : 'right-side'}`}>
      {activeVerse?.context && (
        <div className="fact-check-popup" style={{ margin: isPlayer1 ? '0 auto 0 0' : '0 0 0 auto' }}>
          <h3>FACT CHECK</h3>
          {activeVerse.context.type === 'NET_WORTH' && (
            <>
              <h4 style={{ opacity: 0.8, marginTop: '1rem', marginBottom: '0.5rem' }}>Net Worth</h4>
              <div className="fact-check-value number">
                ${Math.abs(activeVerse.context.data).toLocaleString()}
              </div>
            </>
          )}
          {activeVerse.context.type === 'PURCHASES' && (
            <>
              <h4 style={{ opacity: 0.8, marginTop: '1rem', marginBottom: '0.5rem' }}>Recent Purchases</h4>
              <ul className="fact-check-list">
                {activeVerse.context.data.map((item, i) => <li key={i}>{item.name} - ${Math.round(item.amount).toLocaleString()}</li>)}
              </ul>
            </>
          )}
          {activeVerse.context.type === 'INCOME' && (
            <>
              <h4 style={{ opacity: 0.8, marginTop: '1rem', marginBottom: '0.5rem' }}>Income Sources</h4>
              <ul className="fact-check-list">
                {activeVerse.context.data.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </>
          )}
          {activeVerse.context.type === 'SPENDING_HABITS' && (
            <>
              <h4 style={{ opacity: 0.8, marginTop: '1rem', marginBottom: '0.5rem' }}>Top Spending Categories</h4>
              <ul className="fact-check-list">
                {activeVerse.context.data.map((item, i) => <li key={i}>{item.category} - ${Math.round(item.amount).toLocaleString()}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-col flex-center" style={{ margin: 'auto', width: '100%', height: '100%' }}>
      {isFinished ? (
        <div className="text-center">
          <h1 style={{ fontSize: '6rem' }}>WHO WON?</h1>
        </div>
      ) : isPlaying && currentVerseIdx === -1 ? (
        <div className="text-center animate-float">
          <h1 style={{ fontSize: '6rem', letterSpacing: '4px' }}>GET HYPE</h1>
          <p style={{ opacity: 0.8, fontSize: '1.5rem', textTransform: 'uppercase' }}>Beat dropping soon...</p>
        </div>
      ) : activeVerse ? (
        <div className="battle-layout">
          {isPlayer1 ? (
            <>
              {LyricsSide}
              {FactCheckSide}
            </>
          ) : (
            <>
              {FactCheckSide}
              {LyricsSide}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
