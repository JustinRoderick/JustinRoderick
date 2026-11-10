import type { Point } from "./board.ts";
import type { GameState, Outcome, Side } from "./game.ts";
import { renderBoard } from "./render.ts";
import { signSession, verifySession } from "./session.ts";

export interface GameStore {
  state(): Promise<GameState>;
  tap(actor: Side, point: Point): Promise<Outcome>;
}

export interface AppConfig {
  readonly profileUrl: string;
  readonly ownerGithubId: number;
  readonly ownerName: string;
  readonly githubClientId: string;
  readonly githubClientSecret: string;
  readonly sessionSecret: string;
}

export interface AppDeps {
  readonly store: GameStore;
  readonly config: AppConfig;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

const SESSION_COOKIE = "session";
const STATE_COOKIE = "oauth_state";
const SESSION_MS = 365 * 24 * 60 * 60 * 1000;

export function parseTap(search: string): Point | undefined {
  const match = /^\?(\d{1,5}),(\d{1,5})$/.exec(search);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : undefined;
}

// Only a real click on the ismap image sends all three; link previewers and crawlers that follow the
// README link do not, so they can never move pieces.
const isBrowserClick = (request: Request) =>
  request.headers.get("sec-fetch-mode") === "navigate" &&
  request.headers.get("sec-fetch-dest") === "document" &&
  request.headers.get("sec-fetch-user") === "?1";

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

const cookie = (name: string, value: string, path: string, maxAgeSeconds: number) =>
  `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(status: number, title: string, body: string, headers: HeadersInit = {}): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2328;background:#fff}
a{color:#0969da}small{color:#59636e}@media (prefers-color-scheme:dark){body{color:#f0f6fc;background:#0d1117}a{color:#4493f8}small{color:#9198a1}}</style>
</head><body>${body}</body></html>`;
  const out = new Headers(headers);
  out.set("content-type", "text/html; charset=utf-8");
  out.set("cache-control", "no-store");
  return new Response(html, { status, headers: out });
}

function seeOther(location: string, headers: HeadersInit = {}): Response {
  const out = new Headers(headers);
  out.set("location", location);
  out.set("cache-control", "no-store");
  return new Response(null, { status: 303, headers: out });
}

export function createApp({ store, config, fetch: fetchImpl = fetch, now = Date.now }: AppDeps) {
  const owner = escapeHtml(config.ownerName);
  const back = `<p><a href="${escapeHtml(config.profileUrl)}">Back to the board</a></p>`;

  async function actorOf(request: Request): Promise<Side> {
    const value = readCookie(request, SESSION_COOKIE);
    return value && (await verifySession(config.sessionSecret, value, now())) ? "owner" : "visitors";
  }

  async function board(url: URL): Promise<Response> {
    const theme = url.searchParams.get("theme") === "dark" ? "dark" : "light";
    return new Response(renderBoard(await store.state(), { theme, ownerName: config.ownerName }), {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
        pragma: "no-cache",
        expires: "0",
      },
    });
  }

  async function tap(request: Request, url: URL): Promise<Response> {
    const point = parseTap(url.search);
    if (!point || !isBrowserClick(request)) return seeOther(config.profileUrl);
    const actor = await actorOf(request);
    const outcome = await store.tap(actor, point);
    if (outcome.kind !== "not-your-turn") return seeOther(config.profileUrl);
    return actor === "owner"
      ? page(200, "Visitors' move", `<h1>It's the visitors' move.</h1>
<p>You're signed in as ${owner}, so you can't move for them.</p>${back}<p><small><a href="/logout">Sign out</a></small></p>`)
      : page(200, `${config.ownerName}'s move`, `<h1>It's ${owner}'s move.</h1>
<p>Check back soon.</p>${back}<p><small>Are you ${owner}? <a href="/login">Sign in with GitHub</a></small></p>`);
  }

  function login(url: URL): Response {
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", config.githubClientId);
    authorize.searchParams.set("redirect_uri", `${url.origin}/callback`);
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("allow_signup", "false");
    return new Response(null, {
      status: 302,
      headers: { location: authorize.href, "set-cookie": cookie(STATE_COOKIE, state, "/callback", 600), "cache-control": "no-store" },
    });
  }

  async function callback(request: Request, url: URL): Promise<Response> {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || state !== readCookie(request, STATE_COOKIE)) {
      return page(400, "Sign-in expired", `<h1>Sign-in expired.</h1><p><a href="/login">Try again</a>.</p>${back}`);
    }
    const clearState = cookie(STATE_COOKIE, "", "/callback", 0);
    const failed = () =>
      page(502, "Sign-in failed", `<h1>GitHub sign-in failed.</h1><p><a href="/login">Try again</a>.</p>${back}`, {
        "set-cookie": clearState,
      });

    const tokenResponse = await fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code,
        redirect_uri: `${url.origin}/callback`,
      }),
    });
    const token = tokenResponse.ok ? ((await tokenResponse.json()) as { access_token?: unknown }).access_token : undefined;
    if (typeof token !== "string") return failed();

    const userResponse = await fetchImpl("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "profile-chess",
      },
    });
    if (!userResponse.ok) return failed();
    const { id } = (await userResponse.json()) as { id?: unknown };
    if (id !== config.ownerGithubId) {
      return page(403, "Owner only", `<h1>Only ${owner} can sign in here.</h1>
<p>You can still play: click the board on the profile when it's the visitors' move.</p>${back}`, { "set-cookie": clearState });
    }
    const session = await signSession(config.sessionSecret, now() + SESSION_MS);
    const headers = new Headers();
    headers.append("set-cookie", cookie(SESSION_COOKIE, session, "/", SESSION_MS / 1000));
    headers.append("set-cookie", clearState);
    return seeOther(config.profileUrl, headers);
  }

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/":
        return seeOther(config.profileUrl);
      case "/board.svg":
        return board(url);
      case "/tap":
        return tap(request, url);
      case "/login":
        return login(url);
      case "/callback":
        return callback(request, url);
      case "/logout":
        return seeOther(config.profileUrl, { "set-cookie": cookie(SESSION_COOKIE, "", "/", 0) });
      default:
        return new Response("Not found", { status: 404 });
    }
  };
}
