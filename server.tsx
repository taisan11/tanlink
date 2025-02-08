import { Hono } from "hono";
import { customAlphabet } from "npm:nanoid";
import {compress} from "hono/compress"
import {jsxRenderer} from "hono/jsx-renderer"
import {secureHeaders} from "hono/secure-headers"
import {logger} from "hono/logger"
import { admin } from "./admin.tsx";
import { auth } from "./auth.tsx";

const app = new Hono();
export const kv = await Deno.openKv();
export const env = Deno.env

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
function urlcheck(string: string) {
  try {
    URL.parse(string);
    return true;
  } catch (err) {
    return false;
  }
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
  const url = String(c.req.query("url"));
  if (url === "undefined") {
    return c.render(
      <div>
        <h1>たんLink</h1>
        <p>URLを短縮できるサービスです</p>
        <input type="text" name="a" id="a" />
        <button onclick>Go!!</button>
        <p>https://tanlink.deno.dev/?url=短縮したいURL</p>
        <p>https://tanlink.deno.dev/短縮後のキー</p>
        <p>https://tanlink.deno.dev/auth/?url=aaaa&key=aaaa</p>
      </div>
    );
  }
  if (!urlcheck(url)) return c.text("URLじゃないよ");
  const { key } = await shorten(url);
  return c.render(
    <div>
      <h1>たんLink</h1>
      <p>短縮URL</p>
      <a href={`https://tanlink.deno.dev/${key}`} id="a">
        {`https://tanlink.deno.dev/${key}`}
      </a>
    </div>,
  );
});
app.route("/admin",admin)
app.route("/auth",auth)
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const aredayo = await kv.get(["links",id]);
  return c.redirect(String(aredayo.value));
});
Deno.serve(app.fetch);
