import { createDb } from "@owostack/db";
import { createSqliteD1Database } from "./sqlite-d1";

export function createRuntimeBusinessDb() {
  const d1 = createSqliteD1Database();
  const db = createDb(d1);

  return {
    d1,
    db,
    close() {
      d1.close();
    },
  };
}
