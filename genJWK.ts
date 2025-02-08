import {HonoJsonWebKey} from "hono/utils/jwt/types"

async function generateHS256JWK() {
    // HMAC (HS256) 用の鍵を生成
    const key = await crypto.subtle.generateKey(
        {
            name: "HMAC",
            hash: "SHA-256"
        },
        true,  // 鍵をエクスポート可能にする
        ["sign", "verify"]
    );

    // 秘密鍵（対称鍵）をJWKとしてエクスポート
    const jwk = await crypto.subtle.exportKey("jwk", key) as HonoJsonWebKey;

    // JWKに「kid」などの追加情報を付与（オプション）
    jwk.alg = "HS256"; // アルゴリズム指定
    jwk.use = "sig";   // 署名用途
    jwk.kid = crypto.randomUUID(); // 一意のキーID

    return jwk;
}

// 実行
generateHS256JWK().then(console.log);
