// deno-lint-ignore-file
/** @jsx jsx */
/** @jsxFrag Fragment */
/// <reference lib="deno.unstable" />
import { Hono } from "https://deno.land/x/hono@v3.10.2/mod.ts";
import { customAlphabet } from "npm:nanoid@3.1.16";
import { logger,compress,html,jsx,serveStatic } from "https://deno.land/x/hono@v3.10.2/middleware.ts"

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
    new URL(string); return true; 
  } catch (err) { 
    return false; 
  }
}

app.use("*", compress({ encoding: "gzip" }));
app.use('*', logger())
const Layout = (props: Props) =>
  html`<!DOCTYPE html><html><head><title>${props.title}</title><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body>${props.children}</body></html>`;
app.get("/", async (c) => {
  const url: string = c.req.query('url');
  if (!url) return c.html(
    <Layout title="たんLink">
      <h1>たんLink</h1>
      <p>URLを短縮できるサービスです</p>
      <p>https://tanlink.deno.dev/?url=短縮したいURL</p>
      <p>https://tanlink.deno.dev/短縮後のキー</p>
    </Layout>,
  );
  if (!urlcheck(url)) return c.text("URLじゃないよ");
  const { key } = await shorten(url);
  return c.html(
    <Layout title="たんLink">
      <h1>たんLink</h1>
      <p>短縮URL</p>
      <a href={`https://tanlink.deno.dev/${key}`} id="a">{`https://tanlink.deno.dev/${key}`}</a>
      <button onclick="copyToClipboard()">Copy text</button>
      <script src="./onclick.js"></script>
    </Layout>
  );
});
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const aredayo = await kv.get([id])
  return c.redirect(aredayo.value);
  // return c.text(aredayo.value);
});
app.get(
  "/onclick.js",
  serveStatic("./onclick.js")
);

Deno.serve(app.fetch);
