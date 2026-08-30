'use client';

import { useMemo, useState } from 'react';

type CellType = 'hidden' | 'gem' | 'mine' | 'key' | 'shield' | 'defused';

type Cell = {
  id: number;
  type: CellType;
  revealed: boolean;
};

function createBoard(mines: number): Cell[] {
  const cells: Cell[] = Array.from({ length: 25 }, (_, id) => ({ id, type: 'gem', revealed: false }));
  const ids = Array.from({ length: 25 }, (_, i) => i).sort(() => Math.random() - 0.5);

  ids.slice(0, mines).forEach((id) => (cells[id].type = 'mine'));

  const safeIds = ids.slice(mines);
  if (safeIds[0] !== undefined) cells[safeIds[0]].type = 'shield';
  safeIds.slice(1, 4).forEach((id) => (cells[id].type = 'key'));

  return cells;
}

export default function Home() {
  const [bet, setBet] = useState(1);
  const [mines, setMines] = useState(3);
  const [cells, setCells] = useState<Cell[]>(() => createBoard(3));
  const [playing, setPlaying] = useState(false);
  const [lost, setLost] = useState(false);
  const [keys, setKeys] = useState(0);
  const [shield, setShield] = useState(false);
  const [safeCount, setSafeCount] = useState(0);

  const multiplier = useMemo(() => Math.max(1, 1 + safeCount * (0.11 + mines * 0.018)), [safeCount, mines]);
  const payout = bet * multiplier;
  const depth = safeCount >= 10 ? 4 : safeCount >= 6 ? 3 : safeCount >= 3 ? 2 : 1;

  function startGame() {
    setCells(createBoard(mines));
    setPlaying(true);
    setLost(false);
    setKeys(0);
    setShield(false);
    setSafeCount(0);
  }

  function reveal(id: number) {
    if (!playing || lost) return;
    const cell = cells[id];
    if (cell.revealed) return;

    const next = [...cells];
    const target = { ...next[id], revealed: true };

    if (target.type === 'mine') {
      if (shield) {
        target.type = 'defused';
        setShield(false);
        setSafeCount((v) => v + 1);
      } else {
        setLost(true);
        setPlaying(false);
        next.forEach((c, index) => {
          if (c.type === 'mine') next[index] = { ...c, revealed: true };
        });
      }
    } else {
      setSafeCount((v) => v + 1);
      if (target.type === 'key') setKeys((v) => Math.min(3, v + 1));
      if (target.type === 'shield') setShield(true);
    }

    next[id] = target;
    setCells(next);
  }

  function cashout() {
    if (!playing || safeCount === 0) return;
    setPlaying(false);
  }

  return (
    <main className="shell">
      <section className="game-card">
        <aside className="sidebar">
          <div>
            <p className="eyebrow">VAULT MINES</p>
            <h1>Crack the grid.</h1>
            <p className="muted">Find gems, collect keys and survive the vault.</p>
          </div>

          <label>
            <span>Bet amount</span>
            <div className="input-row">
              <button onClick={() => setBet(Math.max(0.1, bet / 2))} disabled={playing}>½</button>
              <input type="number" min="0.1" step="0.1" value={bet} disabled={playing} onChange={(e) => setBet(Number(e.target.value))} />
              <button onClick={() => setBet(bet * 2)} disabled={playing}>2×</button>
            </div>
          </label>

          <label>
            <span>Mines</span>
            <select value={mines} disabled={playing} onChange={(e) => setMines(Number(e.target.value))}>
              {Array.from({ length: 20 }, (_, i) => i + 1).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>

          <div className="stats">
            <div><span>Multiplier</span><strong>x{multiplier.toFixed(2)}</strong></div>
            <div><span>Cash out</span><strong>€{payout.toFixed(2)}</strong></div>
          </div>

          {!playing ? (
            <button className="primary" onClick={startGame}>Start game</button>
          ) : (
            <button className="primary" onClick={cashout} disabled={safeCount === 0}>Cash out €{payout.toFixed(2)}</button>
          )}
        </aside>

        <section className="board-zone">
          <div className="hud">
            <div><span>DEPTH</span><strong>{depth === 4 ? 'VAULT' : `0${depth}`}</strong></div>
            <div><span>KEYS</span><strong>🔑 {keys}/3</strong></div>
            <div><span>SHIELD</span><strong>{shield ? '🛡 ACTIVE' : '—'}</strong></div>
          </div>

          <div className="grid">
            {cells.map((cell) => (
              <button
                key={cell.id}
                className={`cell ${cell.revealed ? `revealed ${cell.type}` : ''}`}
                onClick={() => reveal(cell.id)}
                disabled={!playing || cell.revealed}
                aria-label={`Cell ${cell.id + 1}`}
              >
                <span>{cell.revealed ? iconFor(cell.type) : '◆'}</span>
              </button>
            ))}
          </div>

          <div className={`status ${lost ? 'danger' : ''}`}>
            {lost ? 'VAULT BREACHED — MINE HIT' : playing ? 'Choose a tile or cash out.' : safeCount > 0 ? `Round complete — €${payout.toFixed(2)}` : 'Configure your bet and enter the vault.'}
          </div>
        </section>
      </section>
    </main>
  );
}

function iconFor(type: CellType) {
  switch (type) {
    case 'mine': return '💣';
    case 'key': return '🔑';
    case 'shield': return '🛡️';
    case 'defused': return '💥';
    case 'gem': return '💎';
    default: return '◆';
  }
}
