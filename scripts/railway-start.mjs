import { spawn } from "node:child_process";

const serviceName = (process.env.RAILWAY_SERVICE_NAME ?? "").toLowerCase();

const commandByService = {
  api: ["npm", ["run", "start", "-w", "@goalcoach/api"]],
  web: ["npm", ["run", "start", "-w", "@goalcoach/web"]],
  worker: ["npm", ["run", "start", "-w", "@goalcoach/worker"]]
};

const command = commandByService[serviceName];

if (!command) {
  const available = Object.keys(commandByService).join(", ");
  console.error(
    `Unsupported or missing RAILWAY_SERVICE_NAME="${process.env.RAILWAY_SERVICE_NAME ?? ""}". Supported: ${available}`
  );
  process.exit(1);
}

const child = spawn(command[0], command[1], {
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

