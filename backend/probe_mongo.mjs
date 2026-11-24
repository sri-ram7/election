import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, "../../.env") });

console.log("MONGODB_URI set:", !!process.env.MONGODB_URI);
console.log("Connecting to MongoDB...");

try {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "voter_management", serverSelectionTimeoutMS: 10000 });
  console.log("Connected!");
  const col = mongoose.connection.collection("voters");
  const count = await col.countDocuments();
  console.log("Voter count:", count);
  await mongoose.disconnect();
} catch (err) {
  console.error("Connection error:", err.name, err.code, err.message?.slice(0, 200));
}
