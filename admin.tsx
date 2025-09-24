import { Hono } from "hono";
import { kv, env } from "./server.tsx";
import { verify, sign } from "hono/jwt";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import type { JWTPayload } from "hono/utils/jwt/types";

export interface UserToken extends JWTPayload {
  UserID: string;
}

interface Env {
  Variables: {
    payload: JWTPayload;
  };
}

const app = new Hono<Env>();

/**
 * Helper: generate a cryptographically secure hex token
 */
function toHex(buf: ArrayBuffer | Uint8Array) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function genTokenHex(bytes = 32) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * timing-safe string comparison to avoid leaking timing information
 * Uses a constant-time style loop that processes the full length of the longer string.
 */
function timingSafeEqual(a: string, b: string) {
  const la = a.length;
  const lb = b.length;
  const len = Math.max(la, lb);
  let diff = la ^ lb;
  for (let i = 0; i < len; i++) {
    // use modular indexing to ensure both strings are read across the loop
    const ca = a.charCodeAt(i % (la || 1));
    const cb = b.charCodeAt(i % (lb || 1));
    diff |= ca ^ cb;
  }
  return diff === 0;
}

/**
 * JWT 検証
 * nowtoken と整合性チェック
 * トークンの更新
 * CSRF
 */
app.use(async (c, next) => {
  const SECRET_KEY = env.get("SECRET_KEY")!;
  const base_token = await getSignedCookie(c, SECRET_KEY, "token");
  if (!base_token) {
    console.error("トークンがありません");
    return c.redirect("/auth/login");
  }
  let token: UserToken;
  try {
    token = (await verify(base_token, SECRET_KEY)) as UserToken;
    const now = await kv.get(["nowtoken", token.UserID]);
    if (!now.value || now.value !== base_token) {
      console.error("不正/期限切れトークン");
      return c.redirect("/auth/login");
    }
  } catch (e) {
    console.error(e);
    return c.redirect("/auth/login");
  }
  if (!token.UserID || env.get("USER_NAME") !== token.UserID) {
    console.error("ユーザーIDがちがうよん");
    return c.redirect("/auth/login");
  }

  // 有効期限更新
  token.exp = Math.floor(Date.now() / 1000) + 60 * 60;
  token.iat = Math.floor(Date.now() / 1000);
  token.nbf = Math.floor(Date.now() / 1000);

  const new_base_token = await sign(token, SECRET_KEY);
  await setSignedCookie(c, "token", new_base_token, SECRET_KEY, {
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
  });
  kv.set(["nowtoken", token.UserID], new_base_token);

  // CSRF: 既に KV にあればそのまま、無ければ生成して保存
  const csrfKey = ["csrf", token.UserID];
  const existing = await kv.get(csrfKey);
  if (!existing.value) {
    const csrfVal = genTokenHex(32);
    // 保存期限は任意。ここでは 1 時間分の expire も保存（必要なら参照/削除に利用）
    await kv.set(csrfKey, { token: csrfVal, created: Date.now(), expiresAt: Date.now() + 1000 * 60 * 60 });
  }
  // リクエストコンテキストにペイロードをセットしてハンドラで利用可能にする
  c.set("payload", token);
  await next();
});

app.get("/", async (c) => {
  const payload = c.get("payload") as UserToken | undefined;
  if (!payload) return c.redirect("/auth/login");

  // 取得済み CSRF
  const csrfRec = await kv.get(["csrf", payload.UserID]);
  const csrf = (csrfRec?.value as any)?.token || "";

  return c.render(
    <div>
      <h1>たんLink (管理)</h1>
      <p>短縮URL作成 (既存キー上書き不可)</p>
      <form method="post" action="/admin/createLink">
        <input type="text" name="url" placeholder="URL" />
        <input type="text" name="key" placeholder="key" required />
        <input type="text" name="ip" placeholder="IP規制 (オプション)" />
        <input type="hidden" name="csrf" value={csrf} />
        <button type="submit">短縮</button>
      </form>
    </div>,
  );
});

/**
 * - CSRF トークン検証
 * - URL 検証
 */
