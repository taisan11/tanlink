import { Hono } from "hono"
import { kv,env } from "./server.tsx"
import { jwt,verify,decode,sign } from 'hono/jwt'
import {getSignedCookie,setSignedCookie} from "hono/cookie"
import type { JwtVariables } from 'hono/jwt'
import type {HonoJsonWebKey, JWTPayload} from "hono/utils/jwt/types"
import {User} from "./kv_types.ts"
import {urlcheck} from "./server.tsx"

interface UserToken extends JWTPayload {
    UserID: string;
}

interface Env {
  Variables: {
    payload: JWTPayload;
  };
}

const app = new Hono<Env>()
export const jwk = "" 

app.use(async(c,next)=>{
    //取得.認証
    const SECRET_KEY = env.get("SECRET_KEY")!
    const base_token = await getSignedCookie(c,SECRET_KEY,"token")
    if (!base_token) {
        console.error("トークンがありません")
        return c.redirect("/auth/login")
    }
    let token: UserToken;
    try {
        token = await verify(base_token, SECRET_KEY) as UserToken;
        kv.get(["nowtoken",token.UserID]).then((r)=>{
            if(r.value !== base_token) return c.redirect("/auth/login")
        })
    } catch (e) {
        console.error(e)
        return c.redirect("/auth/login");
    }
    if (!token.UserID||env.get("USERNAME") !== token.UserID) {
        console.error("ユーザーIDが一致しません")
        return c.redirect("/auth/login");
    }
    //更新
    token.exp = Math.floor(Date.now() / 1000) + 60 * 60;
    token.iat = Math.floor(Date.now() / 1000);
    token.nbf = Math.floor(Date.now() / 1000);
    //保存
    const new_base_token = await sign(token,SECRET_KEY)
    await setSignedCookie(c,"token",new_base_token,SECRET_KEY,{httpOnly:true,sameSite:"Lax",secure:true})
    kv.set(["nowtoken",token.UserID],new_base_token)
    c.set("payload", token);
    await next()
})

app.get('/', async (c) => {
    const url = c.req.query("url");
    const key = c.req.query("key");
    if (!url||!key) {
        return c.render(
            <div>
                <h1>たんLink</h1>
                <p>短縮URL</p>
                <form method="get">
                    <input type="text" name="url" placeholder="URL" />
                    <input type="text" name="key" placeholder="key" />
                    <button type="submit">短縮</button>
                </form>
                <h2>お知らせ</h2>
                <h3>2024-2-10</h3>
                <p>メンテナンスのため今までの短縮されたリンクをすべて削除されました。</p>
                <p>これ以降は削除されない予定ですので安心してご利用ください。</p>
            </div>
        )
    }
    if (!urlcheck) return c.text("URLじゃありませんよっ!!")
    await kv.set(["links",key], url);
    return c.render(
        <div>
            <h1>たんLink</h1>
            <p>短縮URL</p>
            <a href={`https://tanlink.deno.dev/${key}`} id="a">
                {`https://tanlink.deno.dev/${key}`}
            </a>
        </div>)
})
app.get("/deleteKeys", async (c) => {
    const entries = kv.list({ prefix: [] });
    for await (const entry of entries) {
        kv.delete(entry.key);
    }
    return c.text("完了!!")
})

export const admin = app