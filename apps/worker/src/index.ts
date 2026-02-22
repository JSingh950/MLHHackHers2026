import { Job, Queue, QueueEvents, Worker } from "bullmq";
import {
  claimDueCheckins,
  closeWorkerDb,
  getCallRetryPolicy,
  getUserCallablePhone,
  markCheckinCompleted,
  markCheckinDispatched,
  markCheckinFailed,
  markCheckinRetry
} from "./db.js";
import { dispatchOutboundCall, getCallProviderName } from "./providers.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8000/v1";
const workerApiKey = process.env.WORKER_API_KEY ?? "dev-worker-key";

const connection = {
  url: redisUrl,
  maxRetriesPerRequest: null
};

const CHECKIN_QUEUE = "checkin";
const REVIEW_QUEUE = "weekly-review";
const CLAIM_BATCH_SIZE = Number(process.env.CHECKIN_CLAIM_BATCH_SIZE ?? 20);

type PlaceCallJob = {
  checkin_event_id: string;
  user_id: string;
  scheduled_at_utc: string;
  attempt_count: number;
};

type RetryCallJob = {
  checkin_event_id: string;
  user_id: string;
  attempt_count: number;
  retry_delay_minutes: number;
};

type WeeklyReviewGenerateJob = {
  user_id: string;
  week_start: string;
};

const checkinQueue = new Queue(CHECKIN_QUEUE, { connection });
const reviewQueue = new Queue(REVIEW_QUEUE, { connection });
new QueueEvents(CHECKIN_QUEUE, { connection });
new QueueEvents(REVIEW_QUEUE, { connection });

async function checkinTick(): Promise<void> {
  const dueEvents = await claimDueCheckins(CLAIM_BATCH_SIZE);
  if (dueEvents.length === 0) {
    return;
  }

  await Promise.all(
    dueEvents.map((event) =>
      checkinQueue.add(
        "place_call",
        {
          checkin_event_id: event.id,
          user_id: event.user_id,
          scheduled_at_utc: event.scheduled_at_utc,
          attempt_count: event.attempt_count
        },
        {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: false
        }
      )
    )
  );

  console.log(`[checkin_tick] claimed ${dueEvents.length} check-ins`);
}

async function placeCall(job: Job<PlaceCallJob>): Promise<void> {
  const attemptNumber = job.data.attempt_count + 1;
  const retryPolicy = await getCallRetryPolicy(job.data.user_id);

  const toNumber = await getUserCallablePhone(job.data.user_id);
  if (!toNumber) {
    if (attemptNumber < retryPolicy.max_attempts) {
      await checkinQueue.add(
        "call_retry",
        {
          checkin_event_id: job.data.checkin_event_id,
          user_id: job.data.user_id,
          attempt_count: attemptNumber,
          retry_delay_minutes: retryPolicy.retry_delay_minutes
        },
        {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: false
        }
      );
      return;
    }

    await markCheckinFailed({
      checkinEventId: job.data.checkin_event_id,
      attemptCount: attemptNumber
    });
    return;
  }

  try {
    const dispatch = await dispatchOutboundCall({
      userId: job.data.user_id,
      checkinEventId: job.data.checkin_event_id,
      toNumber
    });

    await markCheckinDispatched({
      checkinEventId: job.data.checkin_event_id,
      attemptCount: attemptNumber,
      providerCallId: dispatch.providerCallId
    });

    if (getCallProviderName() === "mock") {
      await markCheckinCompleted({
        checkinEventId: job.data.checkin_event_id,
        attemptCount: attemptNumber
      });
    }

    console.log(`[place_call] dispatched ${job.data.checkin_event_id} via ${dispatch.providerCallId}`);
  } catch (error) {
    console.error("[place_call] dispatch failed", {
      checkin_event_id: job.data.checkin_event_id,
      error: error instanceof Error ? error.message : String(error)
    });

    if (attemptNumber < retryPolicy.max_attempts) {
      await checkinQueue.add(
        "call_retry",
        {
          checkin_event_id: job.data.checkin_event_id,
          user_id: job.data.user_id,
          attempt_count: attemptNumber,
          retry_delay_minutes: retryPolicy.retry_delay_minutes
        },
        {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: false
        }
      );
      return;
    }

    await markCheckinFailed({
      checkinEventId: job.data.checkin_event_id,
      attemptCount: attemptNumber
    });
  }
}

async function callRetry(job: Job<RetryCallJob>): Promise<void> {
  const delayMs = job.data.retry_delay_minutes * 60 * 1000;
  const scheduledAt = new Date(Date.now() + delayMs).toISOString();

  await markCheckinRetry({
    checkinEventId: job.data.checkin_event_id,
    attemptCount: job.data.attempt_count,
    scheduledAtUtc: scheduledAt
  });

  console.log(`[call_retry] requeued ${job.data.checkin_event_id} at ${scheduledAt}`);
}

async function weeklyReviewGenerate(job: Job<WeeklyReviewGenerateJob>): Promise<void> {
  const endpoint = `${apiBaseUrl}/weekly-reviews/${job.data.week_start}`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "x-worker-key": workerApiKey,
      "x-user-id": job.data.user_id
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to generate weekly review (${response.status}): ${text}`);
  }

  console.log(`[weekly_review_generate] generated ${job.data.week_start} for ${job.data.user_id}`);
}

async function start(): Promise<void> {
  const checkinWorker = new Worker(
    CHECKIN_QUEUE,
    async (job) => {
      if (job.name === "place_call") {
        return placeCall(job as Job<PlaceCallJob>);
      }

      if (job.name === "call_retry") {
        return callRetry(job as Job<RetryCallJob>);
      }

      throw new Error(`Unknown job: ${job.name}`);
    },
    { connection }
  );

  const reviewWorker = new Worker(
    REVIEW_QUEUE,
    async (job) => {
      if (job.name !== "weekly_review_generate") {
        throw new Error(`Unknown job: ${job.name}`);
      }
      return weeklyReviewGenerate(job);
    },
    { connection }
  );

  await checkinTick();
  const interval = setInterval(() => {
    void checkinTick();
  }, 60_000);

  console.log("Worker started");

  const shutdown = async () => {
    clearInterval(interval);
    await Promise.all([
      checkinWorker.close(),
      reviewWorker.close(),
      checkinQueue.close(),
      reviewQueue.close(),
      closeWorkerDb()
    ]);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void start();
