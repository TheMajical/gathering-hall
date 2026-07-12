import { describe, expect, it } from 'vitest';
import { isEngineError, type GameEvent } from '../engine.js';
import { chessEngine, type ChessState } from '../games/chess/engine.js';

function ok(r: ReturnType<typeof chessEngine.reduce>): { state: ChessState; events: GameEvent[] } {
  if (isEngineError(r)) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}

function bad(r: ReturnType<typeof chessEngine.reduce>, code?: string): void {
  if (!isEngineError(r)) throw new Error('expected error, got ok');
  if (code) expect(r.code).toBe(code);
}

/** Play a SAN-free sequence of {from,to} moves, alternating seats automatically. */
function play(state: ChessState, moves: { from: string; to: string; promotion?: string }[]): ChessState {
  let s = state;
  for (const m of moves) {
    const actor = chessEngine.getCurrentActors(s)[0]!;
    s = ok(chessEngine.reduce(s, { type: 'move', ...m }, actor)).state;
  }
  return s;
}

describe('Chess engine', () => {
  it('setup: color assignment is seed-deterministic; initial position has 20 legal moves', () => {
    const a = chessEngine.setup({ numPlayers: 2, seed: 1 });
    const b = chessEngine.setup({ numPlayers: 2, seed: 1 });
    expect(a.whiteSeat).toBe(b.whiteSeat);
    expect([0, 1]).toContain(a.whiteSeat);
    const white = a.whiteSeat;
    const legal = chessEngine.getLegalActions(a, white);
    const moveDesc = legal.find((l) => l.type === 'move');
    if (moveDesc?.type !== 'move') throw new Error('white has no moves');
    expect(moveDesc.moves).toHaveLength(20);
    // black may only resign right now
    expect(chessEngine.getLegalActions(a, 1 - white).every((l) => l.type === 'resign')).toBe(true);
  });

  it('rejects out-of-turn and illegal moves with typed errors', () => {
    const s = chessEngine.setup({ numPlayers: 2, seed: 2 });
    const black = 1 - s.whiteSeat;
    bad(chessEngine.reduce(s, { type: 'move', from: 'e7', to: 'e5' }, black), 'ERR_NOT_YOUR_TURN');
    bad(chessEngine.reduce(s, { type: 'move', from: 'e2', to: 'e5' }, s.whiteSeat), 'ERR_ILLEGAL_ACTION');
    bad(chessEngine.reduce(s, { type: 'move', from: 'zz', to: 'e4' }, s.whiteSeat), 'ERR_ILLEGAL_ACTION');
  });

  it("fool's mate: checkmate ends the game with the right winner", () => {
    let s = chessEngine.setup({ numPlayers: 2, seed: 3 });
    s = play(s, [
      { from: 'f2', to: 'f3' },
      { from: 'e7', to: 'e5' },
      { from: 'g2', to: 'g4' },
      { from: 'd8', to: 'h4' }, // Qh4#
    ]);
    const st = chessEngine.status(s);
    expect(st.terminal).toBe(true);
    expect(st.winners).toEqual([1 - s.whiteSeat]); // black delivered mate
    expect(chessEngine.getCurrentActors(s)).toEqual([]);
    // no further moves accepted
    bad(chessEngine.reduce(s, { type: 'move', from: 'e2', to: 'e4' }, s.whiteSeat));
  });

  it('stalemate is an automatic draw (no winners)', () => {
    // Classic near-stalemate: black king a8, white queen to c7 next is stalemate... use known FEN:
    // White to move: Qc7 leaves black king h8 with no moves? Use standard: k7/8/2Q5/8/8/8/8/K7 b - - 0 1 is stalemate already? Craft one move away:
    // FEN: k7/8/1Q6/8/8/8/8/K7 w - - 0 1 → Qb6-b7?? no that's mate-ish... use verified: 7k/8/6Q1/8/8/8/8/K7 w - - 0 1 and play Qg6-g7?? no.
    // Verified stalemate-in-one: black king a8, white king c7 impossible... Use FEN where ANY position after a queen move stalemates:
    const s0 = chessEngine.setup({ numPlayers: 2, seed: 4, options: { fen: 'k7/8/2K5/8/8/8/8/1Q6 w - - 0 1' } });
    // Qb1-b6 → black king a8: a7 covered (Kc6? no b6 queen covers a7/b7/b8... ) — rely on chess.js to flag it
    const s = play(s0, [{ from: 'b1', to: 'b6' }]);
    const st = chessEngine.status(s);
    expect(st.terminal).toBe(true);
    expect(st.winners).toEqual([]); // draw
    expect(s.drawn).toBe(true);
    expect(s.drawReason).toBe('stalemate');
  });

  it('pawn promotion works and requires the promotion piece choice', () => {
    const s0 = chessEngine.setup({ numPlayers: 2, seed: 5, options: { fen: '7k/P7/8/8/8/8/8/K7 w - - 0 1' } });
    const white = s0.whiteSeat;
    const legal = chessEngine.getLegalActions(s0, white).find((l) => l.type === 'move');
    if (legal?.type !== 'move') throw new Error('no moves');
    const promos = legal.moves.filter((m) => m.from === 'a7' && m.to === 'a8');
    expect(promos.map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
    const s = play(s0, [{ from: 'a7', to: 'a8', promotion: 'q' }]);
    expect(s.fen.startsWith('Q6k') || s.fen.includes('Q')).toBe(true);
    expect(s.san[0]).toContain('=Q');
  });

  it('threefold repetition auto-draws', () => {
    let s = chessEngine.setup({ numPlayers: 2, seed: 6 });
    const shuffle = [
      { from: 'g1', to: 'f3' }, { from: 'g8', to: 'f6' },
      { from: 'f3', to: 'g1' }, { from: 'f6', to: 'g8' },
    ];
    s = play(s, [...shuffle, ...shuffle]);
    const st = chessEngine.status(s);
    expect(st.terminal).toBe(true);
    expect(st.winners).toEqual([]);
    expect(s.drawReason).toBe('threefold repetition');
  });

  it('resign ends the game for the opponent, captures are tracked', () => {
    let s = chessEngine.setup({ numPlayers: 2, seed: 7 });
    s = play(s, [
      { from: 'e2', to: 'e4' },
      { from: 'd7', to: 'd5' },
      { from: 'e4', to: 'd5' }, // white captures a pawn
    ]);
    expect(s.captured[s.whiteSeat]).toEqual(['p']);
    const black = 1 - s.whiteSeat;
    const r = ok(chessEngine.reduce(s, { type: 'resign' }, black));
    expect(r.state.winner).toBe(s.whiteSeat);
    expect(chessEngine.status(r.state).terminal).toBe(true);
  });

  it('deterministic: same seed & moves → identical state', () => {
    const seq = [
      { from: 'e2', to: 'e4' },
      { from: 'c7', to: 'c5' },
      { from: 'g1', to: 'f3' },
    ];
    const a = play(chessEngine.setup({ numPlayers: 2, seed: 9 }), seq);
    const b = play(chessEngine.setup({ numPlayers: 2, seed: 9 }), seq);
    expect(a).toEqual(b);
  });
});
