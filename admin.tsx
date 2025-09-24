import { Hono } from "hono";
import { kv, env, urlcheck } from "./server.tsx";
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

// 管理者専用ミドルウェア
app.use(async (c, next) => {
  const SECRET_KEY = env.get("SECRET_KEY")!;
  const base_token = await getSignedCookie(c, SECRET_KEY, "token");
  if (!base_token) {
    console.error("トークンがありません");
    return c.redirect("/auth/login");
  }
  let token: UserToken;
  try {
    token = await verify(base_token, SECRET_KEY) as UserToken;
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
    console.error("ユーザーIDが一致しません");
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
  c.set("payload", token);
  await next();
});

// 短縮作成 (GET フォーム + GET 送信の既存仕様を維持)
// ただし (1) URL バリデーション復活 (2) 既存キー上書き防止 (atomic)
app.get("/", async (c) => {
  const url = c.req.query("url");
  const key = c.req.query("key");
  const ip = c.req.query("ip");

  if (!url || !key) {
    return c.render(
      <div>
        <h1>たんLink (管理)</h1>
        <p>短縮URL作成 (既存キー上書き不可)</p>
        <form method="get">
          <input type="text" name="url" placeholder="URL" />
          <input type="text" name="key" placeholder="key" required />
          <input type="text" name="ip" placeholder="IP規制 (オプション)" />
          <button type="submit">短縮</button>
        </form>
        <p style="color:gray;font-size:0.9em">
          本来は CSRF 対策のため POST + CSRF Token 推奨。最小変更のため既存 GET を暫定継続。
        </p>
      </div>,
    );
  }

  if (!/^[0-9A-Za-z]{3,32}$/.test(key)) {
    return c.text("key は英数字 3-32 文字", 400);
  }

  if (!urlcheck(url)) {
    return c.text("URLじゃありません (http/https のみ)", 400);
  }

  // 既存キー存在チェック (atomic で同時書き込み競合も防止)
  const atomic = kv.atomic()
    .check({ key: ["links", key], versionstamp: null })
    .set(["links", key], url);
  const ipRegex = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-fA-F0-9:]+)$/;
  if (ip && ipRegex.test(ip)) {
    atomic.set(["links", key, "ip"], ip);
  }
  const res = await atomic.commit();
  if (!res.ok) {
    return c.text("その key は既に使われています", 409);
  }

  return c.render(
    <div>
      <h1>たんLink</h1>
      <p>短縮URL (作成成功)</p>
      <a
        href={`https://tanlink.deno.dev/${key}`}
        id="a"
        rel="noopener noreferrer"
      >
        {`https://tanlink.deno.dev/${key}`}
      </a>
    </div>,
  );
});

app.get("/createUser", (c) => {
  return c.render(
    <>
      <h1>新しいUserを作成してみよう!!</h1>
      <form method="post">
        <input type="text" name="username" placeholder="username" />
        <input type="password" name="password" placeholder="password" />
        <button type="submit">作成</button>
      </form>
    </>,
  );
});

// ユーザー作成 (管理者のみ)
app.post("/createUser", async (c) => {
  const body = await c.req.formData();
  const username = (body.get("username") as string || "").trim();
  const password = body.get("password") as string || "";
  if (!username || !password) {
    return c.text("入力してください", 400);
  }
  if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
    return c.text("ユーザー名は英数字と _ の 3-32 文字", 400);
  }
  if (password.length < 8) {
    return c.text("パスワードは8文字以上", 400);
  }
  const exists = await kv.get(["users", username]);
  if (exists.value) {
    return c.text("既に存在します", 409);
  }
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(saltBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(saltHex + password),
  );
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await kv.set(["users", username], {
    UserID: username,
    passwordHash: hashHex,
    salt: saltHex,
  });
  return c.text("作成しました");
});

export const admin = app;
