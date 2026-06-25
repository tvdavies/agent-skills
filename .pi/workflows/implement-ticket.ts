export const meta = {
  name: "implement-ticket",
  description:
    "Implement a ticket end-to-end from a Linear/tadu id or a free-form change description. Fetches the ticket and extracts acceptance criteria, maps the affected code and conventions, generates and judges several implementation approaches, carries out the winning plan in an isolated git worktree (code + tests, runs the test suite), then runs an adversarial review (correctness, test-adequacy, regression-risk) with a bounded fix pass. Leaves the change in a worktree for the user to review and merge; never pushes or opens a PR unless args explicitly asks.",
  phases: [
    { title: "Understand", detail: "Fetch the ticket, extract acceptance criteria, and map the affected code, tests, and conventions in parallel." },
    { title: "Plan", detail: "Generate independent implementation approaches, score them with parallel judges, and synthesize the winning plan grafting the best ideas from runners-up." },
    { title: "Implement", detail: "Carry out the winning plan in a fresh git worktree, writing code and tests and running the repo's test command, scoped to the ticket." },
    { title: "Review", detail: "Independent reviewers across correctness, test-adequacy, and regression-risk try to find real problems and re-run tests; do one bounded fix pass if needed." },
  ],
};

// ---------------------------------------------------------------------------
// args: a ticket id (Linear like LLE-123, or a tadu id) OR a free-form change
// description. We don't know which up front, so the understand phase tries the
// ticket stores first and falls back to treating args as the change request.
// ---------------------------------------------------------------------------
const request = typeof args === "string" && args.trim()
  ? args.trim()
  : args && typeof args === "object"
    ? JSON.stringify(args)
    : "";

if (!request) {
  log("No ticket id or change description supplied in args.");
  return {
    plan: null,
    worktree: null,
    testResult: null,
    reviewVerdict: "skipped",
    summary: "implement-ticket received empty args. Pass a Linear/tadu ticket id (e.g. LLE-123) or a free-form change description.",
  };
}

// Detect an explicit instruction to push / open a PR. Default is to leave the
// change in a worktree only. Require a verb-ish context so an incidental mention
// of the word "push" (e.g. "add a push button") does not flip this on.
const wantsPush =
  /\b(open|create|raise|submit|file)\s+(a\s+|an\s+)?(pr|pull request)\b/i.test(request) ||
  /\bpull request\b/i.test(request) ||
  /\b(push|pushing)\s+(the\s+|this\s+|my\s+)?(branch|change|changes|commit|commits|code|work|it|up|to\b)/i.test(request) ||
  /\bgit push\b/i.test(request);

// ===========================================================================
// PHASE 1 — UNDERSTAND (parallel barrier: both halves must land before planning)
// ===========================================================================
phase("Understand");
log(`Understanding request: ${request.slice(0, 140)}`);

const ticketSchema = {
  type: "object",
  additionalProperties: false,
  required: ["resolved", "source", "title", "description", "acceptanceCriteria", "outOfScope", "openQuestions"],
  properties: {
    resolved: { type: "boolean", description: "true if a real ticket was fetched; false if args was treated as a free-form change description" },
    source: { type: "string", enum: ["linear", "tadu", "description"], description: "where the requirement text came from" },
    id: { type: "string", description: "ticket id if resolved, else empty" },
    title: { type: "string" },
    description: { type: "string", description: "the full requirement text, normalized" },
    acceptanceCriteria: { type: "array", items: { type: "string" }, description: "explicit, testable acceptance criteria; infer them if the ticket lacks an explicit list" },
    outOfScope: { type: "array", items: { type: "string" }, description: "things the ticket does NOT ask for, to bound scope" },
    openQuestions: { type: "array", items: { type: "string" }, description: "ambiguities a human may need to resolve; empty if none" },
  },
};

