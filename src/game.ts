import { Chess, type Color, type Square } from "chess.js";

export type { Color, Square };
export type Side = "owner" | "visitors";
export type PromotionPiece = "q" | "r" | "b" | "n";

// Selection is shared global UI state, because the image is global.
export type Pending =
  | { readonly kind: "none" }
  | { readonly kind: "selected"; readonly from: Square }
  | { readonly kind: "promoting"; readonly from: Square; readonly to: Square };

export interface GameRecord {
  readonly owner: number;
  readonly visitors: number;
  readonly draws: number;
}

export interface GameState {
  readonly game: number;
  readonly ownerColor: Color;
  readonly moves: readonly string[];
  readonly pending: Pending;
  readonly record: GameRecord;
}

export type Target =
  | { readonly kind: "square"; readonly square: Square }
  | { readonly kind: "promotion"; readonly piece: PromotionPiece }
  | { readonly kind: "outside" };

export type Outcome =
  | { readonly kind: "moved"; readonly san: string }
  | { readonly kind: "selected" }
  | { readonly kind: "cleared" }
  | { readonly kind: "ignored" }
  | { readonly kind: "not-your-turn"; readonly toMove: Side }
  | { readonly kind: "new-game" };

export type Result =
  | { readonly kind: "checkmate"; readonly winner: Side }
  | { readonly kind: "draw"; readonly reason: "stalemate" | "threefold" | "insufficient" | "fifty-move" };

export type Random = () => number;

const NONE: Pending = { kind: "none" };

export function newGame(previous: Pick<GameState, "game" | "record"> | undefined, random: Random): GameState {
  return {
    game: (previous?.game ?? 0) + 1,
    ownerColor: random() < 0.5 ? "w" : "b",
    moves: [],
    pending: NONE,
    record: previous?.record ?? { owner: 0, visitors: 0, draws: 0 },
  };
}

export function replay(moves: readonly string[]): Chess {
  const chess = new Chess();
  for (const uci of moves) chess.move(parseUci(uci));
  return chess;
}

function parseUci(uci: string) {
  const promotion = uci.slice(4);
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(promotion && { promotion }) };
}

export const sideOf = (state: Pick<GameState, "ownerColor">, color: Color): Side =>
  color === state.ownerColor ? "owner" : "visitors";

export const colorOf = (state: Pick<GameState, "ownerColor">, side: Side): Color =>
  side === "owner" ? state.ownerColor : state.ownerColor === "w" ? "b" : "w";

export function resultOf(state: Pick<GameState, "ownerColor">, chess: Chess): Result | undefined {
  if (chess.isCheckmate()) return { kind: "checkmate", winner: sideOf(state, chess.turn() === "w" ? "b" : "w") };
  if (chess.isStalemate()) return { kind: "draw", reason: "stalemate" };
  if (chess.isInsufficientMaterial()) return { kind: "draw", reason: "insufficient" };
  if (chess.isThreefoldRepetition()) return { kind: "draw", reason: "threefold" };
  if (chess.isDrawByFiftyMoves()) return { kind: "draw", reason: "fifty-move" };
  return undefined;
}

export function tap(
  state: GameState,
  actor: Side,
  target: Target,
  random: Random,
): { state: GameState; outcome: Outcome } {
  const chess = replay(state.moves);
  const result = resultOf(state, chess);
  if (result) {
    const record = { ...state.record };
    if (result.kind === "draw") record.draws++;
    else record[result.winner]++;
    return { state: newGame({ game: state.game, record }, random), outcome: { kind: "new-game" } };
  }

  const toMove = sideOf(state, chess.turn());
  if (actor !== toMove) return { state, outcome: { kind: "not-your-turn", toMove } };

  const set = (pending: Pending, outcome: Outcome) => ({ state: { ...state, pending }, outcome });
  const move = (from: Square, to: Square, promotion?: PromotionPiece) => {
    const { san } = chess.move({ from, to, ...(promotion && { promotion }) });
    return {
      state: { ...state, moves: [...state.moves, from + to + (promotion ?? "")], pending: NONE },
      outcome: { kind: "moved", san } as const,
    };
  };
  const selectable = (square: Square) => chess.moves({ square, verbose: true }).length > 0;
  const { pending } = state;

  switch (pending.kind) {
    case "promoting":
      return target.kind === "promotion"
        ? move(pending.from, pending.to, target.piece)
        : set(NONE, { kind: "cleared" });
    case "selected": {
      if (target.kind !== "square") return set(NONE, { kind: "cleared" });
      const square = target.square;
      const legal = chess.moves({ square: pending.from, verbose: true }).filter((m) => m.to === square);
      if (legal.some((m) => m.promotion)) return set({ kind: "promoting", from: pending.from, to: square }, { kind: "selected" });
      if (legal.length > 0) return move(pending.from, square);
      if (square !== pending.from && selectable(square)) return set({ kind: "selected", from: square }, { kind: "selected" });
      return set(NONE, { kind: "cleared" });
    }
    case "none":
      return target.kind === "square" && selectable(target.square)
        ? set({ kind: "selected", from: target.square }, { kind: "selected" })
        : { state, outcome: { kind: "ignored" } };
  }
}
