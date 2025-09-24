const DEFAULT_ITERATIONS = 120_000;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function derivePBKDF2Hex(password: string, saltHex: string, iterations: number, lengthBytes: number) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const salt = hexToUint8(saltHex);
  const saltBuf = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuf, iterations },
    keyMaterial,
    lengthBytes * 8,
  );
  return toHex(bits);
}

function hexToUint8(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

function genSaltHex(bytes = 16): string {
  const s = crypto.getRandomValues(new Uint8Array(bytes));
  return toHex(s);
}

function readLine(promptText: string, defaultValue?: string): string | null {
  const res = prompt(promptText + (defaultValue ? ` (default: ${defaultValue})` : ""));
  if (res === null) return null;
  if (res === "" && defaultValue !== undefined) return defaultValue;
  return res;
}

async function main() {
    const iterations = DEFAULT_ITERATIONS;
    if (Number.isNaN(iterations) || iterations <= 0) {
      console.error("Invalid iterations argument. Must be a positive integer.");
      Deno.exit(1);
    }

    const username = readLine("Admin username", "admin");
    if (username === null) {
      console.error("No username provided. Exiting.");
      Deno.exit(1);
    }

    // NOTE: prompt() will echo input on many terminals. For non-echoing input,
    // replace this with a secure password prompt implementation.
    const password = prompt("Admin password (will be visible while typing)");
    if (!password) {
      console.error("No password provided. Exiting.");
      Deno.exit(1);
    }

    const saltHex = genSaltHex(16); // 16 bytes -> 32 hex chars
    const hashHex = await derivePBKDF2Hex(password, saltHex, iterations, 32); // 32 bytes (256-bit)

    // Print as environment variable lines (shell-friendly)
    console.log("\n# Add these to your environment (or secrets manager):\n");
    console.log(`ADMIN_USER="${username}"`);
    console.log(`ADMIN_PASSWORD_SALT="${saltHex}"`);
    console.log(`ADMIN_PASSWORD_HASH="${hashHex}"`);
    console.log(`ADMIN_PASSWORD_ITER="${iterations}"`);
    console.log("");
  }

await main()
