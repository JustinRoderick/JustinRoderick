import { SQUARES, type Chess, type Move } from "chess.js";
import { BOARD, HEIGHT, SQUARE, bottomColor, promotionChoices, squareAt, squareOrigin } from "./board.ts";
import { colorOf, replay, resultOf, sideOf, type Color, type GameState, type Result, type Square } from "./game.ts";
import { PIECE_SYMBOLS } from "./pieces.ts";

export type Theme = "light" | "dark";

const LIGHT_SQUARE = "#f0d9b5";
const DARK_SQUARE = "#b58863";
const MARK = "rgba(20,85,30,0.5)";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";

const PALETTE = {
  light: { background: "#ffffff", text: "#1f2328", muted: "#59636e", rule: "#d1d9e0" },
  dark: { background: "#0d1117", text: "#f0f6fc", muted: "#9198a1", rule: "#3d444d" },
} satisfies Record<Theme, Record<string, string>>;

const COLOR_NAME: Record<Color, string> = { w: "White", b: "Black" };

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const isLight = (square: Square) => ("abcdefgh".indexOf(square[0]!) + Number(square[1])) % 2 === 0;

export interface Status {
  readonly headline: string;
  readonly detail: string;
  readonly record: string;
  readonly lastMove: string;
}

function describeResult(result: Result, ownerName: string): string {
  if (result.kind === "checkmate") return `Checkmate. ${result.winner === "owner" ? `${ownerName} wins` : "Visitors win"}.`;
  switch (result.reason) {
    case "stalemate":
      return "Stalemate. It's a draw.";
    case "threefold":
      return "Draw by threefold repetition.";
    case "insufficient":
      return "Draw by insufficient material.";
    case "fifty-move":
      return "Draw by the fifty-move rule.";
  }
}

export function status(state: GameState, chess: Chess, ownerName: string): Status {
  const history = chess.history();
  const san = history.at(-1);
  const n = history.length;
  const lastMove = san ? `Last move: ${Math.ceil(n / 2)}.${n % 2 === 0 ? ".." : ""} ${san}` : "";
  const { owner, visitors, draws } = state.record;
  const record = `Game ${state.game} · ${ownerName} ${owner} · Visitors ${visitors} · Draws ${draws}`;
  const base = { record, lastMove };

  const result = resultOf(state, chess);
  if (result) return { ...base, headline: describeResult(result, ownerName), detail: `Click the board to start game ${state.game + 1}.` };

  const visitorColor = COLOR_NAME[colorOf(state, "visitors")];
  if (sideOf(state, chess.turn()) === "owner") {
    const ownerColor = COLOR_NAME[state.ownerColor];
    return {
      ...base,
      headline: `Waiting for ${ownerName} (${ownerColor}) to move.`,
      detail: `${chess.inCheck() ? `${ownerName} is in check. ` : ""}Visitors play ${visitorColor}. Check back soon.`,
    };
  }

  const detail = {
    none: "Click a piece, then a square.",
    selected: "Click a marked square to move, or the piece again to cancel.",
    promoting: "Pick a piece to promote to, or click elsewhere to cancel.",
  }[state.pending.kind];
  return {
    ...base,
    headline: `Your move, visitors. You play ${visitorColor}.`,
    detail: chess.inCheck() ? `Check! ${detail}` : detail,
  };
}

