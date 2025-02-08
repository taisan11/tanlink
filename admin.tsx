import { Hono } from "hono"
import { kv } from "./server.tsx"
import { jwt,verify,decode,sign } from 'hono/jwt'
import {getSignedCookie,setSignedCookie} from "hono/cookie"
import type { JwtVariables } from 'hono/jwt'
import type {HonoJsonWebKey, JWTPayload} from "hono/utils/jwt/types"
import {User} from "./kv_types.ts"

interface UserToken extends JWTPayload {
    UserID: string;
}

interface Env {
  Variables: {
    payload: JWTPayload;
  };
}

const app = new Hono<Env>()
const env = Deno.env
export const jwk = "" 

app.use(async(c,next)=>{
    //取得.認証
    const SECRET_KEY = env.get("SECRET_KEY")!
    const base_token = await getSignedCookie(c,SECRET_KEY,"token","secure")
    if (!base_token) {
        return c.redirect("/auth/login")
    }
    let token: UserToken;
    try {
        token = await verify(base_token, SECRET_KEY) as UserToken;
        kv.get(["nowtoken",token.UserID]).then((r)=>{
            if(r.value !== token) return c.redirect("/auth/login")
        })
    } catch (e) {
        return c.redirect("/auth/login");
    }
    if (!token.UserID) {
        return c.redirect("/auth/login");
    }
    //更新
    token.exp = Math.floor(Date.now() / 1000) + 60 * 60;
    token.iat = Math.floor(Date.now() / 1000);
    token.nbf = Math.floor(Date.now() / 1000);
    //保存
    await setSignedCookie(c,SECRET_KEY,"token",await sign(token,SECRET_KEY),{httpOnly:true,sameSite:"Lax",secure:true})
    kv.set(["nowtoken",token.UserID],token)
    kv.get(["Users",token.UserID]).then((r)=>{
        const user = r.value as User | null;
        if (!user || !user.admin) return c.redirect("/auth/login");
    })
    c.set("payload", token);
    await next()
})

app.get('/', async (c) => {
    const url = String(c.req.query("url"));
    const key = String(c.req.query("key"));
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
})

export const admin = app