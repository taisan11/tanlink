// deno-lint-ignore-file
/// <reference lib="deno.unstable" />
import { Hono } from "https://deno.land/x/hono@v3.10.2/mod.ts";
import { customAlphabet } from "npm:nanoid@3.1.16";

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

app.get("/", (c) => c.text(nanoid()));
app.get("/tan/:url", async (c) => {
  const url = c.req.param("url");
  if (!urlcheck(url)) return c.text("URLじゃないよ");
  const { key } = await shorten(url);
  return c.text(key);
});
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const aredayo = kv.get([id])
  return c.json({ [result.key]: result.value });
});

Deno.serve(app.fetch);
