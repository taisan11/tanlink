import { Hono } from "hono";
import { kv,env } from "./server.tsx"
import { verify,sign } from 'hono/jwt'
import {getSignedCookie,setSignedCookie,deleteCookie} from "hono/cookie"
import { User } from "./kv_types.ts";
import type {UserToken} from "./admin.tsx"

const app = new Hono();

// ---- Rate limiting (per IP + username) ----
// In-memory only (resets on deploy). For production, back with persistent / distributed store.
interface AttemptInfo { count: number; first: number; lockedUntil?: number }
const loginAttempts = new Map<string, AttemptInfo>();
const MAX_ATTEMPTS = 5;          // attempts allowed inside window
const WINDOW_MS = 60_000;        // 1 minute rolling window
const LOCK_MS = 5 * 60_000;      // lock 5 minutes after exceed
function ipFrom(c: any): string {
  const xf = c.req.header("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-real-ip") ||
    c.req.header("x-client-ip") ||
    "unknown"
  );
}
function attemptKey(c: any, username: string | null) {
  return ipFrom(c) + "|" + (username ?? "");
}

app.get("/login", (c) => {
    return c.render(
        <div>
            <h1>たんりんくLogin</h1>
            {c.req.query("e") ? <p>ユーザー名またはパスワードが間違っています</p> : null}
            <form method="post">
                <input type="text" name="username" placeholder="ユーザー名" />
                <input type="password" name="password" placeholder="パスワード" />
                <button type="submit">ログイン</button>
            </form>
        </div>
    )
})

