import dns from "node:dns";
import dotenv from "dotenv";
import mongoose from "mongoose";
import MongoStore from "connect-mongo";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { ImportRun } from "./models/ImportRun.js";
import { Voter } from "./models/Voter.js";
import {
  safeStartupError,
  validateEnvironment,
} from "./lib/startupErrors.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

function readConfig() {
  const config = {
    mongoUri: process.env.MONGODB_URI,
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
    sessionSecret: process.env.SESSION_SECRET,
    dnsServers: process.env.MONGODB_DNS_SERVERS
      ? process.env.MONGODB_DNS_SERVERS.split(",").map((server) =>
          server.trim(),
        )
      : [],
    port: Number(process.env.PORT ?? 3001),
    production: process.env.NODE_ENV === "production",
  };
  validateEnvironment(config);
  return config;
}

async function start() {
  const config = readConfig();
  if (config.dnsServers.length) {
    dns.setServers(config.dnsServers);
  }
  await mongoose.connect(config.mongoUri);
  await Promise.all([Voter.init(), ImportRun.init()]);
  await ImportRun.updateMany(
    { active: true },
    {
      $set: {
        active: false,
        status: "failed",
        finishedAt: new Date(),
        issues: [{
          recordNumber: 0,
          type: "failed",
          fields: [],
          code: "SERVER_RESTARTED",
          message: "Server restarted before the import completed",
        }],
      },
    },
  );

  const sessionStore = MongoStore.create({
    client: mongoose.connection.getClient(),
    collectionName: "admin_sessions",
    ttl: 8 * 60 * 60,
  });
  const app = createApp({
    Voter,
    ImportRun,
    adminConfig: {
      username: config.username,
      password: config.password,
      sessionSecret: config.sessionSecret,
    },
    sessionStore,
    production: config.production,
  });
  const server = app.listen(config.port, () => {
    console.log(`Voter admin server listening on port ${config.port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await sessionStore.close();
      await mongoose.disconnect();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch(async (error) => {
  console.error(safeStartupError(error));
  await mongoose.disconnect();
  process.exitCode = 1;
});
