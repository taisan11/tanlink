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

app.get("/", (c) => c.text(nanoid()));
app.get("/tan/:url", async (c) => {
  const url = c.req.param("url");
  const { key } = await shorten(url);
  return c.text(key);
});
app.get("/:id", async (c) => {
  const id = c.req.param("id");
});

Deno.serve(app.fetch);
