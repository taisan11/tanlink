/**
 * Shared KV stored types (PBKDF2 専用版).
 * 既に legacy (平文 / sha256-salt) 方式は廃止済みという前提。
 * 将来 Argon2id 等へ拡張する場合は `algo` と `params` を利用。
 */
export interface UrlRecord {
  url: string;
}

export interface UrlOption {
  IPaddr: string;
}

/**
 * 現行サポートするパスワードハッシュ方式。
 * - 'pbkdf2-sha256' : デフォルト
 * - 'argon2id'      : 将来導入予定 (未使用なら保存されない)
 */
export type PasswordAlgo =
  | 'pbkdf2-sha256'
  | 'argon2id';

export interface User {
  UserID: string;

  /**
   * パスワードハッシュ (hex)
   * pbkdf2-sha256 なら 32 bytes (256-bit) 推奨。
   */
  passwordHash: string;

  /**
   * ソルト (hex)
   */
  salt: string;

  /**
   * 利用アルゴリズム (省略時は 'pbkdf2-sha256')
   */
  algo?: PasswordAlgo;

  /**
   * アルゴリズムパラメータ (iterations / memory / parallelism / hashLength など)
   */
  params?: {
    iterations?: number;
    memoryKiB?: number;
    parallelism?: number;
    hashLength?: number;
    [k: string]: unknown;
  };
}