const codeMapSchema = {
  type: "object",
  additionalProperties: false,
  required: ["testCommand", "affectedPaths", "conventions", "existingTests", "integrationPoints", "notes"],
  properties: {
    testCommand: { type: "string", description: "the exact command to run the test suite for this repo (e.g. 'bun test', 'npm test', 'pytest'); 'bun test' if unsure and bun is present" },
    affectedPaths: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "why"],
        properties: { path: { type: "string" }, why: { type: "string" } },
      },
      description: "files/dirs likely needing changes, each with a one-line reason",
    },
    conventions: { type: "array", items: { type: "string" }, description: "code style, framework, naming, error-handling, and test conventions to follow" },
    existingTests: { type: "array", items: { type: "string" }, description: "existing test files relevant to the change, to mirror style and avoid duplication" },
    integrationPoints: { type: "array", items: { type: "string" }, description: "modules, APIs, schemas, or contracts the change must not break" },
    notes: { type: "string", description: "anything else implementers must know (build quirks, gotchas, prior art)" },
  },
};

const [ticket, codeMap] = await parallel([
  () =>
    agent(
      `You are gathering the requirement for a code-implementation task.\n\n` +
        `The user supplied this as the ticket reference or change description:\n"""\n${request}\n"""\n\n` +
        `Steps:\n` +
        `1. If it looks like a ticket id, FETCH the ticket. Try Linear first via the linear-cli tool (e.g. \`linear-cli issue view <ID>\` or the equivalent), then if that fails or is not a Linear id, try \`tadu show <ID>\` from the task store.\n` +
        `2. If neither store returns a matching ticket, OR the input is clearly a free-form description, treat the input text itself as the requirement (source = "description").\n` +
        `3. Extract crisp, testable acceptance criteria. If the ticket has no explicit list, infer them from the description and title. Each criterion must be checkable by a test or a manual step.\n` +
        `4. Note what is explicitly OUT of scope, and any open questions / ambiguities that could change the implementation.\n\n` +
        `Do not write any code. Only read/fetch.`,
      { label: "fetch-ticket", phase: "Understand", schema: ticketSchema, effort: "medium" },
    ),
  () =>
    agent(
      `You are mapping the codebase for an upcoming change. Work in the current repository (read-only — do NOT edit anything).\n\n` +
        `The change to implement:\n"""\n${request}\n"""\n\n` +
        `Produce a grounded map:\n` +
        `1. Determine the repo's actual test command. Inspect package.json scripts, the presence of bun.lock / bun, Makefile, pyproject, etc. Prefer the project's own command; use 'bun test' only if that is genuinely how the repo tests.\n` +
        `2. Identify the files and directories most likely to change, each with a one-line reason. Ground every path by actually finding it (grep/list), not guessing.\n` +
        `3. Record the conventions an implementer must follow (style, framework idioms, error handling, how tests are written and located).\n` +
        `4. List existing tests relevant to this area so the implementer mirrors them and avoids duplication.\n` +
        `5. List integration points / contracts the change must not break.\n\n` +
        `Every path and command you report must be verified against the real repo.`,
      { label: "map-code", phase: "Understand", schema: codeMapSchema, effort: "medium" },
    ),
]);

if (!ticket || !codeMap) {
  log("Understand phase failed to produce both the ticket and the code map.");
  return {
    plan: null,
    worktree: null,
    testResult: null,
    reviewVerdict: "blocked",
    summary:
      "Could not establish a grounded picture: " +
      (!ticket ? "ticket/requirement extraction failed. " : "") +
      (!codeMap ? "codebase mapping failed. " : "") +
      "Re-run with a clearer ticket id or change description.",
  };
}

const testCommand = (codeMap.testCommand && String(codeMap.testCommand).trim()) || "bun test";
log(`Resolved test command: ${testCommand}. Acceptance criteria: ${(ticket.acceptanceCriteria || []).length}.`);

