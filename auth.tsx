import { Hono } from "hono";
import { kv,env } from "./server.tsx"
import { verify,sign } from 'hono/jwt'
import {getSignedCookie,setSignedCookie,deleteCookie} from "hono/cookie"
import { User } from "./kv_types.ts";
import type {UserToken} from "./admin.tsx"

const app = new Hono();

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
    //取得
    const body = await c.req.formData();
    const username = body.get("username");
    const password = body.get("password");
    //admin用
    const adminUsername = env.get('USER_NAME') || 'admin';
    const adminPassword = env.get('PASSWORD') || 'password';
    if (username === adminUsername && password === adminPassword) {
        const SECRET_KEY = env.get("SECRET_KEY")!;
        const token = await sign({ UserID: adminUsername }, SECRET_KEY);
        await kv.set(["nowtoken", adminUsername], token);
        await setSignedCookie(c, "token", token,SECRET_KEY, { httpOnly: true, sameSite: "Lax", secure: true});
        return c.redirect("/");
    }
    //user用
    const record = username ? await kv.get(["users", username.toString()]) : null;
    const user = (record?.value as User | undefined) || null;
    if(user){
        const enc = new TextEncoder();
        // legacy 平文 -> ハッシュへ移行
        if(user.password && !user.passwordHash){
            const saltBytes = crypto.getRandomValues(new Uint8Array(16));
            const saltHex = Array.from(saltBytes).map(b=>b.toString(16).padStart(2,"0")).join("");
            const legacyHashBuffer = await crypto.subtle.digest("SHA-256", enc.encode(saltHex + user.password));
            const legacyHashHex = Array.from(new Uint8Array(legacyHashBuffer)).map(b=>b.toString(16).padStart(2,"0")).join("");
            await kv.set(["users", username!.toString()], {UserID: user.UserID, passwordHash: legacyHashHex, salt: saltHex});
            user.passwordHash = legacyHashHex; user.salt = saltHex; delete user.password;
        }
        if(user.passwordHash && user.salt){
            const hashBuffer = await crypto.subtle.digest("SHA-256", enc.encode(user.salt + password));
            const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b=>b.toString(16).padStart(2,"0")).join("");
            // timing safe compare
            let diff = 0; for(let i=0;i<hashHex.length;i++){ diff |= (hashHex.charCodeAt(i) ^ user.passwordHash.charCodeAt(i)); }
            if(diff === 0){
                const SECRET_KEY = env.get("SECRET_KEY")!;
                const token = await sign({ UserID: username }, SECRET_KEY);
                await setSignedCookie(c, "token", token,SECRET_KEY, { httpOnly: true, sameSite: "Lax", secure: true });
                return c.redirect("/");
            }
        }
    }
    return c.redirect("/auth/login?e=1");
})

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