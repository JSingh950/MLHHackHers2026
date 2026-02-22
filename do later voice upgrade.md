# Do Later Voice Upgrade

## Summary

Short answer: yes, for your specific pain points, a Twilio Media Streams + OpenAI Realtime stack is worth a serious spike.

## Current Pain Points (with current ElevenLabs stack)

- Dead air during tool turns
- Interruption sensitivity / background voices
- Inconsistent speech understanding
- Limited control over what ElevenLabs actually honors

These are exactly the areas where a Twilio Media Streams + OpenAI Realtime stack gives you more control.

## My Take

- Better for quality/control: likely yes
- Better for speed-to-ship: no (current ElevenLabs stack is already working)
- Worth it: yes, as a parallel migration/spike, not a hard cutover first

## Why It Could Be Better

- You control turn detection / VAD behavior directly
  - OpenAI Realtime VAD has tunable modes/settings (`server_vad`, `semantic_vad`)
  - Less black-box behavior than current agent tuning
- You control tool-call pacing
  - Instant spoken ack
  - Run tools in parallel
  - Stream audio back immediately
- You get direct realtime events for
  - audio
  - transcripts
  - function/tool calls
- You can optimize around those events
- You can reuse existing DB/memory/tool logic

## Why It Might Not Be Better

- More engineering complexity (you own media bridge + realtime session orchestration)
- Twilio PSTN latency still exists no matter what
- You must productionize
  - WebSocket reliability
  - barge-in handling
  - reconnection logic
  - logging/observability

## How Hard Is the Swap?

Not trivial, but not a rewrite.

## What You Can Keep (Big Win)

- Frontend API contract (unchanged)
- Postgres schema
- Chat/memory logic
- Scheduler/worker logic (mostly)
- Goal/habit/review endpoints
- Auth
- Tool business logic (reusable)

## What Changes

- Call provider path (`apps/worker/src/providers.ts`)
- Add a realtime call bridge service (Twilio <-> OpenAI Realtime)
- Replace ElevenLabs post-call webhook dependency with your own transcript/session persistence from Realtime events
- Twilio call flow switches to Media Streams/TwiML instead of ElevenLabs agent outbound endpoint

## Effort Estimate (Pragmatic)

- 2-4 days: spike (one phone number, one call, basic audio loop)
- 1-2 weeks: working MVP parity (tools + memory + logging + recap)
- 2-4 weeks: production-ready (retries, observability, edge cases, call quality tuning)

## Recommendation

Do a parallel spike, not a full immediate swap.

## Suggested Plan

1. Build a `realtime-bridge` service (Twilio Media Stream WS <-> OpenAI Realtime WS).
2. Keep current DB/tools and call the same logic.
3. A/B test on one Twilio number (or one route) against current ElevenLabs setup.
4. Measure:
   - time-to-first-response
   - tool-turn silence duration
   - interruption rate
   - ASR clarification rate
5. Decide cutover after 20-30 test calls.

## Would I Switch For This Product?

- If voice quality + conversational feel are core to retention: yes, likely worth it.
- If you just need reliable scheduled check-ins fast: keep ElevenLabs for now and improve later.

## One More Thing (Before Building a Custom Media Bridge)

Evaluate OpenAI Realtime SIP first (Twilio as SIP trunk). It may reduce custom audio plumbing depending on your outbound requirements.

## Proposed Architecture (Realtime Option)

Twilio receives the phone call and opens a Media Stream WebSocket to your server, streaming raw mu-law 8kHz audio.

Your server:

- transcodes to PCM 16kHz
- forwards audio to OpenAI Realtime API over a second WebSocket
- receives audio chunks, transcripts, and tool call events
- sends audio back to Twilio
- handles tool calls (DB lookups, CRM writes, etc.)
- logs transcripts/sessions

OpenAI Realtime API:

- persistent WebSocket
- native speech-to-speech via GPT-4o Realtime family
- system prompts
- tool calling
- transcript events

## Sources

- OpenAI Realtime conversations (speech-to-speech + function calling/events):
  - https://developers.openai.com/api/docs/guides/realtime-conversations
- OpenAI Realtime VAD (`server_vad` / `semantic_vad` tuning):
  - https://developers.openai.com/api/docs/guides/realtime-vad
- OpenAI `gpt-realtime` model (WebRTC/WebSocket/SIP):
  - https://developers.openai.com/api/docs/models/gpt-realtime
- OpenAI Realtime SIP guide (Twilio SIP trunk option):
  - https://developers.openai.com/api/docs/guides/realtime-sip

## Next Step (When Ready)

Create a concrete migration plan mapped to this repo (`apps/api`, `apps/worker`) with exact files to add/change and a low-risk rollout path.