// Compact, shared context string handed to every later agent so they all reason
// off the same grounded picture.
const sharedContext =
  `REQUIREMENT (source=${ticket.source}${ticket.id ? `, id=${ticket.id}` : ""}):\n` +
  `Title: ${ticket.title}\n` +
  `Description: ${ticket.description}\n\n` +
  `ACCEPTANCE CRITERIA:\n${(ticket.acceptanceCriteria || []).map((c, i) => `${i + 1}. ${c}`).join("\n") || "(none stated)"}\n\n` +
  `OUT OF SCOPE:\n${(ticket.outOfScope || []).map((c) => `- ${c}`).join("\n") || "(none stated)"}\n\n` +
  `OPEN QUESTIONS:\n${(ticket.openQuestions || []).map((c) => `- ${c}`).join("\n") || "(none)"}\n\n` +
  `CODE MAP:\n` +
  `Test command: ${testCommand}\n` +
  `Affected paths:\n${(codeMap.affectedPaths || []).map((p) => `- ${p.path}: ${p.why}`).join("\n") || "(none mapped)"}\n` +
  `Conventions:\n${(codeMap.conventions || []).map((c) => `- ${c}`).join("\n") || "(none noted)"}\n` +
  `Existing tests:\n${(codeMap.existingTests || []).map((t) => `- ${t}`).join("\n") || "(none found)"}\n` +
  `Integration points:\n${(codeMap.integrationPoints || []).map((t) => `- ${t}`).join("\n") || "(none noted)"}\n` +
  `Notes: ${codeMap.notes || "(none)"}`;

// ---------------------------------------------------------------------------
// Helpers for worktree agents. These agents MUST NOT use a JSON `schema`: the
// engine appends a "[Worktree changes preserved at <path>; diff: <diffPath>]"
// note to the agent's text AFTER it finishes, which breaks the engine's bare-
// JSON parse and would make agent() return null even on success. Instead we ask
// for a fenced ```json block (the appended note lands OUTSIDE the fence) and
// parse it in-script, and we read the real worktree path/diff from the note
// (the agent itself can never see the note, since it is appended post-hoc).
// ---------------------------------------------------------------------------
const extractJsonBlock = (text) => {
  if (typeof text !== "string") return null;
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  let last = null;
  while ((m = fenceRe.exec(text)) !== null) last = m[1];
  const candidates = [];
  if (last != null) candidates.push(last.trim());
  candidates.push(text.trim());
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try next candidate
    }
  }
  return null;
};

const extractWorktreeNote = (text) => {
  if (typeof text !== "string") return { path: null, diffPath: null };
  const m = text.match(/\[Worktree changes preserved at ([^\];]+); diff: ([^\]]+)\]/);
  if (!m) return { path: null, diffPath: null };
  return { path: m[1].trim(), diffPath: m[2].trim() };
};

const jsonContract = (fields) =>
  `When done, output a SINGLE fenced \`\`\`json code block (and nothing after it) with exactly these keys: ${fields}. ` +
  `Do not wrap any other content in a json code fence. Keep testOutputTail to the last ~40 lines.`;

// ===========================================================================
// PHASE 2 — PLAN (diverse candidates -> parallel judges -> synthesized winner)
// ===========================================================================
phase("Plan");

const approachStyles = [
  {
    key: "mvp-first",
    brief:
      "MVP-FIRST: the smallest correct change that satisfies the acceptance criteria. Minimize surface area and new abstractions; reuse existing helpers; ship the simplest thing that fully passes.",
  },
  {
    key: "risk-first",
    brief:
      "RISK-FIRST: lead with the riskiest/most-uncertain part. Identify the parts most likely to break integration points or have hidden edge cases, and design the change to de-risk those first with defensive handling.",
  },
  {
    key: "test-first",
    brief:
      "TEST-FIRST: derive the test list directly from the acceptance criteria, then design the implementation to make those tests pass. Specify the concrete tests (names + what each asserts) before the code design.",
  },
];

const approachSchema = {
  type: "object",
  additionalProperties: false,
  required: ["style", "summary", "steps", "filesToChange", "testsToAdd", "risks"],
  properties: {
    style: { type: "string" },
    summary: { type: "string", description: "one-paragraph description of the approach" },
    steps: { type: "array", items: { type: "string" }, description: "ordered implementation steps" },
    filesToChange: { type: "array", items: { type: "string" }, description: "concrete files this approach touches" },
    testsToAdd: { type: "array", items: { type: "string" }, description: "concrete tests to add/extend, each naming what it asserts (tied to an acceptance criterion)" },
    risks: { type: "array", items: { type: "string" }, description: "what could go wrong with this approach and how it's mitigated" },
  },
};

const judgeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["correctness", "scope", "risk", "overall", "bestIdea", "weakness"],
  properties: {
    correctness: { type: "integer", minimum: 1, maximum: 5, description: "does it actually satisfy ALL acceptance criteria?" },
    scope: { type: "integer", minimum: 1, maximum: 5, description: "5 = perfectly scoped to the ticket; lower if it does too much or too little" },
    risk: { type: "integer", minimum: 1, maximum: 5, description: "5 = lowest regression/integration risk" },
    overall: { type: "integer", minimum: 1, maximum: 5 },
    bestIdea: { type: "string", description: "the single best idea in this approach worth grafting into the final plan" },
    weakness: { type: "string", description: "the most important weakness or gap" },
  },
};

// Stage 1: generate one candidate per style (independent, in parallel via pipeline fan-out).
// Stage 2: each candidate is scored by its own panel of judges, then we attach the verdict.
const scoredApproaches = (
  await pipeline(
    approachStyles,
    // Stage 1: draft the candidate approach.
    async (style) =>
      agent(
        `Design an implementation approach for the requirement below, using the ${style.brief}\n\n${sharedContext}\n\n` +
          `Stay strictly within scope (respect OUT OF SCOPE). Be concrete: name real files and real tests. Do NOT write code yet — this is a plan.`,
        { label: `approach-${style.key}`, phase: "Plan", schema: approachSchema, effort: "medium" },
      ),
    // Stage 2: judge this candidate with an independent 3-judge panel (parallel barrier
    // local to this item), average the scores, and attach the verdict.
    async (approach, style, index) => {
      if (!approach) return null;
      const judges = await parallel(
        [0, 1, 2].map((j) => () =>
          agent(
            `You are judge #${j + 1} of an independent panel scoring ONE implementation approach. Be skeptical and score honestly; do not inflate.\n\n` +
              `${sharedContext}\n\n` +
              `APPROACH UNDER REVIEW (${approach.style}):\n${JSON.stringify(approach, null, 2)}\n\n` +
              `Score correctness, scope, and risk (1-5 each) and give an overall (1-5). Name its single best idea and its most important weakness.`,
            { label: `judge-${style.key}-${j + 1}`, phase: "Plan", schema: judgeSchema, effort: "low" },
          ),
        ),
      );
      const valid = judges.filter(Boolean);
      if (valid.length === 0) return { approach, score: 0, judges: [] };
      const avg = (sel) => valid.reduce((s, v) => s + (Number(sel(v)) || 0), 0) / valid.length;
      const score = avg((v) => v.overall) * 2 + avg((v) => v.correctness) + avg((v) => v.scope) + avg((v) => v.risk);
      return {
        approach,
        score,
        correctness: avg((v) => v.correctness),
        scope: avg((v) => v.scope),
        risk: avg((v) => v.risk),
        judges: valid,
      };
    },
  )
).filter(Boolean);

if (scoredApproaches.length === 0) {
  log("Plan phase produced no scored approaches.");
  return {
    plan: null,
    worktree: null,
    testResult: null,
    reviewVerdict: "blocked",
    summary: "Could not generate any viable implementation approach. The requirement may be too ambiguous; resolve open questions and retry.",
  };
}

scoredApproaches.sort((a, b) => b.score - a.score);
const winner = scoredApproaches[0];
const runnersUp = scoredApproaches.slice(1);
log(`Top approach: ${winner.approach.style} (score ${winner.score.toFixed(2)}). Synthesizing final plan from ${scoredApproaches.length} candidates.`);

// Synthesize the final plan: keep the winner's spine, graft the best ideas from runners-up,
// and fix the weaknesses the judges flagged.
const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "rationale", "steps", "filesToChange", "testsToAdd", "verificationPlan", "outOfScope"],
  properties: {
    title: { type: "string" },
    rationale: { type: "string", description: "why this plan, and which grafted ideas from runners-up were folded in" },
    steps: { type: "array", items: { type: "string" }, description: "ordered, concrete implementation steps" },
    filesToChange: { type: "array", items: { type: "string" } },
    testsToAdd: { type: "array", items: { type: "string" }, description: "each test names what it asserts and which acceptance criterion it covers" },
    verificationPlan: { type: "array", items: { type: "string" }, description: "how to prove each acceptance criterion is met, including the exact test command" },
    outOfScope: { type: "array", items: { type: "string" }, description: "explicit non-goals carried forward to keep the change scoped" },
  },
};

