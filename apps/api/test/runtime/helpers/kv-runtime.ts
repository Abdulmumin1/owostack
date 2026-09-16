/**
 * Minimal stateful KV namespace for runtime tests. Unlike Cloudflare KV it is
 * strongly consistent, which is what we want when asserting that a cache
 * invalidation boundary is honoured.
 */
export class StatefulRuntimeKv {
  private readonly entries = new Map<string, string>();

  async get(key: string, type?: "json"): Promise<unknown> {
    const value = this.entries.get(key) ?? null;
    return type === "json" && value ? JSON.parse(value) : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  keys(): string[] {
    return Array.from(this.entries.keys());
  }
}
