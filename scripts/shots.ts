// Renders fixture states to SVG and rasterizes them with headless Chromium so the board can be eyeballed.
// Usage: bun scripts/shots.ts [outDir]. Set CHROME to pick the browser binary.
import { execFileSync } from "node:child_process";
import { existsSync, globSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { BOARD, HEIGHT } from "../src/board.ts";
import { newGame, type GameState } from "../src/game.ts";
import { renderBoard, type Theme } from "../src/render.ts";

const outDir = resolve(process.argv[2] ?? "shots");
mkdirSync(outDir, { recursive: true });

const chrome =
  process.env.CHROME ??
  globSync(`${homedir()}/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell`)[0] ??
  "/snap/bin/chromium";

const base = newGame(undefined, () => 0);
const fixtures: Record<string, { state: GameState; theme: Theme }> = {
  "initial-light": { theme: "light", state: { ...base, ownerColor: "b" } },
  "initial-dark": { theme: "dark", state: { ...base, ownerColor: "w" } },
  "selected-light": {
    theme: "light",
    state: {
      ...base,
      ownerColor: "b",
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"],
      pending: { kind: "selected", from: "f3" },
      record: { owner: 2, visitors: 1, draws: 0 },
      game: 4,
    },
  },
  "promotion-dark": {
    theme: "dark",
    state: {
      ...base,
      ownerColor: "b",
      moves: ["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "c8b7", "a6b7", "e7e6"],
      pending: { kind: "promoting", from: "b7", to: "a8" },
    },
  },
  "promotion-owner-light": {
    theme: "light",
    state: {
      ...base,
      ownerColor: "w",
      moves: ["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "c8b7", "a6b7", "e7e6"],
      pending: { kind: "promoting", from: "b7", to: "a8" },
    },
  },
  "checkmate-light": {
    theme: "light",
    state: { ...base, ownerColor: "w", moves: ["f2f3", "e7e5", "g2g4", "d8h4"], game: 7, record: { owner: 3, visitors: 2, draws: 1 } },
  },
  "checkmate-dark": {
    theme: "dark",
    state: { ...base, ownerColor: "w", moves: ["f2f3", "e7e5", "g2g4", "d8h4"], game: 7, record: { owner: 3, visitors: 2, draws: 1 } },
  },
};

for (const [name, { state, theme }] of Object.entries(fixtures)) {
  const svg = resolve(outDir, `${name}.svg`);
  const png = resolve(outDir, `${name}.png`);
  writeFileSync(svg, renderBoard(state, { theme, ownerName: "Justin" }));
  execFileSync(chrome, [
    "--headless",
    // Only renders our own local fixture files; Ubuntu's AppArmor blocks the user-namespace sandbox.
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    `--window-size=${BOARD},${HEIGHT}`,
    `--screenshot=${png}`,
    `file://${svg}`,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  if (!existsSync(png)) throw new Error(`${chrome} did not write ${png}`);
  console.log(png);
}