const plan = await agent(
  `Synthesize the FINAL implementation plan. Start from the winning approach, graft in the best ideas from the runners-up, and resolve the weaknesses the judges flagged. Keep it tightly scoped to the ticket.\n\n` +
    `${sharedContext}\n\n` +
    `WINNING APPROACH (score ${winner.score.toFixed(2)}):\n${JSON.stringify(winner.approach, null, 2)}\n\n` +
    `JUDGE NOTES ON WINNER:\n${winner.judges.map((j) => `- best: ${j.bestIdea} | weakness: ${j.weakness}`).join("\n")}\n\n` +
    `RUNNER-UP IDEAS WORTH GRAFTING:\n${runnersUp
      .map((r) => `- (${r.approach.style}, score ${r.score.toFixed(2)}) best ideas: ${r.judges.map((j) => j.bestIdea).join("; ")}`)
      .join("\n") || "(none)"}\n\n` +
    `Output a single, coherent plan with ordered steps, concrete files and tests (each tied to an acceptance criterion), and a verification plan that uses the test command "${testCommand}".`,
  { label: "synthesize-plan", phase: "Plan", schema: planSchema, effort: "high" },
);

if (!plan) {
  log("Plan synthesis failed; falling back to the top-scored raw approach.");
}
const finalPlan = plan || {
  title: winner.approach.summary,
  rationale: `Synthesis step unavailable; using top-scored ${winner.approach.style} approach directly.`,
  steps: winner.approach.steps,
  filesToChange: winner.approach.filesToChange,
  testsToAdd: winner.approach.testsToAdd,
  verificationPlan: [`Run ${testCommand} and confirm all acceptance criteria are exercised.`],
  outOfScope: ticket.outOfScope || [],
};

// ===========================================================================
// PHASE 3 — IMPLEMENT (in an isolated worktree so main checkout stays clean)
// ===========================================================================
phase("Implement");
log(`Implementing "${finalPlan.title}" in an isolated worktree.`);

// NOTE: no `schema` here — see the worktree-agent helpers above for why.
const implementText = await agent(
  `Implement the plan below. You are running in a FRESH GIT WORKTREE — make all changes here; do not touch the main checkout.\n\n` +
    `${sharedContext}\n\n` +
    `FINAL PLAN:\n${JSON.stringify(finalPlan, null, 2)}\n\n` +
    `Rules:\n` +
    `- Write the code AND the tests. Each acceptance criterion must be covered by a test where feasible.\n` +
    `- Follow the repo conventions captured in the code map. Mirror existing test style and location.\n` +
    `- Stay strictly within scope. Do NOT do anything in OUT OF SCOPE. No drive-by refactors.\n` +
    `- Run the test command: ${testCommand}. If failures are caused by your change, fix them and re-run until green (or until you are confident a remaining failure is pre-existing and unrelated — say so explicitly).\n` +
    `- Do NOT commit, push, or open a PR.${wantsPush ? " (The user asked to push/PR; still do NOT push from here — the orchestrator handles that after review.)" : ""}\n\n` +
    jsonContract(
      `filesChanged (string[]), testsAdded (string[]), testCommandRun (string, the exact command you ran), ` +
        `testsPassed (boolean), testOutputTail (string), summary (string: what you implemented and how it satisfies the acceptance criteria)`,
    ) +
    `\nDo NOT try to report the worktree path or diff path yourself — the orchestrator derives those from the run.`,
  { label: "implement", phase: "Implement", isolation: "worktree", effort: "high" },
);

if (!implementText) {
  log("Implementation agent failed.");
  return {
    plan: finalPlan,
    worktree: null,
    testResult: { command: testCommand, passed: false, outputTail: "implementation agent did not return a result" },
    reviewVerdict: "blocked",
    summary: "The implementation step failed to produce changes. The plan is sound but no code was written. Re-run, or implement manually from the returned plan.",
  };
}