app.post("/createLink", async (c) => {
  const payload = c.get("payload") as UserToken | undefined;
  if (!payload) return c.redirect("/auth/login");

  const body = await c.req.formData();
  const url = (body.get("url") as string || "").trim();
  const key = (body.get("key") as string || "").trim();
  const ip = (body.get("ip") as string || "").trim();
  const csrf = (body.get("csrf") as string || "").trim();

  // CSRF 検証（タイミング差を減らすため timing-safe 比較を使用）
  const csrfRec = await kv.get(["csrf", payload.UserID]);
  const expectedCsrf = (csrfRec?.value as any)?.token || "";
  if (!expectedCsrf || !csrf || !timingSafeEqual(expectedCsrf, csrf)) {
    return c.text("CSRF トークンが不正です", 403);
  }

  if (!url || !key) {
    return c.text("URL と key を指定してください", 400);
  }
  if (!/^[0-9A-Za-z]{3,32}$/.test(key)) {
    return c.text("key は英数字 3-32 文字", 400);
  }

  const atomic = kv.atomic().set(["links", key], url);
  const ipRegex = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-fA-F0-9:]+)$/;
  if (ip && ipRegex.test(ip)) {
    atomic.set(["links", key, "ip"], ip);
  }
  const res = await atomic.commit();
  if (!res.ok) {
    return c.text("なんかしらエラー!!", 400);
  }

  // Rotate CSRF token after successful state change to prevent replay of same token
  try {
    const newCsrf = genTokenHex(32);
    await kv.set(["csrf", payload.UserID], { token: newCsrf, created: Date.now(), expiresAt: Date.now() + 1000 * 60 * 60 });
  } catch (e) {
    // If CSRF rotation fails for any reason, continue — creation already succeeded.
    console.error("CSRF rotation failed:", e);
  }

  return c.render(
    <div>
      <h1>たんLink</h1>
      <p>短縮かんりょ〜!!</p>
      <a href={`https://tanlink.deno.dev/${key}`} id="a" rel="noopener noreferrer">
        {`https://tanlink.deno.dev/${key}`}
      </a>
    </div>,
  );
});

/**
 * 管理: createUser GET -> render form (embed CSRF)
 */
app.get("/createUser", async (c) => {
  const payload = c.get("payload") as UserToken | undefined;
  if (!payload) return c.redirect("/auth/login");

  const csrfRec = await kv.get(["csrf", payload.UserID]);
  const csrf = (csrfRec?.value as any)?.token || "";

  return c.render(
    <>
      <h1>新しいUserを作成してみよう!!</h1>
      <form method="post" action="/admin/createUser">
        <input type="text" name="username" placeholder="username" />
        <input type="password" name="password" placeholder="password" />
        <input type="hidden" name="csrf" value={csrf} />
        <button type="submit">作成</button>
      </form>
    </>,
  );
});

app.post("/createUser", async (c) => {
  const payload = c.get("payload") as UserToken | undefined;
  if (!payload) return c.redirect("/auth/login");

  const body = await c.req.formData();
  const username = (body.get("username") as string || "").trim();
  const password = body.get("password") as string || "";
  const csrf = (body.get("csrf") as string || "").trim();

  // CSRF 検証（タイミング安全比較）
  const csrfRec = await kv.get(["csrf", payload.UserID]);
  const expectedCsrf = (csrfRec?.value as any)?.token || "";
  if (!expectedCsrf || !csrf || !timingSafeEqual(expectedCsrf, csrf)) {
    return c.text("CSRF トークンが不正です", 403);
  }

  if (!username || !password) {
    return c.text("入力してね", 400);
  }
  if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
    return c.text("ユーザー名は英数字と _ の 3-32 文字", 400);
  }
  if (password.length < 8) {
    return c.text("パスワードは8文字以上", 400);
  }
  const exists = await kv.get(["users", username]);
  if (exists.value) {
    return c.text("既に居るで", 409);
  }

  // ---- PBKDF2 ハッシュ生成 ----
  const PBKDF2_ITERATIONS = 120_000; // 調整可能
  const HASH_LENGTH = 32; // 32 bytes = 256bit
  const enc = new TextEncoder();
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = toHex(saltBytes);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    HASH_LENGTH * 8
  );
  const hashHex = toHex(derivedBits);
  await kv.set(["users", username], {
    UserID: username,
    passwordHash: hashHex,
    salt: saltHex,
    algo: "pbkdf2-sha256",
    params: { iterations: PBKDF2_ITERATIONS, hashLength: HASH_LENGTH }
  });
  return c.text("作成しました");
});

export const admin = app;
