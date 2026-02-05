import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Create Drizzle ORM instance for D1
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

// Re-export schema and types
export * from "./schema";
export { schema };
