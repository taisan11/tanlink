import { Hono } from "hono"
import { kv } from "./server.tsx"
import { jwt,verify,decode,sign } from 'hono/jwt'
import type { JwtVariables } from 'hono/jwt'
import type {HonoJsonWebKey} from "hono/utils/jwt/types"

const app = new Hono()
const env = Deno.env
export const jwk = "" 

app.use(async(c,next)=>{
    if (!c.req.header("Authorization")) {
        return c.redirect("/auth/login")
    }
    const token = verify(c.req.header("Authorization"),)
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