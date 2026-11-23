import dns from "node:dns";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

if (process.env.MONGODB_DNS_SERVERS) {
  dns.setServers(
    process.env.MONGODB_DNS_SERVERS.split(",").map((s) => s.trim()),
  );
}

const INDEX_NAME = "voter_search";
const indexPath = fileURLToPath(
  new URL("../../atlas-search-index.json", import.meta.url),
);
const definition = JSON.parse(fs.readFileSync(indexPath, "utf8"));

async function syncIndex() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set in backend/.env");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const collection = mongoose.connection.collection("voters");

  try {
    const existing = await collection.listSearchIndexes().toArray();
    const targetIndex = existing.find((idx) => idx.name === INDEX_NAME);

    if (targetIndex) {
      console.log(`Found existing search index '${INDEX_NAME}' (status: ${targetIndex.status}). Updating definition...`);
      await collection.updateSearchIndex(INDEX_NAME, definition);
      console.log(`Updated search index '${INDEX_NAME}'. Rebuilding in progress.`);
    } else {
      console.log(`Search index '${INDEX_NAME}' does not exist. Creating...`);
      await collection.createSearchIndex({
        name: INDEX_NAME,
        definition,
      });
      console.log(`Created search index '${INDEX_NAME}'. Building in progress.`);
    }

    console.log("Waiting for search index to be READY...");
    let ready = false;
    for (let attempt = 1; attempt <= 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const indexes = await collection.listSearchIndexes().toArray();
      const current = indexes.find((idx) => idx.name === INDEX_NAME);
      console.log(`[Attempt ${attempt}/30] Status: ${current?.status ?? "unknown"}`);
      if (current?.status === "READY") {
        ready = true;
        break;
      }
    }

    if (ready) {
      console.log(`Search index '${INDEX_NAME}' is READY and queryable!`);
    } else {
      console.log(`Search index is still building in the background. It will become READY shortly.`);
    }
  } catch (error) {
    console.error("Error managing search index:", error.message);
  } finally {
    await mongoose.disconnect();
  }
}

syncIndex().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