const implReport = extractJsonBlock(implementText) || {};
const implWorktree = extractWorktreeNote(implementText);
const implementation = {
  filesChanged: Array.isArray(implReport.filesChanged) ? implReport.filesChanged : [],
  testsAdded: Array.isArray(implReport.testsAdded) ? implReport.testsAdded : [],
  testCommandRun: typeof implReport.testCommandRun === "string" ? implReport.testCommandRun : testCommand,
  testsPassed: implReport.testsPassed === true,
  testOutputTail: typeof implReport.testOutputTail === "string" ? implReport.testOutputTail : "(no test output captured)",
  worktreePath: implWorktree.path,
  diffPath: implWorktree.diffPath,
  summary: typeof implReport.summary === "string" ? implReport.summary : "(no summary returned)",
  rawText: implementText.slice(0, 4000),
};

// If the worktree note is absent, the implementer made no file changes — that is a
// real failure for an implementation task (nothing to review or hand back).
if (!implementation.worktreePath) {
  log("Implementation produced no worktree changes (no preservation note).");
  return {
    plan: finalPlan,
    worktree: null,
    testResult: { command: implementation.testCommandRun, passed: false, outputTail: implementation.testOutputTail },
    reviewVerdict: "blocked",
    summary:
      "The implementation step ran but left no changes in the worktree (no files were written). " +
      "The plan is sound; re-run or implement manually from the returned plan.\n\nImplementer report: " +
      implementation.summary,
  };
}

log(
  `Implementation done. Tests ${implementation.testsPassed ? "passed" : "did NOT pass"} via "${implementation.testCommandRun}". ` +
    `Worktree: ${implementation.worktreePath}.`,
);

// ===========================================================================
// PHASE 4 — REVIEW (adversarial: independent reviewers try to REFUTE the work)
// ===========================================================================
phase("Review");

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lens", "verdict", "issues"],
  properties: {
    lens: { type: "string" },
    verdict: { type: "string", enum: ["pass", "concerns", "fail"] },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "claim", "evidence", "fix"],
        properties: {
          severity: { type: "string", enum: ["blocker", "major", "minor"] },
          claim: { type: "string", description: "the specific real problem (not a style nit)" },
          evidence: { type: "string", description: "file:line or observed test/command output proving it — must be verifiable, not speculation" },
          fix: { type: "string", description: "the minimal change that resolves it" },
        },
      },
    },
  },
};

const reviewLenses = [
  {
    key: "correctness",
    brief:
      "CORRECTNESS: does the code actually satisfy EVERY acceptance criterion? Look for logic errors, unhandled edge cases, and criteria that are claimed-but-not-met. Re-run the test command yourself to confirm the claimed result.",
  },
  {
    key: "test-adequacy",
    brief:
      "TEST-ADEQUACY: do the tests genuinely prove the criteria, or are they shallow/tautological? Check for missing edge cases, tests that would pass even if the feature were broken, and uncovered acceptance criteria. Re-run the tests.",
  },
  {
    key: "regression-risk",
    brief:
      "REGRESSION-RISK: could this break existing behavior or integration points? Look at the full diff for out-of-scope edits, broken contracts, and changes to shared code. Re-run the FULL test suite, not just the new tests.",
  },
];

// Reviewers inspect the implement worktree directly (it is preserved on disk).
const reviewWorktreeNote =
  `The changes live in this git worktree: ${implementation.worktreePath}. ` +
  `Inspect the diff there (e.g. \`git -C "${implementation.worktreePath}" diff HEAD\` and \`git -C "${implementation.worktreePath}" status\`) ` +
  `and run the tests INSIDE it: \`cd "${implementation.worktreePath}" && ${testCommand}\`. ` +
  (implementation.diffPath ? `A preserved copy of the diff is also at ${implementation.diffPath}.` : "");

