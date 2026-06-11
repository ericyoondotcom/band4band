import { useState } from 'react';
import { wsClient } from '../utils/websocket';

const TOPICS = [
  { id: 'NET_WORTH', label: 'Net Worth' },
  { id: 'PURCHASES', label: 'Recent Purchases' },
  { id: 'INCOME', label: 'Income Sources' },
  { id: 'SPENDING_HABITS', label: 'Spending Habits' }
];

export default function VerseConfig({ players }) {
  // Array of 8 configs, default to BRAG and NET_WORTH
  const [verses, setVerses] = useState(
    Array(8).fill(null).map(() => ({ type: 'BRAG', topic: 'NET_WORTH' }))
  );
  const [submitted, setSubmitted] = useState(false);

  const updateVerse = (index, field, value) => {
    const newVerses = [...verses];
    newVerses[index][field] = value;
    setVerses(newVerses);
  };

  const handleSubmit = () => {
    wsClient.send({
      type: 'SUBMIT_VERSES',
      verses
    });
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="flex-col flex-center glass-panel" style={{ margin: 'auto' }}>
        <h2>Verses Locked In.</h2>
        <p>Waiting for your opponent to finish their configuration...</p>
      </div>
    );
  }

  return (
    <div className="flex-col glass-panel" style={{ margin: 'auto', maxWidth: '1000px', width: '100%' }}>
      <h2 className="text-center">Configure Your Verses</h2>
      <p className="text-center" style={{ opacity: 0.8, marginBottom: '2rem' }}>
        Plan your attack. You have 8 verses. Brag about yourself or diss your opponent.
      </p>

      <div className="grid-2">
        {verses.map((verse, idx) => (
          <div key={idx} className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem' }}>Verse {idx + 1}</h3>
            <div className="flex-col gap-4">
              <select 
                value={verse.type} 
                onChange={e => updateVerse(idx, 'type', e.target.value)}
                style={{ padding: '0.8rem', background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid var(--border)', borderRadius: '8px' }}
              >
                <option value="BRAG">Brag (About Me)</option>
                <option value="DISS">Diss (About Opponent)</option>
              </select>
              
              <select 
                value={verse.topic} 
                onChange={e => updateVerse(idx, 'topic', e.target.value)}
                style={{ padding: '0.8rem', background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid var(--border)', borderRadius: '8px' }}
              >
                {TOPICS.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      <div className="flex-center mt-8">
        <button className="primary" onClick={handleSubmit} style={{ fontSize: '1.5rem', padding: '1rem 4rem' }}>
          LOCK IN
        </button>
      </div>
    </div>
  );
}
