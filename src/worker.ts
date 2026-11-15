import { DurableObject } from "cloudflare:workers";
import type { WorkerEnv } from "../alchemy.run.ts";
import { createApp } from "./app.ts";
import { tapAt, type Point } from "./board.ts";
import { newGame, type GameState, type Outcome, type Side } from "./game.ts";

const KEY = "state";

// One instance holds the whole game. A Durable Object runs one call at a time and the synchronous KV
// API cannot interleave, so concurrent clicks cannot corrupt the state.
export class Game extends DurableObject {
  state(): GameState {
    const stored = this.ctx.storage.kv.get<GameState>(KEY);
    if (stored) return stored;
    const fresh = newGame(undefined, Math.random);
    this.ctx.storage.kv.put(KEY, fresh);
    return fresh;
  }

  tap(actor: Side, point: Point): Outcome {
    const before = this.state();
    const { state, outcome } = tapAt(before, actor, point, Math.random);
    if (state !== before) this.ctx.storage.kv.put(KEY, state);
    return outcome;
  }
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const game = env.GAME.getByName("main");
    return createApp({
      store: { state: () => game.state(), tap: (actor, point) => game.tap(actor, point) },
      config: {
        profileUrl: env.PROFILE_URL,
        ownerGithubId: Number(env.OWNER_GITHUB_ID),
        ownerName: env.OWNER_NAME,
        githubClientId: env.GITHUB_CLIENT_ID,
        githubClientSecret: env.GITHUB_CLIENT_SECRET,
        sessionSecret: env.SESSION_SECRET,
      },
    })(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
