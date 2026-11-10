import { describe, expect, it, vi } from "vitest";
import { createApp, parseTap, type AppConfig, type GameStore } from "../src/app.ts";
import { tapAt } from "../src/board.ts";
import { newGame, type GameState } from "../src/game.ts";
import { signSession } from "../src/session.ts";

const NOW = 1_700_000_000_000;
const PROFILE = "https://github.com/JustinRoderick";
const CONFIG: AppConfig = {
  profileUrl: PROFILE,
  ownerGithubId: 114117530,
  ownerName: "Justin",
  githubClientId: "client-id",
  githubClientSecret: "client-secret",
  sessionSecret: "session-secret",
};
const CLICK = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-user": "?1" };

// Visitors hold the bottom colour: with the owner on black, e2 is (288, 416); with the owner on white, e2 is (224, 96).
const OWNER_BLACK = { ...newGame(undefined, () => 0), ownerColor: "b" } satisfies GameState;
const OWNER_WHITE = { ...OWNER_BLACK, ownerColor: "w" } satisfies GameState;

function memoryStore(initial: GameState) {
  let current = initial;
  return {
    get current() {
      return current;
    },
    state: async () => current,
    tap: async (actor, point) => {
      const result = tapAt(current, actor, point, () => 0);
      current = result.state;
      return result.outcome;
    },
  } satisfies GameStore & { current: GameState };
}

const noNetwork = vi.fn<typeof fetch>(async () => {
  throw new Error("unexpected network call");
});

function setup(initial: GameState, fetchImpl: typeof fetch = noNetwork) {
  const store = memoryStore(initial);
  const app = createApp({ store, config: CONFIG, fetch: fetchImpl, now: () => NOW });
  const get = (path: string, headers: Record<string, string> = {}) =>
    app(new Request(`https://chess.test${path}`, { headers }));
  return { store, get };
}

const ownerCookie = async () => `session=${await signSession(CONFIG.sessionSecret, NOW + 60_000)}`;

describe("parseTap", () => {
  it("reads the ismap query", () => {
    expect(parseTap("?12,345")).toEqual({ x: 12, y: 345 });
  });

  it.each(["", "?", "?12", "?12,", "?-1,2", "?1.5,2", "?12, 34", "?12,34&x=1", "?abc"])("rejects %j", (search) => {
    expect(parseTap(search)).toBeUndefined();
  });
});

describe("GET /board.svg", () => {
  it("renders the current state with headers that stop camo caching it", async () => {
    const { get } = setup(OWNER_BLACK);
    const response = await get("/board.svg?theme=light");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-store, max-age=0, must-revalidate");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    const svg = await response.text();
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain("Your move, visitors. You play White.");
    expect(svg).toContain("#ffffff");
  });

  it("uses the dark palette for theme=dark", async () => {
    const svg = await (await setup(OWNER_BLACK).get("/board.svg?theme=dark")).text();
    expect(svg).toContain("#0d1117");
    expect(svg).not.toContain('fill="#ffffff"');
  });
});

