import { readFile, readdir, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import path from "node:path";

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(file) : [file];
    }),
  );
  return nested.flat();
}

async function gzipSize(file) {
  const raw = await readFile(file);
  return { gzipBytes: gzipSync(raw, { level: 9 }).byteLength, rawBytes: (await stat(file)).size };
}

function requireBudget(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Performance budget ${name} must be a positive integer.`);
  }
  return value;
}

export async function checkPerformanceBudget({ budget, staticDirectory }) {
  const limits = {
    largestJavaScriptGzipBytes: requireBudget(
      budget.largestJavaScriptGzipBytes,
      "largestJavaScriptGzipBytes",
    ),
    totalCssGzipBytes: requireBudget(budget.totalCssGzipBytes, "totalCssGzipBytes"),
    totalJavaScriptGzipBytes: requireBudget(
      budget.totalJavaScriptGzipBytes,
      "totalJavaScriptGzipBytes",
    ),
  };
  const files = await listFiles(staticDirectory);
  const javascript = await Promise.all(files.filter((file) => file.endsWith(".js")).map(gzipSize));
  const css = await Promise.all(files.filter((file) => file.endsWith(".css")).map(gzipSize));
  if (javascript.length === 0) throw new Error("No production JavaScript chunks were found.");

  const result = {
    cssFiles: css.length,
    javascriptFiles: javascript.length,
    largestJavaScriptGzipBytes: Math.max(...javascript.map(({ gzipBytes }) => gzipBytes)),
    totalCssGzipBytes: css.reduce((total, { gzipBytes }) => total + gzipBytes, 0),
    totalJavaScriptGzipBytes: javascript.reduce((total, { gzipBytes }) => total + gzipBytes, 0),
  };
  const failures = Object.entries(limits)
    .filter(([name, limit]) => result[name] > limit)
    .map(([name, limit]) => `${name}: ${result[name]} > ${limit}`);
  if (failures.length > 0) {
    throw new Error(`Production asset performance budget exceeded:\n- ${failures.join("\n- ")}`);
  }
  return result;
}

async function main() {
  const budget = JSON.parse(
    await readFile(new URL("./performance-budget.json", import.meta.url), "utf8"),
  );
  const result = await checkPerformanceBudget({
    budget,
    staticDirectory: path.resolve("apps/web/.next/static"),
  });
  console.log(`Production asset performance budget passed: ${JSON.stringify(result)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
