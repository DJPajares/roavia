import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const acceptedConclusions = new Set(["neutral", "skipped", "success"]);

export async function verifyGitHubGates({ fetchImpl = fetch, repository, sha, token, gates }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("GITHUB_REPOSITORY must use owner/name format.");
  }
  if (!/^[a-f0-9]{40}$/i.test(sha ?? "")) throw new Error("RELEASE_SHA must be a full commit SHA.");
  if (!token) throw new Error("GITHUB_TOKEN is required to verify release gates.");
  if (!Array.isArray(gates?.requiredChecks) || gates.requiredChecks.length === 0) {
    throw new Error("Release gate manifest has no required checks.");
  }

  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?per_page=100`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`GitHub check-runs API returned ${response.status}.`);
  const body = await response.json();
  const runs = Array.isArray(body.check_runs) ? body.check_runs : [];
  const failures = [];

  for (const required of gates.requiredChecks) {
    const candidates = runs.filter((run) => run.name === required.name);
    const passed = candidates.some(
      (run) => run.status === "completed" && acceptedConclusions.has(run.conclusion),
    );
    if (!passed) {
      failures.push(
        `${required.name}: ${
          candidates.length === 0
            ? "missing"
            : candidates.map((run) => `${run.status}/${run.conclusion ?? "pending"}`).join(", ")
        }`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`Release gates are not satisfied:\n- ${failures.join("\n- ")}`);
  }
  return gates.requiredChecks.map(({ name }) => name);
}

async function main() {
  const gates = JSON.parse(
    await readFile(new URL("./gates.json", import.meta.url), { encoding: "utf8" }),
  );
  const passed = await verifyGitHubGates({
    gates,
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.RELEASE_SHA,
    token: process.env.GITHUB_TOKEN,
  });
  console.log(`Verified ${passed.length} required GitHub release checks.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
