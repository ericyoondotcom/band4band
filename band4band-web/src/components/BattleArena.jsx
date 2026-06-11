import { useState, useEffect, useRef } from 'react';
import { wsClient } from '../utils/websocket';

export default function BattleArena({ sequence, players, isMuted, beatSeed }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [currentVerseIdx, setCurrentVerseIdx] = useState(-1);
  const [currentLineIdx, setCurrentLineIdx] = useState(-1);
  const audioRef = useRef(null);
  const isMutedRef = useRef(isMuted);
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

  const startBattle = async () => {
    const seq = sequenceRef.current;
    console.log('[BattleArena] startBattle called. sequence length:', seq?.length);

    if (!seq || seq.length === 0) {
      console.error('[BattleArena] No sequence data available!');
      return;
    }

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

        await new Promise(resolve => setTimeout(resolve, barDurationMs));
      }
    }

    // Outro — fade beat over 5s
    setIsPlaying(false);
    setIsFinished(true);
    if (audioRef.current) {
      const fadeAudio = audioRef.current;
      const fadeSteps = 50;
      const fadeInterval = 5000 / fadeSteps;
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

  // --- PRE-BATTLE: waiting to start ---
  if (!isPlaying && !isFinished && currentVerseIdx === -1) {
    return (
      <div className="battle-pregame">
        <h1 className="glitch-text massive" data-text="READY">READY</h1>
        <button
          className="primary big pulse-btn"
          onClick={() => wsClient.send({ type: 'START_PLAYBACK' })}
        >
          ▶ GO
        </button>
      </div>
    );
  }

  const activeVerse = sequence[currentVerseIdx];
  const lines = activeVerse ? activeVerse.lines : [];
  const isP1 = currentVerseIdx % 2 === 0;
  const playerClass = isP1 ? 'p1' : 'p2';

  // --- FACT CHECK PANEL ---
  const FactCheck = activeVerse?.context ? (
    <div className={`fact-check ${playerClass}`}>
      <div className="fact-check-header">
        {activeVerse.context.type === 'NET_WORTH' && 'NET WORTH'}
        {activeVerse.context.type === 'PURCHASES' && 'RECEIPTS'}
        {activeVerse.context.type === 'INCOME' && 'INCOME'}
        {activeVerse.context.type === 'SPENDING_HABITS' && 'SPENDING'}
      </div>

      {activeVerse.context.type === 'NET_WORTH' && (
        <div className="fact-big-number">
          ${Math.abs(activeVerse.context.data).toLocaleString()}
        </div>
      )}

      {activeVerse.context.type === 'PURCHASES' && (
        <ul className="fact-list">
          {activeVerse.context.data.map((item, i) => (
            <li key={i}>
              <span className="fact-item-name">{item.name}</span>
              <span className="fact-item-amount">${Math.round(item.amount).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}

      {activeVerse.context.type === 'INCOME' && (
        <ul className="fact-list">
          {activeVerse.context.data.map((item, i) => (
            <li key={i}>
              <span className="fact-item-name">{item}</span>
            </li>
          ))}
        </ul>
      )}

      {activeVerse.context.type === 'SPENDING_HABITS' && (
        <ul className="fact-list">
          {activeVerse.context.data.map((item, i) => (
            <li key={i}>
              <span className="fact-item-name">{item.category}</span>
              <span className="fact-item-amount">${Math.round(item.amount).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  // --- LYRICS PANEL ---
  const Lyrics = (
    <div className={`lyrics-side ${isP1 ? 'align-left' : 'align-right'}`}>
      <div className={`rapper-tag ${playerClass}`}>
        {activeVerse?.nickname}
      </div>

      <div className="lyrics-stack">
        {lines.map((line, idx) => (
          <div
            key={idx}
            className={`lyric-line ${idx === currentLineIdx ? 'active' : ''} ${playerClass}`}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="battle-screen">
      {isFinished ? (
        <div className="battle-end">
          <h1 className="glitch-text massive" data-text="WHO WON?">WHO WON?</h1>
        </div>
      ) : isPlaying && currentVerseIdx === -1 ? (
        <div className="battle-pregame">
          <h1 className="glitch-text massive pulse" data-text="3...2...1">3...2...1</h1>
        </div>
      ) : activeVerse ? (
        <div className="battle-layout">
          {isP1 ? (
            <>
              {Lyrics}
              {FactCheck}
            </>
          ) : (
            <>
              {FactCheck}
              {Lyrics}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
