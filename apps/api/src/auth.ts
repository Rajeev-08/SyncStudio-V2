import { createHash, randomBytes } from "node:crypto";
import { parse, serialize } from "cookie";
import type { Store } from "./store";
import type { User } from "../../../packages/shared/src/index";
import { assert } from "./errors";
export const cookieName = "syncstudio_session";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function authenticate(
  store: Store,
  cookies?: string,
): Promise<{ user: User; sessionId: string; expiresAt: number }> {
  const token = parse(cookies ?? "")[cookieName];
  assert(token, 401, "UNAUTHENTICATED", "Sign in to continue.");
  const session = await store.session(hash(token));
  assert(
    session,
    401,
    "SESSION_EXPIRED",
    "Your session has expired. Sign in again.",
  );
  const account = await store.account(session.userId);
  assert(account, 401, "UNAUTHENTICATED", "Sign in to continue.");
  return {
    user: { id: account.id, username: account.username, email: account.email },
    sessionId: session.id,
    expiresAt: session.expiresAt,
  };
}
export async function newSession(
  store: Store,
  userId: string,
  secure: boolean,
) {
  const token = randomBytes(32).toString("base64url");
  await store.saveSession({
    id: hash(token),
    userId,
    expiresAt: Date.now() + 7 * 86400000,
  });
  return serialize(cookieName, token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 86400,
  });
}
export function clearCookie(secure: boolean) {
  return serialize(cookieName, "", {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
