import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseClient {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

export function createDatabaseClient(config: PoolConfig | string): DatabaseClient {
  const pool = new Pool(typeof config === "string" ? { connectionString: config } : config);
  const db = drizzle({ client: pool, schema });

  return {
    db,
    pool,
    close: () => pool.end(),
  };
}
