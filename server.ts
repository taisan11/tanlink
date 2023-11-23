/// <reference lib="deno.unstable" />
import { Hono } from "https://deno.land/x/hono@v3.10.2/mod.ts";
import { customAlphabet } from "npm:nanoid@3.1.16";

const app = new Hono();
// const kv = await Deno.openKv("kv.sqlite");

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  7,
);

app.get("/", (c) => c.text(nanoid()));

Deno.serve(app.fetch);
