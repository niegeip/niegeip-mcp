import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
const rowsSchema = z.array(
  z.tuple([z.string(), z.object({ expires: z.number(), value: z.unknown() })]),
);
export const randomToken = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
// Single-writer deployment. All state, including upstream credentials, is encrypted at rest.
export class Store {
  private rows = new Map<string, { expires: number; value?: unknown }>();
  private key: Buffer;
  constructor(
    private path: string,
    key: string,
    private now = () => Date.now(),
  ) {
    this.key = Buffer.from(key, "hex");
    if (this.key.length !== 32) throw new Error("State key must be 32 bytes");
    if (existsSync(path)) {
      const encrypted = readFileSync(path);
      if (encrypted.length < 29) throw new Error("Invalid encrypted state");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        encrypted.subarray(0, 12),
      );
      decipher.setAuthTag(encrypted.subarray(12, 28));
      const plain = Buffer.concat([
        decipher.update(encrypted.subarray(28)),
        decipher.final(),
      ]);
      this.rows = new Map(rowsSchema.parse(JSON.parse(plain.toString())));
    }
  }
  get<T>(key: string, schema: { parse(value: unknown): T }): T | undefined {
    const row = this.rows.get(key);
    if (!row || row.expires <= this.now()) return undefined;
    return schema.parse(row.value);
  }
  set(key: string, value: unknown, ttlMs: number) {
    const next = new Map(this.rows);
    for (const [k, v] of next) if (v.expires <= this.now()) next.delete(k);
    if (next.size >= 20000 && !next.has(key))
      throw new Error("State capacity reached");
    next.set(key, { expires: this.now() + ttlMs, value });
    this.flush(next);
    this.rows = next;
  }
  delete(key: string) {
    const next = new Map(this.rows);
    next.delete(key);
    this.flush(next);
    this.rows = next;
  }
  private flush(rows: Map<string, { expires: number; value?: unknown }>) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify([...rows])),
      cipher.final(),
    ]);
    const temp = this.path + ".tmp";
    writeFileSync(temp, Buffer.concat([iv, cipher.getAuthTag(), data]), {
      mode: 0o600,
    });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }
}