app.post("/login", async (c) => {
    // 全ケースでランダムスリープを行いタイミング情報を平滑化
    const baseDelayMs = 30;
    const jitterMs = 90;
    const delayPromise = new Promise(r => setTimeout(r, baseDelayMs + Math.random() * jitterMs));

    // 入力取得
    const body = await c.req.formData();
    const usernameRaw = body.get("username");
    const passwordRaw = body.get("password");
    const username = (typeof usernameRaw === "string") ? usernameRaw.trim() : "";
    const password = (typeof passwordRaw === "string") ? passwordRaw : "";

    // ---- レート制限チェック (既存ロジック利用) ----
    const key = attemptKey(c, username || null);
    const now = Date.now();
    let info = loginAttempts.get(key);
    if (info) {
        if (info.lockedUntil && info.lockedUntil > now) {
            await delayPromise;
            return c.redirect("/auth/login?e=1");
        }
        if (now - info.first > WINDOW_MS) {
            info = { count: 0, first: now };
            loginAttempts.set(key, info);
        }
    } else {
        info = { count: 0, first: now };
        loginAttempts.set(key, info);
    }
    function registerFailure() {
        if (!info) return;
        info.count++;
        if (info.count >= MAX_ATTEMPTS) {
            info.lockedUntil = Date.now() + LOCK_MS;
        }
    }
    function resetAttempts() {
        loginAttempts.delete(key);
    }

    // ---- PBKDF2 共通ヘルパ ----
    const enc = new TextEncoder();
    const DEFAULT_ITER = 120_000;
    const HASH_LEN = 32;
    const fromHex = (hex: string) => {
        const arr = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
        return arr;
    };
    const toHex = (buf: ArrayBuffer | Uint8Array) => {
        const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        return Array.from(u8).map(b => b.toString(16).padStart(2, "0")).join("");
    };
    function timingSafeHexEq(a: string, b: string) {
        const len = Math.max(a.length, b.length);
        let diff = a.length ^ b.length;
        for (let i = 0; i < len; i++) {
            const ca = a.charCodeAt(i % a.length);
            const cb = b.charCodeAt(i % b.length);
            diff |= (ca ^ cb);
        }
        return diff === 0;
    }
    async function pbkdf2Hex(pass: string, saltHex: string, iterations: number, length: number) {
        const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits(
            { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations },
            keyMaterial,
            length * 8
        );
        return toHex(bits);
    }

    // ---- 管理者 (環境変数でハッシュ化されたパスワード) ----
    // 期待環境変数:
    //   USER_NAME
    //   ADMIN_PASSWORD_HASH (hex)
    //   ADMIN_PASSWORD_SALT (hex)
    const adminUser = env.get("USER_NAME") || "admin";
    const adminHash = env.get("ADMIN_PASSWORD_HASH");
    const adminSalt = env.get("ADMIN_PASSWORD_SALT");
    const adminIter = DEFAULT_ITER;

    if (username === adminUser && adminHash && adminSalt) {
        // 管理者検証
        const derived = await pbkdf2Hex(password, adminSalt, adminIter, HASH_LEN);
        if (timingSafeHexEq(derived, adminHash)) {
            // 管理者ログイン成功
            const SECRET_KEY = env.get("SECRET_KEY")!;
            const token = await sign({ UserID: adminUser }, SECRET_KEY);
            await kv.set(["nowtoken", adminUser], token);
            await setSignedCookie(c, "token", token, SECRET_KEY, { httpOnly: true, sameSite: "Lax", secure: true });
            resetAttempts();
            await delayPromise;
            return c.redirect("/");
        } else {
            registerFailure();
            await delayPromise;
            return c.redirect("/auth/login?e=1");
        }
    }

    // ---- 一般ユーザー (全て PBKDF2 前提) ----
    if (!username || !password) {
        registerFailure();
        await delayPromise;
        return c.redirect("/auth/login?e=1");
    }

    const record = await kv.get(["users", username]);
    const user = record.value as User | undefined;

    // ダミー検証 (存在しない場合でも同程度の計算を行う)
    const dummySalt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const dummyHash = await pbkdf2Hex(password || "dummy", dummySalt, DEFAULT_ITER, HASH_LEN);

    if (!user || !user.passwordHash || !user.salt) {
        // ユーザーなし / 情報不足
        void dummyHash;
        registerFailure();
        await delayPromise;
        return c.redirect("/auth/login?e=1");
    }

    const iter = (user as any).params?.iterations || DEFAULT_ITER;
    const userDerived = await pbkdf2Hex(password, user.salt, iter, HASH_LEN);
    if (!timingSafeHexEq(userDerived, user.passwordHash)) {
        registerFailure();
        await delayPromise;
        return c.redirect("/auth/login?e=1");
    }

    // 成功
    const SECRET_KEY = env.get("SECRET_KEY")!;
    const token = await sign({ UserID: username }, SECRET_KEY);
    await setSignedCookie(c, "token", token, SECRET_KEY, { httpOnly: true, sameSite: "Lax", secure: true });
    resetAttempts();
    await delayPromise;
    return c.redirect("/");
});

app.get("/logout", (c) => {
    return c.render(
        <div>
            <h1>たんりんくLogout</h1>
            <p>ホンマにログアウトするんか?</p>
            <form method="post">
                <button type="submit">ログアウト</button>
            </form>
        </div>
    )
})

app.post("/logout", async (c) => {
    const SECRET_KEY = env.get("SECRET_KEY")!;
    const base_token = await getSignedCookie(c,SECRET_KEY,"token")
    if (!base_token) {
        console.error("トークンがありません")
        return c.redirect("/auth/login")
    }
    let token: UserToken;
    try {
        token = await verify(base_token, SECRET_KEY) as UserToken;
        const now = await kv.get(["nowtoken", token.UserID]);
        if(!now.value || now.value !== base_token){
            return c.redirect("/auth/login")
        }
    } catch (e) {
        console.error(e)
        return c.redirect("/auth/login");
    }
    if (!token.UserID||env.get("USER_NAME") !== token.UserID) {
        console.error("ユーザーIDが一致しません")
        return c.redirect("/auth/login");
    }
    await kv.delete(["nowtoken",token.UserID])
    deleteCookie(c,"token")
    return c.redirect("/auth/login")
})

export const auth = app
