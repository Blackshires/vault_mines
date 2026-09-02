'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RGSClient } from 'stake-engine';

type CellType = 'hidden' | 'gem' | 'mine';
type PlayMode = 'manual' | 'auto';
type Client = ReturnType<typeof RGSClient>;

type Cell = {
  id: number;
  type: CellType;
  revealed: boolean;
};

type MinesResultEvent = {
  index: number;
  type: 'minesResult';
  mines: number;
  safePicks: number;
  multiplier: number;
  hit: boolean;
};

type RgsRound = {
  betID?: number;
  amount?: number;
  payout?: number;
  payoutMultiplier?: number;
  active?: boolean;
  mode?: string;
  event?: string;
  state?: unknown[];
};

function createHiddenBoard(): Cell[] {
  return Array.from({ length: 25 }, (_, id) => ({ id, type: 'hidden', revealed: false }));
}

function getMinesResult(round: RgsRound | null | undefined): MinesResultEvent | null {
  if (!Array.isArray(round?.state)) return null;

  const event = round.state.find((item) => {
    if (!item || typeof item !== 'object') return false;
    return (item as { type?: unknown }).type === 'minesResult';
  });

  if (!event || typeof event !== 'object') return null;

  const candidate = event as Partial<MinesResultEvent>;
  if (
    typeof candidate.index !== 'number' ||
    typeof candidate.mines !== 'number' ||
    typeof candidate.safePicks !== 'number' ||
    typeof candidate.multiplier !== 'number' ||
    typeof candidate.hit !== 'boolean'
  ) {
    return null;
  }

  return candidate as MinesResultEvent;
}

function revealResolvedMines(cells: Cell[], mineCount: number, forcedMineId?: number): Cell[] {
  const next = cells.map((cell) => ({ ...cell }));
  const mineIds: number[] = [];

  if (forcedMineId !== undefined) mineIds.push(forcedMineId);

  const candidates = next
    .filter((cell) => !cell.revealed && cell.id !== forcedMineId)
    .map((cell) => cell.id)
    .sort(() => Math.random() - 0.5);

  for (const id of candidates) {
    if (mineIds.length >= mineCount) break;
    mineIds.push(id);
  }

  for (const id of mineIds) {
    next[id] = { ...next[id], type: 'mine', revealed: true };
  }

  return next;
}

function playTileClick() {
  if (typeof window === 'undefined') return;

  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;

  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(210, now);
  oscillator.frequency.exponentialRampToValueAtTime(125, now + 0.045);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.055, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.06);
  oscillator.addEventListener('ended', () => void context.close());
}

