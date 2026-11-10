import { describe, expect, it } from "vitest";
import { hitTest } from "../src/board.ts";
import { newGame, type GameState, type Pending } from "../src/game.ts";

const visitorsWhite = { ...newGame(undefined, () => 0.9), ownerColor: "b" } satisfies GameState;
const visitorsBlack = { ...visitorsWhite, ownerColor: "w" } satisfies GameState;
const promoting = (state: GameState, pending: Pending): GameState => ({ ...state, pending });

describe("hitTest", () => {
  it.each([
    [0, 0, "a8"],
    [0, 511, "a1"],
    [511, 0, "h8"],
    [100, 500, "b1"],
    [300, 260, "e4"],
  ])("maps (%i, %i) to %s with white at the bottom", (x, y, square) => {
    expect(hitTest({ x, y }, visitorsWhite)).toEqual({ kind: "square", square });
  });

  it.each([
    [0, 0, "h1"],
    [0, 511, "h8"],
    [511, 511, "a8"],
    [300, 260, "d5"],
  ])("maps (%i, %i) to %s with black at the bottom", (x, y, square) => {
    expect(hitTest({ x, y }, visitorsBlack)).toEqual({ kind: "square", square });
  });

  it.each([
    [10, 530],
    [512, 10],
    [600, 600],
  ])("treats (%i, %i) as outside the board", (x, y) => {
    expect(hitTest({ x, y }, visitorsWhite)).toEqual({ kind: "outside" });
  });

  it("maps the promotion picker at the top edge, queen first, toward the centre", () => {
    const state = promoting(visitorsWhite, { kind: "promoting", from: "b7", to: "a8" });
    expect(hitTest({ x: 10, y: 10 }, state)).toEqual({ kind: "promotion", piece: "q" });
    expect(hitTest({ x: 10, y: 70 }, state)).toEqual({ kind: "promotion", piece: "n" });
    expect(hitTest({ x: 63, y: 140 }, state)).toEqual({ kind: "promotion", piece: "r" });
    expect(hitTest({ x: 10, y: 255 }, state)).toEqual({ kind: "promotion", piece: "b" });
    expect(hitTest({ x: 10, y: 256 }, state)).toEqual({ kind: "square", square: "a4" });
    expect(hitTest({ x: 64, y: 10 }, state)).toEqual({ kind: "square", square: "b8" });
  });

  it("maps the promotion picker at the bottom edge upward when the owner promotes", () => {
    const state = promoting(visitorsBlack, { kind: "promoting", from: "b7", to: "a8" });
    expect(hitTest({ x: 500, y: 500 }, state)).toEqual({ kind: "promotion", piece: "q" });
    expect(hitTest({ x: 500, y: 400 }, state)).toEqual({ kind: "promotion", piece: "n" });
    expect(hitTest({ x: 500, y: 330 }, state)).toEqual({ kind: "promotion", piece: "r" });
    expect(hitTest({ x: 500, y: 260 }, state)).toEqual({ kind: "promotion", piece: "b" });
    expect(hitTest({ x: 500, y: 250 }, state)).toEqual({ kind: "square", square: "a4" });
  });
});
