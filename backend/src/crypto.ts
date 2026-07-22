import { createRequire } from "node:module";
import { config } from "./config.js";
import { pool } from "./db.js";

const require = createRequire(import.meta.url);
const sodium: typeof import("libsodium-wrappers") = require("libsodium-wrappers");

let key: Uint8Array;

export async function initCrypto(): Promise<void> {
  await sodium.ready;
  if (!/^[0-9a-fA-F]{64}$/.test(config.secretsKey)) {
    throw new Error(
      "SECRETS_KEY must be a 64-char hex string (openssl rand -hex 32)"
    );
  }
  key = sodium.from_hex(config.secretsKey);
}

export function encrypt(plaintext: string): { ciphertext: Buffer; nonce: Buffer } {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, key);
  return { ciphertext: Buffer.from(ct), nonce: Buffer.from(nonce) };
}

export function decrypt(ciphertext: Buffer, nonce: Buffer): string {
  const pt = sodium.crypto_secretbox_open_easy(
    new Uint8Array(ciphertext),
    new Uint8Array(nonce),
    key
  );
  return sodium.to_string(pt);
}

export async function storeSecret(ref: string, value: string): Promise<void> {
  const { ciphertext, nonce } = encrypt(value);
  await pool.query(
    `INSERT INTO secrets (ref, ciphertext, nonce)
     VALUES ($1, $2, $3)
     ON CONFLICT (ref) DO UPDATE
       SET ciphertext = EXCLUDED.ciphertext,
           nonce = EXCLUDED.nonce,
           updated_at = now()`,
    [ref, ciphertext, nonce]
  );
}

export async function readSecret(ref: string): Promise<string | null> {
  const { rows } = await pool.query(
    "SELECT ciphertext, nonce FROM secrets WHERE ref = $1",
    [ref]
  );
  if (rows.length === 0) return null;
  return decrypt(rows[0].ciphertext, rows[0].nonce);
}

export async function listSecretRefs(): Promise<{ ref: string; updated_at: string }[]> {
  const { rows } = await pool.query(
    "SELECT ref, updated_at FROM secrets ORDER BY ref"
  );
  return rows;
}

export async function deleteSecret(ref: string): Promise<void> {
  await pool.query("DELETE FROM secrets WHERE ref = $1", [ref]);
}
