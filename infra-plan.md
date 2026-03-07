# Phase 1 Infrastructure Plan

## Goal

Improve runtime reliability on the current single EC2 instance by replacing the fake container health check with a real application-level health model.

This phase is intentionally limited to operational health and readiness. It does **not** include CI/CD rollout or database migration work yet.

## Current problem

The current Docker health check only runs:

```yaml
test: ["CMD", "node", "-e", "process.exit(0)"]
```

That only proves Node can execute a trivial command. It does **not** prove that:

- Discord login succeeded
- the target guild is available
- required channels were resolved
- the scheduler is actually running
- the delivery worker is active
- SQLite is writable
- webhook ingestion is live when enabled

Because of that, Docker may report the container as healthy even when the bot is not actually operational.

## Phase 1 scope

### 1. Add a real health HTTP surface

Add a lightweight internal HTTP server dedicated to operational checks.

Endpoints:

- `GET /live`
- `GET /ready`
- `GET /health` (detailed JSON diagnostics)

### 2. Define liveness vs readiness correctly

#### Liveness

`/live` should answer whether the process is alive and able to serve a basic response.

Use it to confirm:

- Node process is up
- health server is responsive

This endpoint should be simple and should not fail because of temporary downstream issues.

#### Readiness

`/ready` should return success only when the bot is genuinely ready to do its job.

Readiness should verify:

- Discord client has logged in successfully
- Discord client is in ready state
- configured guild was found
- required Discord channels are available/resolved
- delivery worker has started and is not stuck
- scheduler dispatcher has started and is still ticking
- SQLite is writable through a lightweight write/read heartbeat
- webhook receiver is listening when `WEBHOOK_ENABLED=true`

If any required dependency is not ready, `/ready` should fail with a non-200 response.

### 3. Expose detailed diagnostics for operators

`/health` should return structured JSON showing the state of major runtime components, for example:

- app start time / uptime
- Discord connection state
- guild resolution state
- channel setup state
- scheduler running state
- last scheduler heartbeat time
- delivery worker running state
- queue backlog snapshot
- database path
- database read/write status
- webhook enabled/listening state

This endpoint is for debugging and should make failures obvious without reading logs first.

### 4. Replace Docker health check

Update `docker-compose.yml` so the container health check hits the real readiness endpoint instead of the dummy Node command.

Expected direction:

- container starts
- app initializes
- `/ready` stays failing until the bot is truly operational
- Docker marks container healthy only after readiness passes

### 5. Confirm webhook deployment assumptions

The repo already contains webhook receiver logic, but the current Docker Compose file does not expose any port.

Phase 1 should explicitly decide:

- if webhooks are not needed in this deployment, keep them disabled and reflect that in health output
- if webhooks are needed, expose the webhook port in Docker and document the EC2/security-group requirement

## Required implementation tasks

- [x] Add runtime health state tracking for startup milestones
- [x] Track Discord login and ready-state explicitly
- [x] Track guild/channel initialization success explicitly
- [x] Track scheduler startup and last dispatcher heartbeat
- [x] Track delivery worker startup and active loop state
- [x] Add lightweight SQLite readiness probe
- [x] Track webhook listener status when enabled
- [x] Add `/live`, `/ready`, and `/health` endpoints
- [x] Replace Docker Compose health check with real readiness probe
- [x] Update deployment docs to explain the new health model

## Acceptance criteria

Phase 1 is complete when all of the following are true:

- Docker health status reflects real bot readiness, not just process existence
- a failed Discord initialization keeps readiness red
- a broken or unwritable SQLite database keeps readiness red
- an unstarted scheduler or delivery worker keeps readiness red
- webhook mode reports clearly whether it is active and listening
- operators can inspect current runtime health through a dedicated endpoint

## Notes about SQLite in Phase 1

SQLite does not need to be replaced in this phase.

For the current single-instance EC2 deployment, SQLite is acceptable if:

- only one bot instance is running
- the workload stays modest
- local-file persistence is acceptable operationally

The main Phase 1 requirement is not replacing SQLite, but making sure health checks can detect when SQLite is unavailable or unwritable.
