import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { checkPerformanceBudget } from "./performance-budget.mjs";

const generousBudget = {
  largestJavaScriptGzipBytes: 10_000,
  totalCssGzipBytes: 10_000,
  totalJavaScriptGzipBytes: 10_000,
};

async function withAssets(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "roavia-performance-"));
  await mkdir(path.join(directory, "chunks"));
  try {
    await run(path.join(directory, "chunks"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

describe("production asset performance budget", () => {
  it("measures compressed JavaScript and CSS assets", async () => {
    await withAssets(async (staticDirectory) => {
      await writeFile(path.join(staticDirectory, "app.js"), "console.log('roavia');".repeat(20));
      await writeFile(path.join(staticDirectory, "app.css"), ".app{display:block}".repeat(20));

      const result = await checkPerformanceBudget({ budget: generousBudget, staticDirectory });
      assert.equal(result.javascriptFiles, 1);
      assert.equal(result.cssFiles, 1);
      assert.ok(result.totalJavaScriptGzipBytes > 0);
    });
  });

  it("fails when a production chunk exceeds the reviewed limit", async () => {
    await withAssets(async (staticDirectory) => {
      await writeFile(path.join(staticDirectory, "large.js"), randomBytes(2_048));

      await assert.rejects(
        checkPerformanceBudget({
          budget: { ...generousBudget, largestJavaScriptGzipBytes: 100 },
          staticDirectory,
        }),
        /performance budget exceeded/,
      );
    });
  });
});