export default function Home() {
  const clientRef = useRef<Client | null>(null);
  const resolvingRef = useRef(false);

  const [mode, setMode] = useState<PlayMode>('manual');
  const [bet, setBet] = useState(1);
  const [mines, setMines] = useState(0);
  const [targetSafePicks, setTargetSafePicks] = useState(0);
  const [targetMultiplier, setTargetMultiplier] = useState(1);
  const [predeterminedHit, setPredeterminedHit] = useState<boolean | null>(null);
  const [cells, setCells] = useState<Cell[]>(createHiddenBoard);
  const [playing, setPlaying] = useState(false);
  const [lost, setLost] = useState(false);
  const [safeCount, setSafeCount] = useState(0);
  const [rgsReady, setRgsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [autoSelections, setAutoSelections] = useState<number[]>([]);
  const [autoRounds, setAutoRounds] = useState(10);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [roundsDone, setRoundsDone] = useState(0);
  const [sessionProfit, setSessionProfit] = useState(0);

  const payout = bet * targetMultiplier;
  const depth = safeCount >= 10 ? 4 : safeCount >= 6 ? 3 : safeCount >= 3 ? 2 : 1;
  const objectiveRemaining = Math.max(0, targetSafePicks - safeCount);

  const objectiveLabel = useMemo(() => {
    if (!targetSafePicks) return 'Waiting for RGS mission';
    return `Reveal ${targetSafePicks} safe tile${targetSafePicks > 1 ? 's' : ''}`;
  }, [targetSafePicks]);

  useEffect(() => {
    let cancelled = false;

    async function authenticate() {
      setLoading(true);
      setError('');

      try {
        const client = RGSClient({ url: window.location.href });
        clientRef.current = client;
        const auth = await client.Authenticate();
        if (cancelled) return;

        setRgsReady(true);
        if (auth.config?.defaultBetLevel) {
          setBet(auth.config.defaultBetLevel / 1_000_000);
        }

        const activeRound = auth.round as RgsRound | null;
        if (activeRound?.active) {
          const result = getMinesResult(activeRound);
          if (!result) throw new Error('Active RGS round has no valid minesResult event');

          applyMission(result);

          // Event 1 is the finalWin event in the currently published Vault Mines books.
          // If the browser closed after displaying the result but before EndRound, settle it now.
          if (activeRound.event === '1') {
            await client.EndRound();
            if (cancelled) return;
            setPlaying(false);
          } else {
            setPlaying(true);
          }
        }
      } catch (err) {
        console.error('RGS AUTH ERROR:', err);
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void authenticate();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyMission(result: MinesResultEvent) {
    setMines(result.mines);
    setTargetSafePicks(result.safePicks);
    setTargetMultiplier(result.multiplier / 100);
    setPredeterminedHit(result.hit);
    setCells(createHiddenBoard());
    setLost(false);
    setSafeCount(0);
  }

  async function startGame() {
    if (!clientRef.current || !rgsReady || playing || resolvingRef.current) return;

    setLoading(true);
    setError('');

    try {
      const response = await clientRef.current.Play({
        amount: Math.round(bet * 1_000_000),
        mode: 'base',
      });

      const result = getMinesResult(response.round as RgsRound);
      if (!result) throw new Error('RGS Play response has no valid minesResult event');

      applyMission(result);
      setPlaying(true);

      // Event 0 means the mission/result event has been loaded by the frontend.
      await clientRef.current.Event('0');
    } catch (err) {
      console.error('RGS PLAY ERROR:', err);
      setError(String(err));
      setPlaying(false);
      if (autoPlaying) setAutoPlaying(false);
    } finally {
      setLoading(false);
    }
  }

  async function settleRound(won: boolean, finalCells: Cell[]) {
    if (!clientRef.current || resolvingRef.current) return;
    resolvingRef.current = true;

    setCells(finalCells);
    setPlaying(false);

    try {
      // The published book contains minesResult at index 0 and finalWin at index 1.
      await clientRef.current.Event('1');
      await clientRef.current.EndRound();

      if (autoPlaying) {
        setRoundsDone((value) => value + 1);
        setSessionProfit((value) => value + (won ? payout - bet : -bet));
      }
    } catch (err) {
      console.error('RGS SETTLE ERROR:', err);
      setError(String(err));
      setAutoPlaying(false);
    } finally {
      resolvingRef.current = false;
    }
  }

  function reveal(id: number) {
    if (!playing || lost || predeterminedHit === null || resolvingRef.current) return;
    const cell = cells[id];
    if (cell.revealed) return;

    playTileClick();

    const next = cells.map((item) => ({ ...item }));
    const nextSafeCount = safeCount + 1;
    const resolvesNow = nextSafeCount >= targetSafePicks;

    if (!predeterminedHit && resolvesNow) {
      next[id] = { ...next[id], type: 'mine', revealed: true };
      setLost(true);
      const resolved = revealResolvedMines(next, mines, id);
      void settleRound(false, resolved);
      return;
    }

    next[id] = { ...next[id], type: 'gem', revealed: true };
    setCells(next);
    setSafeCount(nextSafeCount);

    if (predeterminedHit && resolvesNow) {
      const resolved = revealResolvedMines(next, mines);
      void settleRound(true, resolved);
    }
  }

  function toggleAutoSelection(id: number) {
    if (mode !== 'auto' || autoPlaying || playing) return;
    playTileClick();
    setAutoSelections((current) =>
      current.includes(id)
        ? current.filter((cellId) => cellId !== id)
        : [...current, id]
    );
  }

  function startAuto() {
    if (!rgsReady || autoSelections.length === 0) return;
    setRoundsDone(0);
    setSessionProfit(0);
    setAutoPlaying(true);
    void startGame();
  }

  function stopAuto() {
    setAutoPlaying(false);
  }

  useEffect(() => {
    if (!autoPlaying || loading || resolvingRef.current) return;

    if (roundsDone >= autoRounds) {
      setAutoPlaying(false);
      return;
    }

    if (!playing) {
      const timer = window.setTimeout(() => void startGame(), 650);
      return () => window.clearTimeout(timer);
    }

    const nextSelected = autoSelections.find((id) => !cells[id].revealed);

    if (nextSelected === undefined) {
      setError(`This RGS mission requires ${targetSafePicks} picks, but Auto has only ${autoSelections.length} selected tile(s).`);
      setAutoPlaying(false);
      return;
    }

    const timer = window.setTimeout(() => reveal(nextSelected), 420);
    return () => window.clearTimeout(timer);
  }, [autoPlaying, roundsDone, autoRounds, playing, cells, autoSelections, loading, targetSafePicks]);

  return (
    <main className="shell">
      <section className="game-card">
        <aside className="sidebar">
          <div>
            <p className="eyebrow">VAULT MINES</p>
            <h1>Crack the grid.</h1>
            <p className="muted">Each round is a predefined Vault mission supplied by Stake Engine.</p>
          </div>

          <div className="mode-tabs" role="tablist" aria-label="Play mode">
            <button className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')} disabled={playing || autoPlaying}>Manual</button>
            <button className={mode === 'auto' ? 'active' : ''} onClick={() => setMode('auto')} disabled={playing || autoPlaying}>Auto</button>
          </div>

          <label>
            <span>Bet amount</span>
            <div className="input-row">
              <button onClick={() => setBet(Math.max(0.1, bet / 2))} disabled={playing || autoPlaying || loading}>½</button>
              <input type="number" min="0.1" step="0.1" value={bet} disabled={playing || autoPlaying || loading} onChange={(e) => setBet(Number(e.target.value))} />
              <button onClick={() => setBet(bet * 2)} disabled={playing || autoPlaying || loading}>2×</button>
            </div>
          </label>

          <label>
            <span>Mines — assigned by RGS</span>
            <input className="standalone-input" value={mines || '—'} readOnly />
          </label>

          <label>
            <span>Objective — assigned by RGS</span>
            <input className="standalone-input" value={objectiveLabel} readOnly />
          </label>

          {mode === 'auto' && (
            <div className="auto-settings">
              <div className="selection-info">
                <span>Selected tiles</span>
                <strong>{autoSelections.length}</strong>
              </div>
              <label>
                <span>Number of rounds</span>
                <input
                  className="standalone-input"
                  type="number"
                  min="1"
                  max="999"
                  value={autoRounds}
                  disabled={autoPlaying}
                  onChange={(e) => setAutoRounds(Math.max(1, Number(e.target.value)))}
                />
              </label>
            </div>
          )}

          <div className="stats">
            <div><span>Mission multiplier</span><strong>x{targetMultiplier.toFixed(2)}</strong></div>
            <div><span>Mission payout</span><strong>€{payout.toFixed(2)}</strong></div>
            {playing && <div><span>Safe picks</span><strong>{safeCount}/{targetSafePicks}</strong></div>}
            {mode === 'auto' && (
              <>
                <div><span>Rounds</span><strong>{roundsDone}/{autoRounds}</strong></div>
                <div><span>Auto P/L</span><strong className={sessionProfit < 0 ? 'negative' : ''}>{sessionProfit >= 0 ? '+' : ''}€{sessionProfit.toFixed(2)}</strong></div>
              </>
            )}
          </div>

          {mode === 'manual' ? (
            <button className="primary" onClick={() => void startGame()} disabled={!rgsReady || playing || loading}>
              {loading ? 'Connecting…' : playing ? `Objective: ${objectiveRemaining} remaining` : 'Start mission'}
            </button>
          ) : autoPlaying ? (
            <button className="primary stop" onClick={stopAuto}>Stop auto</button>
          ) : (
            <button className="primary" onClick={startAuto} disabled={!rgsReady || autoSelections.length === 0 || loading}>Start auto</button>
          )}
        </aside>

        <section className="board-zone">
          <div className="hud">
            <div><span>DEPTH</span><strong>{depth === 4 ? 'VAULT' : `0${depth}`}</strong></div>
            <div><span>OBJECTIVE</span><strong>{targetSafePicks ? `${safeCount}/${targetSafePicks}` : '—'}</strong></div>
            <div><span>RGS</span><strong>{rgsReady ? '● READY' : '—'}</strong></div>
          </div>

          <div className="grid">
            {cells.map((cell) => {
              const selected = mode === 'auto' && autoSelections.includes(cell.id);
              const canSelect = mode === 'auto' && !playing && !autoPlaying;

              return (
                <button
                  key={cell.id}
                  className={`cell ${selected ? 'auto-selected' : ''} ${cell.revealed ? `revealed ${cell.type}` : ''}`}
                  onClick={() => canSelect ? toggleAutoSelection(cell.id) : reveal(cell.id)}
                  disabled={mode === 'manual' ? (!playing || cell.revealed || resolvingRef.current) : (autoPlaying || playing)}
                  aria-pressed={mode === 'auto' ? selected : undefined}
                  aria-label={mode === 'auto' && !playing ? `Select cell ${cell.id + 1}` : `Cell ${cell.id + 1}`}
                >
                  <span>{cell.revealed ? iconFor(cell.type) : selected ? '✓' : '◆'}</span>
                </button>
              );
            })}
          </div>

          <div className={`status ${lost ? 'danger' : ''}`}>
            {error
              ? `RGS ERROR — ${error}`
              : lost
                ? autoPlaying ? 'MISSION FAILED — NEXT ROUND…' : 'MISSION FAILED — MINE HIT'
                : autoPlaying
                  ? `AUTO — ${Math.min(roundsDone + 1, autoRounds)}/${autoRounds} · ${autoSelections.length} PRESELECTED TILES`
                  : playing
                    ? `${mines} MINES · ${objectiveLabel.toUpperCase()} · x${targetMultiplier.toFixed(2)}`
                    : mode === 'auto'
                      ? autoSelections.length > 0
                        ? `${autoSelections.length} tiles selected — Stake Engine chooses the mission at Play.`
                        : 'Select the tiles Auto should click in each predefined mission.'
                      : rgsReady
                        ? 'Ready — Stake Engine will assign mines, objective and result when you start.'
                        : loading
                          ? 'Authenticating with Stake Engine…'
                          : 'Launch this game from a Stake Engine session.'}
          </div>
        </section>
      </section>
    </main>
  );
}

function iconFor(type: CellType) {
  switch (type) {
    case 'mine': return '💣';
    case 'gem': return '💎';
    default: return '◆';
  }
}
