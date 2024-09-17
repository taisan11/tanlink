/** @jsx jsx */
/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import { customAlphabet } from "npm:nanoid";
import {compress} from "hono/compress"
import {jsxRenderer} from "hono/jsx-renderer"
import {basicAuth} from "hono/basic-auth"
import {secureHeaders} from "hono/secure-headers"
import {logger} from "hono/logger"

const app = new Hono();
const kv = await Deno.openKv();

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  7,
);

app.use(
  '/auth/*',
  basicAuth({
    username: 'taijn',
    password: 'njl',
  })
)

async function shorten(url: string) {
  const key = nanoid();
  await kv.set([key], url);
  return { key };
}
//urlcheck
function urlcheck(string: string) {
  try {
    new URL(string);
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
  if (!url) {
    return c.render(
      <div>
        <h1>たんLink</h1>
        <p>URLを短縮できるサービスです</p>
        <input type="text" name="a" id="a" />
        <button onclick></button>
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
app.get('/auth',async (c) => {
  const url = String(c.req.query("url"));
  const key = String(c.req.query("key"));
  await kv.set([key], url);
  return c.render(
    <div>
      <h1>たんLink</h1>
      <p>短縮URL</p>
      <a href={`https://tanlink.deno.dev/${key}`} id="a">
        {`https://tanlink.deno.dev/${key}`}
      </a>
    </div>  )
})
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const aredayo = await kv.get([id]);
  return c.redirect(String(aredayo.value));
});
Deno.serve(app.fetch);
