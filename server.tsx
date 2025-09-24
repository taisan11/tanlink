import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { compress } from "hono/compress";
import { jsxRenderer } from "hono/jsx-renderer";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "hono/logger";
import { admin } from "./admin.tsx";
import { auth } from "./auth.tsx";
import { showRoutes } from "hono/dev";
import { HonoJsonWebKey } from "hono/utils/jwt/types";
import { getConnInfo } from "hono/deno";
import { cache } from "hono/cache";
import { etag } from "hono/etag";

const app = new Hono();
export const kv = await Deno.openKv();
export const env = Deno.env;
export const SECRET: string | HonoJsonWebKey = (() => {
  const raw = env.get("SECRET_KEY");
  if (!raw) return "";
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return raw;
  }
})();

if (!env.has("SECRET_KEY") || !env.has("USER_NAME") || !env.has("PASSWORD")) {
  console.error("環境変数不足: SECRET_KEY / USER_NAME / PASSWORD のいずれかが未設定");
}

export const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  5,
);

// URL 検証
export function urlcheck(string: string) {
  if (!URL.canParse(string)) return false;
  try {
    const u = new URL(string);
    return ["http:", "https:"].includes(u.protocol);
  } catch (_e) {
    return false;
  }
}

// 既存キーを上書きしない短縮生成 (atomic)
async function shorten(url: string) {
  while (true) {
    const key = nanoid();
    const res = await kv.atomic()
      .check({ key: ["links", key], versionstamp: null })
      .set(["links", key], url)
      .commit();
    if (res.ok) return { key };
    // 競合したら再試行
  }
}

// Host ヘッダ安全化
function safeHost(raw?: string | null): string {
  const fallback = env.get("PUBLIC_HOST") || "tanlink.deno.dev";
  if (!raw) return fallback;
  if (!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(raw)) return fallback;
  return raw;
}

app.use("*", secureHeaders());
app.use("*", compress({ encoding: "gzip" }));
app.use(
  "*",
  cache({
    cacheName: "hono-cache",
    cacheControl: "public, max-age=3600",
    vary: "Accept-Encoding",
  }),
);
app.use("*", etag());
app.use("*", logger());

app.get(
  "*",
  jsxRenderer(({ children }) => {
    return (
      <html>
        <head>
          <title>たんりんく</title>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        </head>
        <body>{children}</body>
      </html>
    );
  }),
);

// 公開トップ: GET /?url=... により短縮 (将来的には POST 化推奨)
app.get("/", async (c) => {
  const url = c.req.query("url");
  if (!url) {
    const host = safeHost(c.req.header("Host"));
    return c.render(
      <div>
        <h1>たんLink</h1>
        <p>URLを短縮できるサービスです</p>
        <form action="/" method="get">
          <input type="text" name="url" />
          <input type="submit" value="短縮!!" />
        </form>
        <p>https://{host}/?url=短縮したいURL</p>
        <p>https://{host}/短縮後のキー</p>
        <h2>お知らせ</h2>
        <h3>2024-2-10</h3>
        <p>メンテナンスのため今までの短縮されたリンクをすべて削除されました。</p>
        <p>これ以降は削除されない予定ですので安心してご利用ください。</p>
      </div>,
    );
  }
  if (!urlcheck(url)) return c.text("URLじゃないよ( http / https のみ )", 400);
  const { key } = await shorten(url);
  const host = safeHost(c.req.header("Host"));
  return c.render(
    <div>
      <h1>たんLink</h1>
      <p>短縮URL</p>
      <a href={`https://${host}/${key}`} id="a" rel="noopener noreferrer">
        {`https://${host}/${key}`}
      </a>
    </div>,
  );
});

app.route("/admin", admin);
app.route("/auth", auth);

// リダイレクト
app.get("/:id{[0-9A-Za-z]+}", async (c) => {
  const id = c.req.param("id");
  const record = await kv.get(["links", id]);
  if (!record.value) {
    return c.notFound();
  }
  const ipRec = await kv.get(["links", id, "ip"]);
  if (ipRec.value) {
    const ipcheck = getConnInfo(c).remote.address;
    if (ipcheck !== ipRec.value) {
      return c.text(`IPが違います\n${ipcheck}`, 403);
    }
  }
  if (record.value === "kari") {
    return c.render(
      <>
        <h1>仮ページ</h1>
        <p>このページは仮ページです。</p>
        <p>いつかURLが設定されるかもしれません。</p>
      </>,
    );
  }
  const target = String(record.value);
  // 念のため二重検証 (DB 改ざん/手動注入からの防御層)
  if (!urlcheck(target)) {
    return c.text("保存されたURLが不正な形式です (管理者に連絡してください)", 500);
  }
  return c.redirect(target, 302);
});

// showRoutes(app, {});
Deno.serve(app.fetch);
