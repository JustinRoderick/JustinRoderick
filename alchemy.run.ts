import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { Config, Effect, Layer } from "effect";
import type { Game } from "./src/worker.ts";

export const Worker = Cloudflare.Worker("ProfileChess", {
  name: "profile-chess",
  main: "./src/worker.ts",
  env: {
    GAME: Cloudflare.DurableObject<Game>("Game"),
    PROFILE_URL: "https://github.com/JustinRoderick",
    OWNER_NAME: "Justin",
    OWNER_GITHUB_ID: "114117530",
    GITHUB_CLIENT_ID: Config.String("GITHUB_CLIENT_ID"),
    GITHUB_CLIENT_SECRET: Config.Redacted("GITHUB_CLIENT_SECRET"),
    SESSION_SECRET: Alchemy.makeRandom("SessionSecret"),
  },
});

export type WorkerEnv = Cloudflare.InferEnv<typeof Worker>;

export default Alchemy.Stack(
  "profile-chess",
  {
    providers: Cloudflare.providers(),
    state: Layer.unwrap(
      Effect.map(Alchemy.AlchemyContext, ({ dev }) => (dev ? Alchemy.localState() : Cloudflare.state())),
    ),
  },
  Effect.gen(function* () {
    const worker = yield* Worker;
    return { url: worker.url };
  }),
);
