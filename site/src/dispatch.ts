import type { Env } from "./env";
import { GITHUB_TIMEOUT_MS, WORKFLOW_FILES, type WorkflowFile, faultName, githubHeaders, workflowRepo, workflowUrl } from "./github";

// The Worker's own cron starts the nightly refresh and the same-day job
// through GitHub's API (docs/site-deploy.md, "What starts the runs"). GitHub
// starts a scheduled workflow when it can, and from about 2026-11-17 it
// started this repository's hours late or not at all, while Cloudflare's
// cron fired the Worker's schedules on time every day. The workflows keep
// GitHub's schedules at the same times as the fallback, and the nightly's
// gate job keeps a second start from running a finished day again.
//
// startWorkflow is called from the default export's scheduled handler alone
// (src/index.tsx), never from a route: no request to the site can start a
// run (test/dispatch.test.ts holds this module's one importer and its one
// host). The secret WORKFLOW_RUN is the switch: a fine-grained GitHub token
// for this one repository that can start workflow runs (Actions: read and
// write), set with `wrangler secret put WORKFLOW_RUN`. Without it, or without
// the WORKFLOW_REPO variable, nothing is sent and the runs start on GitHub's
// schedule alone. The token goes only to api.github.com, in the Authorization
// header; a log line names the workflow and the answer's status, never the
// token, the answer's body or the request's headers. Nothing here throws.

// The nightly's three slots (12:30, the run; 16:30 and 20:30, the retries its
// gate skips after a clean run), the schedules of .github/workflows/nightly.yml.
export const NIGHTLY_CRON = "30 12,16,20 * * *";
// The same-day job's nine runs, at 45 minutes past every odd hour from 11 to
// 23 and of 1 and 3 UTC, the schedules of .github/workflows/intraday.yml.
export const SAME_DAY_CRON = "45 1,3,11,13,15,17,19,21,23 * * *";

// The nightly's input: its gate job decides whether the night has anything
// to do, as it does for GitHub's own schedules. A run started by hand leaves
// it "false" and always runs.
export const NIGHTLY_INPUTS = { gate: "true" } as const;

// The branch every run starts from.
export const DISPATCH_REF = "main";

export type DispatchOutcome = "started" | "not set" | "refused" | "failed";

export async function startWorkflow(env: Env, workflow: WorkflowFile, inputs?: Record<string, string>): Promise<DispatchOutcome> {
  if (!WORKFLOW_FILES.includes(workflow)) {
    console.log("dispatch: not a workflow this Worker starts; nothing sent");
    return "failed";
  }
  const token = (env.WORKFLOW_RUN ?? "").trim();
  const repo = workflowRepo(env);
  if (!token || !repo) {
    console.log(`dispatch: ${workflow} not started: no ${token ? "WORKFLOW_REPO variable" : "WORKFLOW_RUN secret"}; GitHub's own schedule starts it`);
    return "not set";
  }
  try {
    const res = await fetch(`${workflowUrl(repo, workflow)}/dispatches`, {
      method: "POST",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(inputs ? { ref: DISPATCH_REF, inputs } : { ref: DISPATCH_REF }),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    // The answer's body is never read: 204 has none, and 200 (the run's id,
    // as GitHub's reference now describes it) is not needed.
    await res.body?.cancel().catch(() => undefined);
    if (res.ok) {
      console.log(`dispatch: ${workflow} started (HTTP ${res.status})`);
      return "started";
    }
    console.log(`dispatch: ${workflow} refused (HTTP ${res.status}); GitHub's own schedule starts it`);
    return "refused";
  } catch (e) {
    console.log(`dispatch: ${workflow} not started (${faultName(e)}); GitHub's own schedule starts it`);
    return "failed";
  }
}