function piece(color: Color, type: string, x: number, y: number, size = SQUARE) {
  return `<use href="#${color}${type.toUpperCase()}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
}

function squares(state: GameState, chess: Chess, bottom: Color): string {
  const out: string[] = [];
  const last: Move | undefined = chess.history({ verbose: true }).at(-1);
  const selected = state.pending.kind === "none" ? undefined : state.pending.from;
  const kingInCheck = chess.inCheck() ? chess.findPiece({ type: "k", color: chess.turn() })[0] : undefined;

  for (const square of SQUARES) {
    const { x, y } = squareOrigin(square, bottom);
    out.push(`<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" fill="${isLight(square) ? LIGHT_SQUARE : DARK_SQUARE}"/>`);
    if (last && (square === last.from || square === last.to))
      out.push(`<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" fill="rgba(155,199,0,0.41)"/>`);
    if (square === selected) out.push(`<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" fill="${MARK}"/>`);
    if (square === kingInCheck) out.push(`<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" fill="url(#check)"/>`);
  }

  // Coordinates sit inside the edge squares in the opposite square color, lichess style.
  out.push(`<g font-size="11" font-weight="700">`);
  for (let i = 0; i < 8; i++) {
    const rankSquare = squareAt({ x: 0, y: i * SQUARE }, bottom)!;
    const fileSquare = squareAt({ x: i * SQUARE, y: BOARD - 1 }, bottom)!;
    out.push(
      `<text x="3" y="${i * SQUARE + 12}" fill="${isLight(rankSquare) ? DARK_SQUARE : LIGHT_SQUARE}">${rankSquare[1]}</text>`,
      `<text x="${i * SQUARE + SQUARE - 3}" y="${BOARD - 4}" text-anchor="end" fill="${isLight(fileSquare) ? DARK_SQUARE : LIGHT_SQUARE}">${fileSquare[0]}</text>`,
    );
  }
  out.push(`</g>`);

  for (const square of SQUARES) {
    const p = chess.get(square);
    if (!p) continue;
    const { x, y } = squareOrigin(square, bottom);
    out.push(piece(p.color, p.type, x, y));
  }

  if (state.pending.kind === "selected") {
    for (const move of chess.moves({ square: state.pending.from, verbose: true })) {
      const { x, y } = squareOrigin(move.to, bottom);
      const cx = x + SQUARE / 2;
      const cy = y + SQUARE / 2;
      out.push(
        move.isCapture()
          ? `<circle cx="${cx}" cy="${cy}" r="${SQUARE / 2 - 3}" fill="none" stroke="${MARK}" stroke-width="5"/>`
          : `<circle cx="${cx}" cy="${cy}" r="${SQUARE / 6}" fill="${MARK}"/>`,
      );
    }
  }
  return out.join("");
}

function promotionPicker(state: GameState, chess: Chess): string {
  const choices = promotionChoices(state);
  if (choices.length === 0) return "";
  const color = chess.turn();
  const inset = SQUARE * 0.1;
  return [
    `<rect width="${BOARD}" height="${BOARD}" fill="rgba(0,0,0,0.55)"/>`,
    ...choices.map(
      (c) =>
        `<circle cx="${c.x + SQUARE / 2}" cy="${c.y + SQUARE / 2}" r="${SQUARE / 2 - 1}" fill="url(#choice)"/>` +
        piece(color, c.piece, c.x + inset, c.y + inset, SQUARE - inset * 2),
    ),
  ].join("");
}

function statusBar(s: Status, theme: Theme): string {
  const p = PALETTE[theme];
  return [
    `<rect y="${BOARD}" width="${BOARD}" height="${HEIGHT - BOARD}" fill="${p.background}"/>`,
    `<text x="14" y="${BOARD + 26}" font-size="16" font-weight="600" fill="${p.text}">${escapeXml(s.headline)}</text>`,
    `<text x="14" y="${BOARD + 49}" font-size="13" fill="${p.text}">${escapeXml(s.detail)}</text>`,
    `<text x="14" y="${BOARD + 72}" font-size="12" fill="${p.muted}">${escapeXml(s.record)}</text>`,
    `<text x="${BOARD - 14}" y="${BOARD + 72}" font-size="12" text-anchor="end" fill="${p.muted}">${escapeXml(s.lastMove)}</text>`,
  ].join("");
}

export function renderBoard(state: GameState, options: { theme: Theme; ownerName: string }): string {
  const chess = replay(state.moves);
  const bottom = bottomColor(state);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD}" height="${HEIGHT}" viewBox="0 0 ${BOARD} ${HEIGHT}" ` +
    `font-family="${FONT}">` +
    `<title>Chess game ${state.game}</title>` +
    `<defs>${PIECE_SYMBOLS}` +
    `<radialGradient id="check"><stop offset="0" stop-color="#ff0000"/><stop offset="0.25" stop-color="#e70000"/>` +
    `<stop offset="0.89" stop-color="#a90000" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="choice"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b0b0b0"/></radialGradient>` +
    `</defs>` +
    squares(state, chess, bottom) +
    promotionPicker(state, chess) +
    statusBar(status(state, chess, options.ownerName), options.theme) +
    `</svg>`
  );
}
