import { describe, expect, it } from "vitest";
import { newGame, replay, tap, type GameState, type Side, type Square, type Target } from "../src/game.ts";

const never = () => {
  throw new Error("random should not be consulted");
};

function state(overrides: Partial<GameState> = {}): GameState {
  return { ...newGame(undefined, () => 0), ...overrides };
}

const sq = (square: Square): Target => ({ kind: "square", square });

function taps(start: GameState, actor: Side, ...targets: Target[]) {
  let current = start;
  let outcome;
  for (const target of targets) ({ state: current, outcome } = tap(current, actor, target, never));
  return { state: current, outcome };
}

const PROMOTION_READY = ["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "c8b7", "a6b7", "e7e6"];
const FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"];
const LOYD_STALEMATE = [
  "e2e3", "a7a5", "d1h5", "a8a6", "h5a5", "h7h5", "h2h4", "a6h6", "a5c7", "f7f6",
  "c7d7", "e8f7", "d7b7", "d8d3", "b7b8", "d3h7", "b8c8", "f7g6", "c8e6",
];

describe("newGame", () => {
  it("starts game 1 with an empty record and picks the owner's colour from random", () => {
    expect(newGame(undefined, () => 0.2)).toEqual({
      game: 1,
      ownerColor: "w",
      moves: [],
      pending: { kind: "none" },
      record: { owner: 0, visitors: 0, draws: 0 },
    });
    expect(newGame(undefined, () => 0.7).ownerColor).toBe("b");
  });
});

describe("turn gating", () => {
  it("refuses a visitor when the owner is to move", () => {
    const start = state({ ownerColor: "w" });
    expect(tap(start, "visitors", sq("e2"), never)).toEqual({
      state: start,
      outcome: { kind: "not-your-turn", toMove: "owner" },
    });
  });

  it("refuses the owner when the visitors are to move", () => {
    const start = state({ ownerColor: "w", moves: ["e2e4"] });
    expect(tap(start, "owner", sq("e7"), never)).toEqual({
      state: start,
      outcome: { kind: "not-your-turn", toMove: "visitors" },
    });
  });

  it("lets the visitors move when they hold white", () => {
    const result = taps(state({ ownerColor: "b" }), "visitors", sq("g1"), sq("f3"));
    expect(result.outcome).toEqual({ kind: "moved", san: "Nf3" });
    expect(result.state.moves).toEqual(["g1f3"]);
  });
});

describe("selecting and moving", () => {
  const start = state({ ownerColor: "w" });

  it("selects a piece with legal moves, then moves it to a legal square", () => {
    const selected = tap(start, "owner", sq("e2"), never);
    expect(selected.outcome).toEqual({ kind: "selected" });
    expect(selected.state.pending).toEqual({ kind: "selected", from: "e2" });

    const moved = tap(selected.state, "owner", sq("e4"), never);
    expect(moved.outcome).toEqual({ kind: "moved", san: "e4" });
    expect(moved.state).toEqual({ ...start, moves: ["e2e4"], pending: { kind: "none" } });
  });

  it("switches the selection to another movable piece of the same side", () => {
    const result = taps(start, "owner", sq("e2"), sq("g1"));
    expect(result.outcome).toEqual({ kind: "selected" });
    expect(result.state.pending).toEqual({ kind: "selected", from: "g1" });
  });

  it.each<[string, Target]>([
    ["the selected piece again", sq("e2")],
    ["an unreachable square", sq("e5")],
    ["a piece with no legal moves", sq("a1")],
    ["an opponent piece", sq("e7")],
    ["the status bar", { kind: "outside" }],
  ])("clears the selection when tapping %s", (_, target) => {
    const result = taps(start, "owner", sq("e2"), target);
    expect(result.outcome).toEqual({ kind: "cleared" });
    expect(result.state).toEqual(start);
  });

  it.each<[string, Target]>([
    ["an empty square", sq("e4")],
    ["a piece with no legal moves", sq("a1")],
    ["an opponent piece", sq("e7")],
    ["the status bar", { kind: "outside" }],
  ])("ignores %s with nothing selected", (_, target) => {
    expect(tap(start, "owner", target, never)).toEqual({ state: start, outcome: { kind: "ignored" } });
  });
});

describe("special moves", () => {
  it("castles when the king is moved two squares", () => {
    const start = state({ ownerColor: "w", moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"] });
    const result = taps(start, "owner", sq("e1"), sq("g1"));
    expect(result.outcome).toEqual({ kind: "moved", san: "O-O" });
    const board = replay(result.state.moves);
    expect(board.get("g1")).toEqual({ type: "k", color: "w" });
    expect(board.get("f1")).toEqual({ type: "r", color: "w" });
  });

  it("captures en passant", () => {
    const start = state({ ownerColor: "w", moves: ["e2e4", "a7a6", "e4e5", "d7d5"] });
    const result = taps(start, "owner", sq("e5"), sq("d6"));
    expect(result.outcome).toEqual({ kind: "moved", san: "exd6" });
    expect(replay(result.state.moves).get("d5")).toBeUndefined();
  });

  it("asks for a promotion piece, then promotes to the chosen piece", () => {
    const start = state({ ownerColor: "w", moves: PROMOTION_READY });
    const asking = taps(start, "owner", sq("b7"), sq("a8"));
    expect(asking.outcome).toEqual({ kind: "selected" });
    expect(asking.state.pending).toEqual({ kind: "promoting", from: "b7", to: "a8" });
    expect(asking.state.moves).toEqual(PROMOTION_READY);

    const promoted = tap(asking.state, "owner", { kind: "promotion", piece: "n" }, never);
    expect(promoted.outcome).toEqual({ kind: "moved", san: "bxa8=N" });
    expect(promoted.state.moves).toEqual([...PROMOTION_READY, "b7a8n"]);
    expect(promoted.state.pending).toEqual({ kind: "none" });
  });

  it("cancels a promotion when anything other than a choice is tapped", () => {
    const start = state({ ownerColor: "w", moves: PROMOTION_READY });
    const result = taps(start, "owner", sq("b7"), sq("a8"), sq("a8"));
    expect(result.outcome).toEqual({ kind: "cleared" });
    expect(result.state).toEqual(start);
  });

  it("does not let the side not to move answer a promotion prompt", () => {
    const asking = taps(state({ ownerColor: "w", moves: PROMOTION_READY }), "owner", sq("b7"), sq("a8")).state;
    expect(tap(asking, "visitors", { kind: "promotion", piece: "q" }, never)).toEqual({
      state: asking,
      outcome: { kind: "not-your-turn", toMove: "owner" },
    });
  });
});

describe("game over", () => {
  const mated = state({ game: 3, ownerColor: "w", moves: FOOLS_MATE, record: { owner: 1, visitors: 0, draws: 1 } });

  it.each<Side>(["owner", "visitors"])("any tap by the %s starts the next game and records the win", (actor) => {
    const result = tap(mated, actor, { kind: "outside" }, () => 0.9);
    expect(result.outcome).toEqual({ kind: "new-game" });
    expect(result.state).toEqual({
      game: 4,
      ownerColor: "b",
      moves: [],
      pending: { kind: "none" },
      record: { owner: 1, visitors: 1, draws: 1 },
    });
  });

  it("credits the owner when the owner delivers mate", () => {
    const result = tap({ ...mated, ownerColor: "b" }, "owner", sq("e2"), () => 0.1);
    expect(result.state.record).toEqual({ owner: 2, visitors: 0, draws: 1 });
    expect(result.state.ownerColor).toBe("w");
  });

  it("counts stalemate as a draw", () => {
    const stalemate = state({ ownerColor: "w", moves: LOYD_STALEMATE });
    expect(replay(stalemate.moves).isStalemate()).toBe(true);
    const result = tap(stalemate, "visitors", sq("a1"), () => 0);
    expect(result.outcome).toEqual({ kind: "new-game" });
    expect(result.state.record).toEqual({ owner: 0, visitors: 0, draws: 1 });
  });
});
