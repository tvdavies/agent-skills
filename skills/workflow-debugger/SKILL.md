---
name: workflow-debugger
description: >-
  Query and analyse workflow activity data from ClickHouse for debugging production issues.
  Use when the user asks to debug a workflow session, investigate workflow errors,
  check what happened in a workflow execution, look at node activity, retrieve session data,
  query ClickHouse, or troubleshoot workflow behaviour. Trigger phrases include
  "debug session", "what happened in session", "check workflow", "query clickhouse",
  "workflow activity", "session data", "node execution", "workflow errors".
metadata:
  author: lleverage
  version: 1.1.0
---

# Workflow Activity Debugger

Debug workflow sessions and executions by querying the `workflow_activity_v4` table in ClickHouse.

> **CRITICAL: READ-ONLY** — This skill is strictly for reading and analysing data. NEVER run INSERT, UPDATE, DELETE, ALTER, DROP, TRUNCATE, CREATE, or any other mutating statement against ClickHouse. Only SELECT queries are permitted. If the user asks you to modify data, refuse and explain that this tool is read-only.

## Connection Details

- **URL**: `https://i0rxmo2j4u.europe-west4.gcp.clickhouse.cloud:8443`
- **Username**: Read from the `CLAUDE_CH_USERNAME` environment variable (defaults to `default` if not set)
- **Database**: `default`
- **Password**: Read from the `CLAUDE_CH_PASSWORD` environment variable

## How to Query

Use `curl` to send queries via the ClickHouse HTTP interface:

```bash
curl -s 'https://i0rxmo2j4u.europe-west4.gcp.clickhouse.cloud:8443/' \
  --user "${CLAUDE_CH_USERNAME:-default}:${CLAUDE_CH_PASSWORD}" \
  --data-binary "SELECT ... FROM default.workflow_activity_v4 FINAL WHERE ... FORMAT JSONEachRow"
```

> **CRITICAL**: Always use `FINAL` after the table name (`workflow_activity_v4 FINAL`) to get deduplicated results (the table uses ReplacingMergeTree). Do NOT use `FINAL` on the summary view (`workflow_execution_summary_v4`) — it uses AggregatingMergeTree where FINAL is not needed.

> **CRITICAL**: Always check that `CLICKHOUSE_PASSWORD` is set before running queries. If it is not set, tell the user to add `set -gx CLAUDE_CH_PASSWORD "their-password"` and optionally `set -gx CLAUDE_CH_USERNAME "their-username"` to their fish config.

> **CRITICAL**: Never pipe curl output through commands like `head`, `tail`, or `wc` — this closes the connection early and causes ClickHouse to reject the request with an authentication error. Instead, use SQL `LIMIT` clauses to control output size.

> **IMPORTANT**: Always use `FORMAT JSONEachRow` for machine-readable output that you can parse and analyse. Use `FORMAT PrettyCompact` only when the user explicitly wants a raw table view.

## Query Strategy

**Always start with aggregation queries to understand the scope before fetching raw events.** Raw event queries on busy sessions can return hundreds of rows and overwhelm the output. Follow this order:

1. **Session overview** — counts, time range, error count, number of executions
2. **Execution breakdown** — per-execution summary (start, end, status)
3. **Node summary** — per-node start/complete/pause/skip/error counts
4. **Drill-down** — raw events for specific nodes or executions, always with `LIMIT`

Only fetch raw `eventData` when investigating a specific node or error. Always apply a `LIMIT` (default 50) to raw event queries.

## Table Schema: `workflow_activity_v4`

### Columns

| Column | Type | Description |
|---|---|---|
| `id` | String | Unique event ID |
| `organisationId` | String | Organisation ID |
| `projectId` | String | Project ID |
| `userId` | Nullable(String) | User who triggered the workflow |
| `environment` | Enum8 | `'production'` (1) or `'test'` (2) |
| `triggerType` | Nullable(Enum8) | `'app'` (1), `'api'` (2), `'schedule'` (3), `'external'` (4) |
| `workflowExecutionId` | String | Execution ID (one per run/resume) |
| `workflowSessionId` | String | Session ID (groups related executions across resumes) |
| `workflowResumeId` | Nullable(String) | Resume ID for continued executions |
| `workflowId` | Nullable(String) | Workflow template ID |
| `workflowVersionId` | Nullable(String) | Workflow version ID |
| `workflowName` | Nullable(String) | Human-readable workflow name |
| `workflowSlug` | Nullable(String) | URL-safe workflow slug |
| `timestamp` | DateTime64(3, 'UTC') | Event timestamp (ms precision) |
| `nodeExecutionId` | Nullable(String) | Node execution ID |
| `parentNodeExecutionId` | Nullable(String) | Parent node execution (for nested nodes) |
| `nodeId` | Nullable(String) | Node template ID |
| `nodeName` | Nullable(String) | Human-readable node name |
| `nodeType` | Nullable(String) | Node type (ai, control, tool, trigger, etc.) |
| `eventType` | Enum8 | See event types below |
| `eventData` | String | Serialised JSON with event details |
| `eventStatus` | Nullable(String) | Flattened status from eventData |
| `eventError` | Nullable(String) | Flattened error from eventData |
| `eventInputs` | Nullable(String) | Flattened inputs from eventData |
| `eventOutput` | Nullable(String) | Flattened output from eventData |

### Event Types

| Value | Name | Description |
|---|---|---|
| 1 | `workflow_triggered` | Workflow trigger received |
| 2 | `workflow_started` | Workflow execution began |
| 3 | `workflow_completed` | Workflow execution finished |
| 4 | `node_started` | Node began execution |
| 5 | `node_completed` | Node finished execution |
| 6 | `node_skipped` | Node was skipped |
| 7 | `node_paused` | Node execution paused (awaiting input) |
| 8 | `output` | Intermediate output emitted |
| 9 | `error` | Error occurred |
| 10 | `reasoning` | AI reasoning step |

