import { writeFile } from "node:fs/promises";

import { getConstructionPlans } from "pg-boss";

const target = new URL("../../db/drizzle/0002_pg_boss_schema.sql", import.meta.url);
const constructionPlans = getConstructionPlans("jobs").trim();
if (!constructionPlans.startsWith("BEGIN;") || !constructionPlans.endsWith("COMMIT;")) {
  throw new Error("Unexpected pg-boss construction plan transaction boundary.");
}
const plans = constructionPlans
  .slice("BEGIN;".length, -"COMMIT;".length)
  .trim()
  .split("\n")
  .map((line) => line.trimEnd())
  .join("\n");
const migration = [
  "-- Generated from pg-boss 12.26.3 by @roavia/jobs.",
  "-- Runtime schema creation and migration are disabled; changes use the reviewed database gate.",
  plans,
  "",
].join("\n");

await writeFile(target, migration, "utf8");
