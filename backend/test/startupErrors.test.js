import test from "node:test";
import assert from "node:assert/strict";
import {
  safeStartupError,
  validateEnvironment,
} from "../src/lib/startupErrors.js";

const validConfig = {
  mongoUri: "mongodb+srv://user:password@cluster.example.mongodb.net/database",
  username: "admin",
  password: "admin-password",
  sessionSecret: "a-secure-session-secret-that-is-long-enough",
  port: 3001,
};

test("startup configuration rejects copied example placeholders", () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validConfig,
        mongoUri:
          "mongodb+srv://<username>:<password>@<cluster>/<database>?retryWrites=true",
      }),
    /Replace all example placeholders in backend\/.env/,
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...validConfig,
        sessionSecret: "replace-with-at-least-32-random-characters",
      }),
    /Replace the SESSION_SECRET example/,
  );
  assert.doesNotThrow(() => validateEnvironment(validConfig));
});

test("startup configuration accepts valid DNS server overrides only", () => {
  assert.doesNotThrow(() =>
    validateEnvironment({ ...validConfig, dnsServers: ["1.1.1.1", "8.8.8.8"] }),
  );
  assert.throws(
    () => validateEnvironment({ ...validConfig, dnsServers: ["not-an-ip"] }),
    /MONGODB_DNS_SERVERS must be comma-separated DNS server IP addresses/,
  );
});

test("startup error messages do not reveal a MongoDB URI or credentials", () => {
  const uri = "mongodb+srv://private-user:private-password@private.example";
  const message = safeStartupError(
    Object.assign(new Error(uri), {
      name: "MongooseServerSelectionError",
      code: "ENOTFOUND",
    }),
  );
  assert.match(message, /Check the URI, Atlas IP access list/);
  assert.doesNotMatch(message, /private-user|private-password|private\.example/);
  assert.equal(
    safeStartupError(
      Object.assign(new Error("auth failed"), {
        name: "MongoServerError",
        code: 18,
      }),
    ).includes("rejected the database credentials"),
    true,
  );
});

test("startup logs explain a short session secret without showing config values", () => {
  const error = new Error("SESSION_SECRET must contain at least 32 characters");
  assert.equal(safeStartupError(error), error.message);
});

test("startup logs explain refused database network connections safely", () => {
  const uri = "mongodb+srv://private-user:private-password@private.example";
  const message = safeStartupError(
    Object.assign(new Error(uri), { code: "ECONNREFUSED" }),
  );
  assert.match(message, /could not complete MongoDB Atlas DNS\/service discovery/);
  assert.doesNotMatch(message, /private-user|private-password|private\.example/);
});
