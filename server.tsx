// deno-lint-ignore-file
/** @jsx jsx */
/** @jsxFrag Fragment */
/// <reference lib="deno.unstable" />
import { Hono } from "https://deno.land/x/hono@v4.0.7/mod.ts";
import { customAlphabet } from "npm:nanoid";
import {
  compress,
  jsx,
  logger,
  serveStatic,
} from "https://deno.land/x/hono@v4.0.7/middleware.ts";

const app = new Hono();
const kv = await Deno.openKv();

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  7,
);

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

app.use("*", compress({ encoding: "gzip" }));
app.use("*", logger());
app.use(async (c, next) => {
  c.setRenderer((content) => {
    return c.html(
      <html>
        <head>
          <title>たんりんく</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>{content}</body>
      </html>
    )
  })
  await next()
})
app.get("/", async (c) => {
  const url: string = c.req.query("url");
  if (!url) {
    return c.html(
      <Layout title="たんLink">
        <h1>たんLink</h1>
        <p>URLを短縮できるサービスです</p>
        <input type="text" name="a" id="a" />
        <button type="button" onclick="on()">onclick</button>
        <p>https://tanlink.deno.dev/?url=短縮したいURL</p>
        <p>https://tanlink.deno.dev/短縮後のキー</p>
      </Layout>,
    );
  }
  if (!urlcheck(url)) return c.text("URLじゃないよ");
  const { key } = await shorten(url);
  return c.html(
    <Layout title="たんLink">
      <h1>たんLink</h1>
      <p>短縮URL</p>
      <a href={`https://tanlink.deno.dev/${key}`} id="a">
        {`https://tanlink.deno.dev/${key}`}
      </a>
      <button onclick="copyToClipboard()">Copy text</button>
      <script src="./onclick.js"></script>
    </Layout>,
  );
});
app.get(
  "/onclick.js",
  serveStatic("./onclick.js"),
);
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const aredayo = await kv.get([id]);
  return c.redirect(aredayo.value);
  // return c.text(aredayo.value);
});
Deno.serve(app.fetch);
