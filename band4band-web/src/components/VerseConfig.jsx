import { useState } from 'react';
import { wsClient } from '../utils/websocket';

const TOPICS = [
  { id: 'NET_WORTH', label: '💰 Net Worth' },
  { id: 'PURCHASES', label: '🛒 Purchases' },
  { id: 'INCOME', label: '💵 Income' },
  { id: 'SPENDING_HABITS', label: '🔥 Spending' }
];

const TYPES = ['BRAG', 'DISS'];

export default function VerseConfig({ players, settings }) {
  const [verses, setVerses] = useState(() =>
    Array(settings?.numVerses || 8).fill(null).map(() => ({
      type: TYPES[Math.floor(Math.random() * TYPES.length)],
      topic: TOPICS[Math.floor(Math.random() * TOPICS.length)].id
    }))
  );
  const [submitted, setSubmitted] = useState(false);

  const updateVerse = (index, field, value) => {
    const newVerses = [...verses];
    newVerses[index][field] = value;
    setVerses(newVerses);
  };

  const handleSubmit = () => {
    wsClient.send({ type: 'SUBMIT_VERSES', verses });
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="config-screen">
        <h1 className="glitch-text" data-text="LOCKED">LOCKED</h1>
        <p className="wait-text">waiting on your opponent...</p>
      </div>
    );
  }

  return (
    <div className="config-screen">
      <h2>PLAN YOUR ATTACK</h2>

      <div className="verse-stack">
        {verses.map((verse, idx) => (
          <div key={idx} className={`verse-sentence ${verse.type === 'BRAG' ? 'p2-text' : 'p1-text'}`}>
            <span className="verse-sentence-num">#{idx + 1}</span>
            
            <select
              className="inline-select"
              value={verse.type}
              onChange={e => updateVerse(idx, 'type', e.target.value)}
            >
              <option value="BRAG">Brag</option>
              <option value="DISS">Diss</option>
            </select>

            <span className="verse-sentence-static"> about </span>
            
            <select
              className="inline-select"
              value={verse.topic}
              onChange={e => updateVerse(idx, 'topic', e.target.value)}
            >
              {TOPICS.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <button className="primary big" onClick={handleSubmit}>
        LOCK IN 🔒
      </button>
    </div>
  );
}