describe("GET /tap", () => {
  it("lets a visitor select and move on the visitors' turn, redirecting back each time", async () => {
    const { store, get } = setup(OWNER_BLACK);
    const select = await get("/tap?288,416", CLICK);
    expect(select.status).toBe(303);
    expect(select.headers.get("location")).toBe(PROFILE);
    expect(select.headers.get("cache-control")).toBe("no-store");
    expect(store.current.pending).toEqual({ kind: "selected", from: "e2" });

    const move = await get("/tap?288,288", CLICK);
    expect(move.status).toBe(303);
    expect(store.current.moves).toEqual(["e2e4"]);
  });

  it("tells a visitor to wait on the owner's turn and offers sign-in", async () => {
    const { store, get } = setup(OWNER_WHITE);
    const response = await get("/tap?224,96", CLICK);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("It's Justin's move.");
    expect(html).toContain('href="/login"');
    expect(html).toContain(`href="${PROFILE}"`);
    expect(store.current).toEqual(OWNER_WHITE);
  });

  it("lets the signed-in owner move on the owner's turn", async () => {
    const { store, get } = setup(OWNER_WHITE);
    const cookie = await ownerCookie();
    expect((await get("/tap?224,96", { ...CLICK, cookie })).status).toBe(303);
    expect((await get("/tap?224,224", { ...CLICK, cookie })).status).toBe(303);
    expect(store.current.moves).toEqual(["e2e4"]);
  });

  it("tells the owner they cannot move for the visitors", async () => {
    const { store, get } = setup(OWNER_BLACK);
    const response = await get("/tap?288,416", { ...CLICK, cookie: await ownerCookie() });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("It's the visitors' move.");
    expect(html).toContain("can't move for them");
    expect(store.current).toEqual(OWNER_BLACK);
  });

  it.each([
    ["a forged session", "session=9999999999999.AAAA"],
    ["an expired session", "expired"],
  ])("treats %s as a visitor", async (_, kind) => {
    const cookie = kind === "expired" ? `session=${await signSession(CONFIG.sessionSecret, NOW - 1)}` : kind;
    const { store, get } = setup(OWNER_WHITE);
    const html = await (await get("/tap?224,96", { ...CLICK, cookie })).text();
    expect(html).toContain("It's Justin's move.");
    expect(store.current).toEqual(OWNER_WHITE);
  });

  it.each<[string, Record<string, string>]>([
    ["no fetch metadata", {}],
    ["a non-user-initiated navigation", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }],
    ["an image fetch", { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image", "sec-fetch-user": "?1" }],
  ])("redirects without moving for a request with %s", async (_, headers) => {
    const { store, get } = setup(OWNER_BLACK);
    const response = await get("/tap?288,416", headers);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(PROFILE);
    expect(store.current).toEqual(OWNER_BLACK);
  });

  it.each(["/tap", "/tap?abc", "/tap?1,2,3"])("redirects without moving for %s", async (path) => {
    const { store, get } = setup(OWNER_BLACK);
    const response = await get(path, CLICK);
    expect(response.status).toBe(303);
    expect(store.current).toEqual(OWNER_BLACK);
  });
});

describe("GitHub sign-in", () => {
  function github(userId: number) {
    return vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "gho_token" });
      if (url === "https://api.github.com/user") return Response.json({ id: userId, login: "someone" });
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  it("redirects /login to GitHub with a state that the callback checks", async () => {
    const response = await setup(OWNER_BLACK).get("/login");
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-id");
    expect(location.searchParams.get("redirect_uri")).toBe("https://chess.test/callback");
    const state = location.searchParams.get("state");
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(response.headers.get("set-cookie")).toBe(
      `oauth_state=${state}; Path=/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    );
  });

  it("signs the owner in, and the cookie it sets lets the owner move", async () => {
    const fetchImpl = github(CONFIG.ownerGithubId);
    const { store, get } = setup(OWNER_WHITE, fetchImpl);
    const response = await get("/callback?code=abc&state=s1", { cookie: "oauth_state=s1" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(PROFILE);

    const [, tokenRequest] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(String(tokenRequest!.body))).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      code: "abc",
      redirect_uri: "https://chess.test/callback",
    });
    const [, userRequest] = fetchImpl.mock.calls[1]!;
    expect(new Headers(userRequest!.headers).get("authorization")).toBe("Bearer gho_token");
    expect(new Headers(userRequest!.headers).get("user-agent")).toBe("profile-chess");

    const cookies = response.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("session="))!;
    expect(session).toMatch(/; Path=\/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax$/);
    expect(cookies).toContain("oauth_state=; Path=/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax");

    const cookie = session.split(";")[0]!;
    await get("/tap?224,96", { ...CLICK, cookie });
    expect(store.current.pending).toEqual({ kind: "selected", from: "e2" });
  });

  it("refuses anyone else and sets no session", async () => {
    const response = await setup(OWNER_BLACK, github(42)).get("/callback?code=abc&state=s1", { cookie: "oauth_state=s1" });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Only Justin can sign in here.");
    expect(response.headers.getSetCookie().some((c) => c.startsWith("session="))).toBe(false);
  });

  it.each([
    ["a mismatched state", "/callback?code=abc&state=s1", "oauth_state=s2"],
    ["no state cookie", "/callback?code=abc&state=s1", ""],
    ["no code", "/callback?state=s1", "oauth_state=s1"],
  ])("rejects a callback with %s before calling GitHub", async (_, path, cookie) => {
    const fetchImpl = github(CONFIG.ownerGithubId);
    const response = await setup(OWNER_BLACK, fetchImpl).get(path, { cookie });
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a failed code exchange", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ error: "bad_verification_code" }));
    const response = await setup(OWNER_BLACK, fetchImpl).get("/callback?code=abc&state=s1", { cookie: "oauth_state=s1" });
    expect(response.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("signs out by clearing the session cookie", async () => {
    const response = await setup(OWNER_BLACK).get("/logout", { cookie: await ownerCookie() });
    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toBe("session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  });
});

describe("other routes", () => {
  it("redirects / to the profile", async () => {
    const response = await setup(OWNER_BLACK).get("/");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(PROFILE);
  });

  it("returns 404 for unknown paths", async () => {
    expect((await setup(OWNER_BLACK).get("/nope")).status).toBe(404);
  });
});
