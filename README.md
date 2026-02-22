# Goal Coach

Contract-first implementation of `docs/api-contract.openapi.yaml` with a production-oriented backend path.

## Current stack

- Web: Next.js (`apps/web`)
- API: Fastify + TypeScript + Postgres (`apps/api`)
- Worker: BullMQ + Redis + Postgres (`apps/worker`)
- Shared types: `packages/shared`
- SQL schema: `db/schema.sql`

## What is now real

- Postgres-backed API persistence (no in-memory state).
- JWT access tokens + refresh sessions persisted in `auth_sessions`.
- Password hashing with `bcryptjs`.
- LLM-backed `/v1/chat` pipeline:
  - Builds context from DB
  - Pulls recent thread messages
  - Calls model (OpenAI if configured)
  - Executes structured actions (habit log/blocker/commitment)
  - Updates rolling summary
- Worker call orchestration:
  - Claims due `checkin_events`
  - Dispatches calls through provider adapter (`mock`, `elevenlabs`, `twilio`)
  - Applies retry policy from schedules
- Webhook ingestion:
  - ElevenLabs webhook signature check (HMAC if secret configured)
  - Twilio signature verification (if `TWILIO_AUTH_TOKEN` configured)

## Prerequisites

- Node.js 20+
- Postgres 15+
- Redis 7+

## Setup

1. Copy env template:
   - `cp .env.example .env`
2. Optional infra boot (Postgres + Redis):
   - `docker compose up -d`
3. Set required env values in `.env`:
   - `DATABASE_URL`
   - `JWT_ACCESS_SECRET`
   - `WORKER_API_KEY`
   - `OPENAI_API_KEY` (for real LLM responses)
4. Install deps:
   - `npm install`
5. Start services:
   - API: `npm run dev:api`
   - Web: `npm run dev:web`
   - Worker: `npm run dev:worker`

## ElevenLabs + Twilio wiring

1. Set `CALL_PROVIDER=elevenlabs` in `.env`.
2. Set:
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_AGENT_ID`
   - `ELEVENLABS_OUTBOUND_URL`
3. Point ElevenLabs post-call webhook to:
   - `POST /v1/webhooks/elevenlabs`
4. If using Twilio callbacks directly, set:
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_WEBHOOK_URL`
   - callback target `POST /v1/webhooks/twilio`
5. Import ElevenLabs tool definitions from:
   - `docs/elevenlabs-tools.json`

## Local smoke checks

- API health: `GET /health`
- Login demo user:
  - email: `demo@goalcoach.app`
  - password: `demo-password`
- Open workbench: `http://localhost:3000/workbench`

## Important note

- Public API contract file remains unchanged. If we need contract changes, ask first.
