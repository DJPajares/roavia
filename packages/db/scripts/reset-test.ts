import { resetAndMigrateTestDatabase } from "../src/migrations.js";
import { loadRootEnv } from "./load-root-env.js";

loadRootEnv();

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required to reset the test database.");
}

await resetAndMigrateTestDatabase(testDatabaseUrl);
console.log("Roavia test database reset and migrated successfully.");
