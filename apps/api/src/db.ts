import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg, { type QueryResultRow } from "pg";
import { hashPassword } from "./auth.js";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/goalcoach";
const useSsl = /sslmode=|supabase\.(co|com)/i.test(databaseUrl);
const rejectUnauthorized =
  (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED ??
    (databaseUrl.includes("pooler.supabase.com") ? "false" : "true")) !== "false";

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: useSsl ? { rejectUnauthorized } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000
});

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

async function applySchema(): Promise<void> {
  const currentFilePath = fileURLToPath(import.meta.url);
  const apiSrcDir = path.dirname(currentFilePath);
  const schemaPath = path.resolve(apiSrcDir, "../../../db/schema.sql");
  const schemaSql = await readFile(schemaPath, "utf8");
  await pool.query(schemaSql);
}

async function seedDemoData(): Promise<void> {
  const isLocalDev = (process.env.NODE_ENV ?? "development") !== "production";
  const demoEmail = "demo@goalcoach.app";

  const existingUser = await queryOne<{ id: string; password_hash: string }>(
    `select id, password_hash from users where lower(email) = lower($1) limit 1`,
    [demoEmail]
  );

  if (existingUser) {
    if (!existingUser.password_hash.startsWith("scrypt$")) {
      await query(`update users set password_hash = $2 where id = $1`, [
        existingUser.id,
        await hashPassword("demo-password")
      ]);
    }
  } else {
    const user = await queryOne<{ id: string }>(
      `insert into users (
        email,
        password_hash,
        name,
        timezone,
        phone_verified,
        consent_flags,
        preferences
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      returning id`,
      [
        demoEmail,
        await hashPassword("demo-password"),
        "Demo User",
        "America/Los_Angeles",
        true,
        JSON.stringify({
          calls_opt_in: true,
          transcription_opt_in: true,
          storage_opt_in: true
        }),
        JSON.stringify({ coaching_style: "mixed" })
      ]
    );

    if (!user) {
      throw new Error("Failed to seed demo user");
    }

    const goal = await queryOne<{ id: string }>(
      `insert into goals (user_id, statement, motivation, constraints, target_date, active)
       values ($1, $2, $3, $4, $5, true)
       returning id`,
      [
        user.id,
        "Exercise 4x per week",
        "Increase energy and focus",
        "Travel on Thursdays",
        new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      ]
    );

    if (!goal) {
      throw new Error("Failed to seed demo goal");
    }

    await query(
      `insert into habits (
        user_id,
        goal_id,
        title,
        frequency,
        measurement,
        difficulty_1_to_10,
        default_time_window,
        active
      )
      values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, true)`,
      [
        user.id,
        goal.id,
        "20-minute walk",
        JSON.stringify({ cadence: "weekdays" }),
        JSON.stringify({ type: "duration_minutes", target_value: 20 }),
        3,
        JSON.stringify({ start_local: "07:00", end_local: "09:00" })
      ]
    );

    await query(
      `insert into memory_profile (user_id, stable_facts, rolling_summary, last_call_recap)
       values ($1, $2::jsonb, $3, $4)
       on conflict (user_id) do nothing`,
      [
        user.id,
        JSON.stringify({
          preferred_checkin_tone: "supportive",
          stable_fact: "Usually misses habits when travel day starts before 7am"
        }),
        null,
        null
      ]
    );
  }

  if (isLocalDev) {
    const testEmail = "test@goalcoach.app";
    const existingTestUser = await queryOne<{ id: string; password_hash: string }>(
      `select id, password_hash from users where lower(email) = lower($1) limit 1`,
      [testEmail]
    );

    if (existingTestUser) {
      if (!existingTestUser.password_hash.startsWith("scrypt$")) {
        await query(`update users set password_hash = $2 where id = $1`, [
          existingTestUser.id,
          await hashPassword("test")
        ]);
      }
      return;
    }

    await query(
      `insert into users (
        email,
        password_hash,
        name,
        timezone,
        phone_verified,
        consent_flags,
        preferences
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        testEmail,
        await hashPassword("test"),
        "Test Test",
        "America/New_York",
        false,
        JSON.stringify({
          calls_opt_in: true,
          transcription_opt_in: true,
          storage_opt_in: true
        }),
        JSON.stringify({ coaching_style: "supportive" })
      ]
    );
  }
}

export async function initializeDatabase(): Promise<void> {
  const shouldMigrate = (process.env.API_AUTO_MIGRATE ?? "true") !== "false";
  if (!shouldMigrate) {
    return;
  }

  await applySchema();
  await seedDemoData();
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
