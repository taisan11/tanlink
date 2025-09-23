export interface url {
    url: string;
}

export interface urlOption {
    IPaddr: string;
}

export interface User {
    UserID: string;
    /**
     * PBKDF2 もしくは SHA-256 などでハッシュ化したパスワード
     * 互換性のため legacy 平文ユーザーの場合は login 時に自動移行
     */
    passwordHash?: string;
    /** ランダムソルト(16 bytes -> hex 32chars) */
    salt?: string;
    /** legacy: 平文パスワード(存在したら危険・ログイン成功時に削除) */
    password?: string;
}