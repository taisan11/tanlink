import { Hono } from "hono";
import { kv,env } from "./server.tsx"
import { jwt,verify,decode,sign } from 'hono/jwt'
import {getSignedCookie,setSignedCookie} from "hono/cookie"
import { User } from "./kv_types.ts";

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
    const adminUsername = env.get('USERNAME') || 'admin';
    const adminPassword = env.get('PASSWORD') || 'password';
    if (username === adminUsername && password === adminPassword) {
        const SECRET_KEY = env.get("SECRET_KEY")!;
        const token = await sign({ UserID: adminUsername }, SECRET_KEY);
        await kv.set(["nowtoken", adminUsername], token);
        await setSignedCookie(c, SECRET_KEY, "token", token, { httpOnly: true, sameSite: "Lax", secure: true });
        return c.redirect("/");
    }
    //user用
    const normalUser = username ? kv.get(["Users", username.toString()]) : null;
    const user = (normalUser ? (await normalUser).value : null) as User | null;
    if (username === user!.UserID && password === user!.password) {
        const SECRET_KEY = env.get("SECRET_KEY")!;
        const token = await sign({ UserID: username }, SECRET_KEY);
        await setSignedCookie(c, SECRET_KEY, "token", token, { httpOnly: true, sameSite: "Lax", secure: true });
        return c.redirect("/");
    }
    return c.redirect("/auth/login?e=1");
})

export const auth = app