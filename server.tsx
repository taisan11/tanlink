import { Hono } from "hono";
import { customAlphabet } from "npm:nanoid";
import {compress} from "hono/compress"
import {jsxRenderer} from "hono/jsx-renderer"
import {secureHeaders} from "hono/secure-headers"
import {logger} from "hono/logger"
import { admin } from "./admin.tsx";
import { auth } from "./auth.tsx";
import { showRoutes } from "hono/dev";
import { HonoJsonWebKey } from "hono/utils/jwt/types";
import { getConnInfo } from "hono/deno";

const app = new Hono();
export const kv = await Deno.openKv();
export const env = Deno.env
export const SECRET:string|HonoJsonWebKey = (() => {
  try {
    return JSON.parse(env.get("SECRET_KEY")!);
  } catch (_e) {
    env.get("SECRET_KEY")
  }
})();

//環境変数チェック!!
if (!env.has("SECRET_KEY")||!env.has("USER_NAME")||!env.has("PASSWORD")) {
  console.error("なんかしらの環境変数がない");
}

export const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  5,
);

async function shorten(url: string) {
  const key = nanoid();
  await kv.set(["links",key], url);
  return { key };
}
//urlcheck
export function urlcheck(string: string) {
  return URL.canParse(string);
}

app.use('*', secureHeaders())
app.use("*", compress({ encoding: "gzip" }));
app.use("*", logger());
app.get(
  '*',
  jsxRenderer(({ children }) => {
    return (
      <html>
        <head>
          <title>たんりんく</title>
          <meta charset="UTF-8"/>
          <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        </head>
        <body>{children}</body>
      </html>
    )
  })
)
app.get("/", async (c) => {
  const url = c.req.query("url");
  if (!url) {
    return c.render(
      <div>
        <h1>たんLink</h1>
        <p>URLを短縮できるサービスです</p>
        <form action="/" method="get">
          <input type="text" name="url" />
          <input type="submit" value="短縮!!" />
        </form>
        <p>https://{c.req.header("Host")}/?url=短縮したいURL</p>
        <p>https://{c.req.header("Host")}/短縮後のキー</p>
        <h2>お知らせ</h2>
        <h3>2024-2-10</h3>
        <p>メンテナンスのため今までの短縮されたリンクをすべて削除されました。</p>
        <p>これ以降は削除されない予定ですので安心してご利用ください。</p>
      </div>
    );
  }
  if (!urlcheck(url)) return c.text("URLじゃないよ");
  const { key } = await shorten(url);
  return c.render(
    <div>
      <h1>たんLink</h1>
      <p>短縮URL</p>
      <a href={`https://${c.req.header("Host")}/${key}`} id="a">
        {`https://${c.req.header("Host")}/${key}`}
      </a>
    </div>,
  );
});
app.route("/admin",admin)
app.route("/auth",auth)
app.get("/:id{[0-9A-Za-z]+}", async (c) => {
  const id = c.req.param("id");
  const aredayo = await kv.get(["links", id]);
  if (!aredayo.value) {
    return c.notFound()
  }
  const ip = kv.get(["links", id, "ip"]);
  if ((await ip).value) {
    const ipcheck = getConnInfo(c).remote.address;
    if (ipcheck !== (await ip).value) {
      return c.text(`IPが違います\n${ipcheck}`, 403);
    }
  }
  return c.redirect(String(aredayo.value));
});
showRoutes(app, {})
Deno.serve(app.fetch);