### Summary View: `workflow_execution_summary_v4`

Pre-aggregated view (AggregatingMergeTree) — do NOT use `FINAL` on this view.

```sql
SELECT
  workflowExecutionId, workflowSessionId, workflowName,
  workflowStartTime, workflowEndTime, durationMilliseconds,
  completionStatus, errorMessages, errorCount, totalEvents,
  environment, triggerType
FROM default.workflow_execution_summary_v4
WHERE workflowSessionId = '{sessionId}'
```

## Common Query Patterns

### Step 1: Session overview (always start here)

```sql
SELECT
  count() as totalEvents,
  countIf(eventType = 'error') as errors,
  countIf(eventType = 'workflow_triggered') as executions,
  min(timestamp) as firstEvent,
  max(timestamp) as lastEvent,
  any(workflowName) as workflowName
FROM default.workflow_activity_v4 FINAL
WHERE workflowSessionId = '{sessionId}'
FORMAT JSONEachRow
```

### Step 2: Execution breakdown

```sql
SELECT
  workflowExecutionId,
  any(workflowName) as workflowName,
  min(timestamp) as started,
  max(timestamp) as ended,
  count() as events,
  countIf(eventType = 'error') as errors,
  anyIf(eventStatus, eventType = 'workflow_completed') as completionStatus
FROM default.workflow_activity_v4 FINAL
WHERE workflowSessionId = '{sessionId}'
GROUP BY workflowExecutionId
ORDER BY started ASC
FORMAT JSONEachRow
```

### Step 3: Per-node summary

```sql
SELECT
  nodeName, nodeType,
  countIf(eventType = 'node_started') as starts,
  countIf(eventType = 'node_completed') as completions,
  countIf(eventType = 'node_paused') as pauses,
  countIf(eventType = 'node_skipped') as skips,
  countIf(eventType = 'error') as errors
FROM default.workflow_activity_v4 FINAL
WHERE workflowSessionId = '{sessionId}'
  AND nodeName IS NOT NULL
GROUP BY nodeName, nodeType
ORDER BY min(timestamp) ASC
FORMAT JSONEachRow
```

### Step 4: Drill-down queries (use as needed)

#### Errors only

```sql
SELECT timestamp, nodeName, nodeType, eventError, eventData
FROM default.workflow_activity_v4 FINAL
WHERE workflowSessionId = '{sessionId}'
  AND eventType = 'error'
ORDER BY timestamp ASC
LIMIT 50
FORMAT JSONEachRow
```

#### Specific node's activity

```sql
SELECT timestamp, eventType, eventData, eventStatus, eventError
FROM default.workflow_activity_v4 FINAL
WHERE workflowSessionId = '{sessionId}'
  AND nodeName = '{nodeName}'
ORDER BY timestamp ASC
LIMIT 50
FORMAT JSONEachRow
```

#### Raw events for a specific execution

```sql
SELECT timestamp, eventType, nodeName, nodeType, nodeExecutionId, eventData
FROM default.workflow_activity_v4 FINAL
WHERE workflowExecutionId = '{executionId}'
ORDER BY timestamp ASC
LIMIT 50
FORMAT JSONEachRow
```

#### Node execution timeline

```sql
SELECT timestamp, eventType, nodeName, nodeType, nodeExecutionId, eventStatus
FROM default.workflow_activity_v4 FINAL
WHERE workflowSessionId = '{sessionId}'
  AND eventType IN ('node_started', 'node_completed', 'node_skipped', 'node_paused', 'error')
ORDER BY timestamp ASC
LIMIT 100
FORMAT JSONEachRow
```

#### Recent executions for a workflow

```sql
SELECT
  workflowExecutionId, workflowSessionId,
  workflowStartTime, workflowEndTime, durationMilliseconds,
  completionStatus, errorCount
FROM default.workflow_execution_summary_v4
WHERE workflowId = '{workflowId}'
ORDER BY workflowStartTime DESC
LIMIT 20
FORMAT JSONEachRow
```

## Workflow for Debugging

1. **Start with session overview** — run the aggregation query to get total events, error count, execution count, and time range. This tells you the scope immediately.

2. **Get execution breakdown** — see how many times the workflow was triggered/resumed, and the completion status of each execution (completed, paused, error).

3. **Get per-node summary** — identify which nodes started but didn't complete, which had errors, and which were paused. Nodes with `starts > completions` and no pauses likely crashed.

4. **Drill into problems** — only now fetch raw `eventData` for specific nodes or errors that look suspicious.

5. **Check resumes** — if the session has multiple `workflowExecutionId` values, the workflow was resumed. Look at `workflowResumeId` to understand the resume chain.

6. **Parse eventData** — the `eventData` column is a JSON string. Parse it to extract node inputs, outputs, AI model responses, error stack traces, etc.

## Analysis Guidelines

- When presenting results, focus on the **timeline of events** and any **errors or unexpected behaviour**
- Parse `eventData` JSON to extract meaningful details rather than showing raw JSON blobs
- Highlight **duration gaps** between node_started and node_completed events (may indicate slow operations)
- If a node has `node_started` but no `node_completed` (and no `node_paused`), it likely crashed or timed out
- Group events by `nodeExecutionId` to show per-node summaries
- Show timestamps in human-readable format
- When there are many events, summarise the flow first, then offer to drill into specific nodes
- Compare `eventInputs` and `eventOutput` to understand data transformation through the workflow
