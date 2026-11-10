import {
  colorOf,
  tap,
  type Color,
  type GameState,
  type Outcome,
  type PromotionPiece,
  type Random,
  type Side,
  type Square,
  type Target,
} from "./game.ts";

export const SQUARE = 64;
export const BOARD = SQUARE * 8;
export const STATUS_HEIGHT = 84;
export const HEIGHT = BOARD + STATUS_HEIGHT;

export interface Point {
  readonly x: number;
  readonly y: number;
}

const FILES = "abcdefgh";
const PROMOTION_ORDER: readonly PromotionPiece[] = ["q", "n", "r", "b"];

// Visitors are most of the people looking and clicking, so their pieces sit at the bottom.
export const bottomColor = (state: Pick<GameState, "ownerColor">): Color => colorOf(state, "visitors");

export function squareOrigin(square: Square, bottom: Color): Point {
  const file = FILES.indexOf(square[0]!);
  const rank = Number(square[1]) - 1;
  const col = bottom === "w" ? file : 7 - file;
  const row = bottom === "w" ? 7 - rank : rank;
  return { x: col * SQUARE, y: row * SQUARE };
}

export function squareAt(point: Point, bottom: Color): Square | undefined {
  if (point.x < 0 || point.y < 0 || point.x >= BOARD || point.y >= BOARD) return undefined;
  const col = Math.floor(point.x / SQUARE);
  const row = Math.floor(point.y / SQUARE);
  const file = bottom === "w" ? col : 7 - col;
  const rank = bottom === "w" ? 7 - row : row;
  return `${FILES[file]}${rank + 1}` as Square;
}

export interface PromotionChoice extends Point {
  readonly piece: PromotionPiece;
}

// Cells start on the destination square and run toward the board centre, lichess style.
export function promotionChoices(state: GameState): readonly PromotionChoice[] {
  if (state.pending.kind !== "promoting") return [];
  const origin = squareOrigin(state.pending.to, bottomColor(state));
  const step = origin.y === 0 ? SQUARE : -SQUARE;
  return PROMOTION_ORDER.map((piece, i) => ({ piece, x: origin.x, y: origin.y + i * step }));
}

export function hitTest(point: Point, state: GameState): Target {
  const choice = promotionChoices(state).find(
    (c) => point.x >= c.x && point.x < c.x + SQUARE && point.y >= c.y && point.y < c.y + SQUARE,
  );
  if (choice) return { kind: "promotion", piece: choice.piece };
  const square = squareAt(point, bottomColor(state));
  return square ? { kind: "square", square } : { kind: "outside" };
}

export const tapAt = (state: GameState, actor: Side, point: Point, random: Random): { state: GameState; outcome: Outcome } =>
  tap(state, actor, hitTest(point, state), random);
