import type { Env } from "./env";

// What the Worker sends to GitHub's REST API, for the two places that call
// it: src/dispatch.ts, which starts the nightly and the same-day job from the
// Worker's own cron, and the daily check's one read of the token that does it
// (src/watchdog.ts). Each reads the token, WORKFLOW_RUN, itself; this file
// holds no secret and sends nothing. Neither takes a host, a repository or a
// workflow from a request: the host is GITHUB_API, the repository the
// WORKFLOW_REPO variable in wrangler.jsonc, the workflow one of the two names
// below.

export const GITHUB_API = "https://api.github.com";

// The two workflows the Worker may start, by their file names (GitHub takes
// a workflow's file name in place of its id).
export const NIGHTLY_WORKFLOW = "nightly.yml";
export const INTRADAY_WORKFLOW = "intraday.yml";
export type WorkflowFile = typeof NIGHTLY_WORKFLOW | typeof INTRADAY_WORKFLOW;
export const WORKFLOW_FILES: readonly WorkflowFile[] = [NIGHTLY_WORKFLOW, INTRADAY_WORKFLOW];

// A request that has not answered within this is given up: a cron run must
// not wait on GitHub, and GitHub's own schedule is the fallback.
export const GITHUB_TIMEOUT_MS = 10_000;

// GitHub refuses a request without a User-Agent. The site's name, no person
// and no address.
export const GITHUB_USER_AGENT = "awardwatch.ca";

// owner/name as GitHub allows them; anything else is no repository at all.
const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

export function workflowRepo(env: Pick<Env, "WORKFLOW_REPO">): string | null {
  const repo = (env.WORKFLOW_REPO ?? "").trim();
  return REPO_RE.test(repo) && !repo.split("/")[1].startsWith(".") ? repo : null;
}

export function workflowUrl(repo: string, workflow: WorkflowFile): string {
  return `${GITHUB_API}/repos/${repo}/actions/workflows/${workflow}`;
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": GITHUB_USER_AGENT,
  };
}

// A fault's kind only (TimeoutError, TypeError): its message could carry the
// address asked, and a log line names events, never a request.
export function faultName(e: unknown): string {
  const name = e instanceof Error ? e.name : typeof e;
  return /^[A-Za-z]{1,40}$/.test(name) ? name : "Error";
}