const reviews = (
  await parallel(
    reviewLenses.map((lens) => () =>
      agent(
        `You are an adversarial reviewer. Your job is to REFUTE the claim that this change is correct and complete, through the ${lens.brief}\n\n` +
          `Only report problems you can back with concrete evidence (a file:line or actual command/test output). Do not invent issues; if it is solid, say so. Re-run "${testCommand}" yourself in the worktree rather than trusting the implementer's claim.\n\n` +
          `${sharedContext}\n\n` +
          `IMPLEMENTATION REPORT:\n${JSON.stringify(
            {
              filesChanged: implementation.filesChanged,
              testsAdded: implementation.testsAdded,
              testCommandRun: implementation.testCommandRun,
              testsPassed: implementation.testsPassed,
              testOutputTail: implementation.testOutputTail,
              summary: implementation.summary,
            },
            null,
            2,
          )}\n\n` +
          `${reviewWorktreeNote}`,
        { label: `review-${lens.key}`, phase: "Review", schema: reviewSchema, effort: "high" },
      ),
    ),
  )
).filter(Boolean);

// Collect only evidence-backed blocker/major issues — these are the ones that survived
// an adversarial pass and are worth a fix.
const realIssues = [];
for (const r of reviews) {
  for (const issue of r.issues || []) {
    if (issue.severity === "blocker" || issue.severity === "major") realIssues.push({ lens: r.lens, ...issue });
  }
}
const anyFailVerdict = reviews.some((r) => r.verdict === "fail");
log(`Review complete. Reviewers: ${reviews.length}. Evidence-backed blocker/major issues: ${realIssues.length}.`);

// The active worktree/diff handed back to the user. It moves to the fix-pass worktree
// if (and only if) the fix pass actually preserved changes.
let activeWorktreePath = implementation.worktreePath;
let activeDiffPath = implementation.diffPath;
let fixResult = null;
let postFixTestsPassed = implementation.testsPassed;
let postFixTestTail = implementation.testOutputTail;

if (realIssues.length > 0 || anyFailVerdict || !implementation.testsPassed) {
  log(`Running one bounded fix pass for ${realIssues.length} issue(s).`);
  // NOTE: no `schema` here — same worktree-note reason as the implement agent.
  // The fix pass runs in its OWN fresh worktree, so it must first re-apply the
  // preserved implementation diff before fixing on top of it.
  const fixText = await agent(
    `Do ONE bounded fix pass for the change described below. You are in a FRESH git worktree; the prior changes are NOT yet present here, so FIRST re-apply the implementation by working from the preserved diff, then address the issues. ` +
      `Specifically: apply the preserved diff into this worktree (e.g. \`git apply "${implementation.diffPath}"\` from the repo root of this worktree, or recreate the changes from the implementation report if the patch does not apply), then fix the issues below. ` +
      `Do NOT expand scope, refactor unrelated code, or start new features. If an issue is out of scope or a false positive, leave it and explain in remainingIssues.\n\n` +
      `${sharedContext}\n\n` +
      `ORIGINAL IMPLEMENTATION REPORT:\n${JSON.stringify(
        {
          filesChanged: implementation.filesChanged,
          testsAdded: implementation.testsAdded,
          summary: implementation.summary,
        },
        null,
        2,
      )}\n` +
      `Preserved diff to re-apply: ${implementation.diffPath || "(none — recreate from the report above)"}\n\n` +
      `ISSUES TO ADDRESS (only blockers/majors with evidence):\n${
        realIssues
          .map((i, n) => `${n + 1}. [${i.severity}/${i.lens}] ${i.claim}\n   evidence: ${i.evidence}\n   suggested fix: ${i.fix}`)
          .join("\n") || "(no specific issues, but tests were not green — get them green)"
      }\n\n` +
      `After fixing, re-run "${testCommand}".\n\n` +
      jsonContract(
        `fixedIssues (string[]), remainingIssues (string[]: issues you could NOT fix within scope, with why), ` +
          `testCommandRun (string), testsPassed (boolean), testOutputTail (string), summary (string)`,
      ),
    { label: "fix-pass", phase: "Review", isolation: "worktree", effort: "high" },
  );

  if (fixText) {
    const fixReport = extractJsonBlock(fixText) || {};
    const fixWorktree = extractWorktreeNote(fixText);
    fixResult = {
      fixedIssues: Array.isArray(fixReport.fixedIssues) ? fixReport.fixedIssues : [],
      remainingIssues: Array.isArray(fixReport.remainingIssues) ? fixReport.remainingIssues : [],
      testCommandRun: typeof fixReport.testCommandRun === "string" ? fixReport.testCommandRun : testCommand,
      testsPassed: fixReport.testsPassed === true,
      testOutputTail: typeof fixReport.testOutputTail === "string" ? fixReport.testOutputTail : "(no test output captured)",
      summary: typeof fixReport.summary === "string" ? fixReport.summary : "(no summary returned)",
      worktreePath: fixWorktree.path,
      diffPath: fixWorktree.diffPath,
    };
    postFixTestsPassed = fixResult.testsPassed;
    postFixTestTail = fixResult.testOutputTail;
    // Only switch the handed-back worktree if the fix pass actually preserved changes;
    // otherwise the implement worktree remains the source of truth.
    if (fixResult.worktreePath) {
      activeWorktreePath = fixResult.worktreePath;
      activeDiffPath = fixResult.diffPath;
    }
    log(`Fix pass done. Tests now ${fixResult.testsPassed ? "pass" : "still failing"}. Active worktree: ${activeWorktreePath}.`);
  } else {
    log("Fix pass agent failed to return a result; leaving original implementation worktree in place.");
  }
}

