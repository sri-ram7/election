import { isIP } from "node:net";

export function validateEnvironment(config) {
  if (!config.mongoUri || !config.username || !config.password) {
    throw new Error(
      "Set MONGODB_URI, ADMIN_USERNAME, and ADMIN_PASSWORD in backend/.env",
    );
  }
  if (
    /<username>|<password>|<cluster>|<database>|replace-with/i.test(
      `${config.mongoUri} ${config.username} ${config.password}`,
    )
  ) {
    throw new Error(
      "Replace all example placeholders in backend/.env with your own values",
    );
  }
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  if (/replace-with|<.+>/.test(config.sessionSecret)) {
    throw new Error("Replace the SESSION_SECRET example in backend/.env");
  }
  if (
    config.dnsServers?.some(
      (server) => typeof server !== "string" || isIP(server.trim()) === 0,
    )
  ) {
    throw new Error(
      "MONGODB_DNS_SERVERS must be comma-separated DNS server IP addresses",
    );
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }
}

export function safeStartupError(error) {
  if (
    error.message.startsWith("Set ") ||
    error.message.startsWith("Replace ") ||
    error.message.startsWith("SESSION_SECRET") ||
    error.message.startsWith("PORT must ")
  ) {
    return error.message;
  }
  if (error.name === "MongooseServerSelectionError") {
    return (
      "Could not connect to MongoDB Atlas. Check the URI, Atlas IP access list, " +
      "and database-user credentials. No connection string was logged."
    );
  }
  if (error.code === "ECONNREFUSED") {
    return (
      "Node.js could not complete MongoDB Atlas DNS/service discovery " +
      "(ECONNREFUSED). On Windows, use MONGODB_DNS_SERVERS with the DNS " +
      "servers from Get-DnsClientServerAddress. No connection string was logged."
    );
  }
  if (
    ["ENOTFOUND", "EHOSTUNREACH", "ETIMEDOUT"].includes(error.code)
  ) {
    return (
      "MongoDB Atlas could not be reached over the network. Check that the " +
      "cluster is running, your current IP is allowed in Atlas Network Access, " +
      "and a firewall or VPN is not blocking the connection. No connection " +
      "string was logged."
    );
  }
  if (error.name === "MongoParseError") {
    return (
      "The MongoDB URI is malformed. Check its format and URL-encode special " +
      "characters in the username or password. No connection string was logged."
    );
  }
  if (error.name === "MongoServerError" && error.code === 18) {
    return (
      "MongoDB Atlas rejected the database credentials. Verify the database " +
      "username and password. No connection string was logged."
    );
  }
  return `Server startup failed (${error.name}${error.code ? `, code ${error.code}` : ""})`;
}
