import { migrateDatabase } from "../src/migrations.js";
import { loadRootEnv } from "./load-root-env.js";

loadRootEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run database migrations.");
}

await migrateDatabase(databaseUrl);
console.log("Roavia database migrations applied successfully.");