// Final verdict: pass only if no surviving blockers and tests are green.
const survivingBlockers = realIssues.filter((i) => i.severity === "blocker");
const reviewVerdict = postFixTestsPassed && survivingBlockers.length === 0
  ? realIssues.length > 0 || anyFailVerdict
    ? "pass-after-fix"
    : "pass"
  : survivingBlockers.length > 0
    ? "needs-attention"
    : "tests-failing";

const fixedNote = fixResult
  ? fixResult.worktreePath
    ? ` Fixes were applied in a follow-up worktree at ${fixResult.worktreePath}; that worktree is the one to review/merge (it contains the implementation re-applied plus the fixes).`
    : ` A fix pass ran but preserved no additional changes; review the implementation worktree at ${implementation.worktreePath}.`
  : "";

const summary =
  `Ticket: ${ticket.id ? `${ticket.id} — ` : ""}${ticket.title}\n` +
  `Plan: ${finalPlan.title}\n` +
  `Implementation: ${implementation.filesChanged.length} file(s) changed, ${implementation.testsAdded.length} test(s) added.\n` +
  `Tests: ${postFixTestsPassed ? "PASSING" : "FAILING"} via "${fixResult ? fixResult.testCommandRun : implementation.testCommandRun}".\n` +
  `Review: ${reviews.length} adversarial reviewer(s); ${realIssues.length} evidence-backed blocker/major issue(s)` +
  `${fixResult ? `, ${fixResult.fixedIssues.length} fixed in one bounded pass` : ""}. Verdict: ${reviewVerdict}.\n` +
  (survivingBlockers.length > 0 ? `Surviving blockers: ${survivingBlockers.map((b) => b.claim).join("; ")}\n` : "") +
  `\nThe change is LEFT IN A GIT WORKTREE${activeWorktreePath ? ` at ${activeWorktreePath}` : ""} for you to review and merge.${fixedNote} ` +
  `Nothing was committed, pushed, or opened as a PR.` +
  (wantsPush
    ? " (Your request mentioned pushing/PR: review the worktree first, then push/open the PR yourself, or re-invoke with an explicit push step — the workflow intentionally stops at the worktree.)"
    : "");

return {
  plan: finalPlan,
  worktree: {
    path: activeWorktreePath,
    diffPath: activeDiffPath,
    implementWorktree: implementation.worktreePath,
    fixWorktree: fixResult ? fixResult.worktreePath : null,
    branch: null,
  },
  testResult: {
    command: fixResult ? fixResult.testCommandRun : implementation.testCommandRun,
    passed: postFixTestsPassed,
    outputTail: postFixTestTail,
  },
  reviewVerdict,
  reviews,
  fixPass: fixResult,
  summary,
};
