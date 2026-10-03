import { createHash, randomBytes } from "node:crypto";
import type { LocalAccount } from "viem";

/**
 * Sign in with ALMA from a terminal: the same OpenID Connect authorization-code flow (with PKCE) a world's page runs,
 * with the wallet method answered by the CLI's key instead of a person at ALMA Auth's page. The redirect URI is never
 * opened; the code is read from the final redirect.
 */

export interface AlmaAuthClient {
  /** ALMA Auth's issuer, which is also the Resolver's API. */
  issuer: string;
  clientId: string;
  redirectUri: string;
}

export const DEFAULT_CLIENT_ID = "fork-kit";
export const DEFAULT_REDIRECT_URI = "http://127.0.0.1/fork-kit/callback";

type Fetch = typeof fetch;

/** Keeps the issuer's cookies between requests and follows no redirect by itself. */
function session(issuer: string, fetchFn: Fetch) {
  const jar = new Map<string, string>();
  return async (url: string, body?: unknown) => {
    const res = await fetchFn(new URL(url, issuer), {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const header of res.headers.getSetCookie()) {
      const pair = header.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      const value = pair.slice(eq + 1);
      if (value) jar.set(pair.slice(0, eq), value);
      else jar.delete(pair.slice(0, eq));
    }
    return res;
  };
}

async function problem(res: Response, doing: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { title?: string; detail?: string; error_description?: string; error?: string };
  throw new Error(`${doing} failed (${res.status}): ${[body.title ?? body.error_description ?? body.error, body.detail].filter(Boolean).join(". ") || res.statusText}`);
}

/** Signs in with the key and returns an access token for the Resolver's API and the soul it belongs to. */
export async function signInWithAlma(client: AlmaAuthClient, account: LocalAccount, fetchFn: Fetch = fetch): Promise<{ accessToken: string; almaId: string }> {
  const request = session(client.issuer, fetchFn);
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: "openid alma",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    nonce: randomBytes(16).toString("base64url"),
  });
  const started = await request(`/authorize?${authorize}`);
  const uid = /\/interaction\/([^/?]+)/.exec(started.headers.get("location") ?? "")?.[1];
  if (!uid) {
    if (started.status >= 400) await problem(started, `Sign in with ALMA as "${client.clientId}"`);
    throw new Error(`ALMA Auth at ${client.issuer} did not start a sign-in for the client "${client.clientId}" (is it registered with ${client.redirectUri}?)`);
  }

  const challenge = await request(`/interaction/${uid}/wallet/challenge`, { address: account.address });
  if (!challenge.ok) await problem(challenge, "The sign-in challenge");
  const { message } = (await challenge.json()) as { message: string };
  const verified = await request(`/interaction/${uid}/wallet/verify`, { message, signature: await account.signMessage({ message }) });
  if (!verified.ok) await problem(verified, "The sign-in");

  let next = ((await verified.json()) as { redirectTo: string }).redirectTo;
  for (let i = 0; i < 5 && !next.startsWith(client.redirectUri); i++) {
    const location = (await request(next)).headers.get("location");
    if (!location) throw new Error("ALMA Auth did not finish the sign-in");
    next = new URL(location, client.issuer).href;
  }
  const callback = new URL(next);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error(`ALMA Auth refused the sign-in: ${callback.searchParams.get("error_description") ?? callback.searchParams.get("error") ?? "no code"}`);

  const token = await fetchFn(`${client.issuer}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: client.redirectUri, client_id: client.clientId, code_verifier: verifier }),
  });
  if (!token.ok) await problem(token, "The token exchange");
  const { access_token, id_token } = (await token.json()) as { access_token: string; id_token: string };
  const claims = JSON.parse(Buffer.from(id_token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub: string };
  return { accessToken: access_token, almaId: claims.sub };
}

/** Calls the Resolver's API as the signed-in soul. */
export async function resolverPost<T>(issuer: string, accessToken: string, path: string, body: unknown, fetchFn: Fetch = fetch): Promise<{ status: number; body: T & { code?: string; title?: string; detail?: string } }> {
  const res = await fetchFn(`${issuer}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T & { code?: string; title?: string; detail?: string } };
}
