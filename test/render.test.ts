import { describe, expect, it } from "vitest";
import { newGame, type GameState } from "../src/game.ts";
import { renderBoard } from "../src/render.ts";

const base = newGame(undefined, () => 0);
const render = (state: GameState, ownerName = "Justin") => renderBoard(state, { theme: "light", ownerName });

describe("renderBoard", () => {
  it("is a 512px wide SVG with all 32 pieces at the start", () => {
    const svg = render(base);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="512" /);
    expect(svg.match(/<use href="#[wb][KQRBNP]"/g)).toHaveLength(32);
  });

  it("tells visitors to move when it is their turn", () => {
    expect(render({ ...base, ownerColor: "b" })).toContain("Your move, visitors. You play White.");
  });

  it("tells everyone the owner is to move", () => {
    const svg = render({ ...base, ownerColor: "w" });
    expect(svg).toContain("Waiting for Justin (White) to move.");
    expect(svg).toContain("Visitors play Black.");
  });

  it("marks every legal destination of the selected piece", () => {
    const svg = render({ ...base, ownerColor: "b", pending: { kind: "selected", from: "g1" } });
    expect(svg.match(/<circle [^>]*rgba\(20,85,30,0.5\)/g)).toHaveLength(2);
  });

  it("announces the result and the next game number after checkmate", () => {
    const svg = render({
      ...base,
      game: 7,
      ownerColor: "w",
      moves: ["f2f3", "e7e5", "g2g4", "d8h4"],
      record: { owner: 3, visitors: 2, draws: 1 },
    });
    expect(svg).toContain("Checkmate. Visitors win.");
    expect(svg).toContain("Click the board to start game 8.");
    expect(svg).toContain("Game 7 · Justin 3 · Visitors 2 · Draws 1");
  });

  it("escapes the owner name", () => {
    const svg = render({ ...base, ownerColor: "w" }, "<J&J>");
    expect(svg).toContain("Waiting for &#60;J&#38;J&#62; (White) to move.");
    expect(svg).not.toContain("<J&J>");
  });
});
