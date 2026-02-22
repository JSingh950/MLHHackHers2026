import { createApp } from "./app.js";
import { closeDatabase, initializeDatabase } from "./db.js";

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8000);
const host = process.env.API_HOST ?? "0.0.0.0";

async function start() {
  await initializeDatabase();
  const app = createApp();

  try {
    await app.listen({ port, host });
    app.log.info(`API listening on http://${host}:${port}`);

    const shutdown = async () => {
      await app.close();
      await closeDatabase();
      process.exit(0);
    };

    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
  } catch (error) {
    app.log.error(error, "Failed to start API service");
    process.exit(1);
  }
}

void start();
