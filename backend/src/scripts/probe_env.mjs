import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(scriptDirectory, "../../.env");
console.log("envPath:", envPath);
const result = dotenv.config({ path: envPath });
console.log("dotenv result:", JSON.stringify(result.error || "OK"));
console.log("MONGODB_URI set:", !!process.env.MONGODB_URI);
console.log("MONGODB_URI starts with:", process.env.MONGODB_URI?.slice(0, 30));
