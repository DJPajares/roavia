import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verifyGitHubGates } from "./verify-github-gates.mjs";

const sha = "a".repeat(40);
const gates = {
  requiredChecks: [{ name: "Build" }, { name: "Test" }, { name: "CodeQL" }],
};

function checksResponse(checkRuns) {
  return new Response(JSON.stringify({ check_runs: checkRuns }));
}

describe("GitHub release gates", () => {
  it("accepts only completed successful, neutral, or skipped checks", async () => {
    const passed = await verifyGitHubGates({
      fetchImpl: () =>
        Promise.resolve(
          checksResponse([
            { conclusion: "success", name: "Build", status: "completed" },
            { conclusion: "neutral", name: "Test", status: "completed" },
            { conclusion: "skipped", name: "CodeQL", status: "completed" },
          ]),
        ),
      gates,
      repository: "DJPajares/roavia",
      sha,
      token: "github-token",
    });

    assert.deepEqual(passed, ["Build", "Test", "CodeQL"]);
  });

  it("reports missing, pending, and failed gates together", async () => {
    await assert.rejects(
      () =>
        verifyGitHubGates({
          fetchImpl: () =>
            Promise.resolve(
              checksResponse([
                { conclusion: null, name: "Build", status: "in_progress" },
                { conclusion: "failure", name: "Test", status: "completed" },
              ]),
            ),
          gates,
          repository: "DJPajares/roavia",
          sha,
          token: "github-token",
        }),
      /Build: in_progress\/pending[\s\S]*Test: completed\/failure[\s\S]*CodeQL: missing/,
    );
  });
});
