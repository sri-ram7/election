import dotenv from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dns from "node:dns";
import mongoose from "mongoose";
import readExcelFile from "read-excel-file/node";

const dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(dir, ".env") });

const XLSX = path.resolve(dir, "../Srimukhalingam_VoterID_Telugu_VoterName.xlsx");

console.log("Reading Excel...");
const sheets = await readExcelFile(XLSX);
const rows = sheets[0].data;           // [{sheet, data}]
const headers = rows[0];               // ["voterId","voterName"]
const viCol = headers.indexOf("voterId");
const vnCol = headers.indexOf("voterName");
if (viCol < 0 || vnCol < 0) throw new Error("Excel columns not found: " + JSON.stringify(headers));

const records = rows.slice(1)
  .filter(r => r[viCol] && r[vnCol])
  .map(r => ({ voterId: String(r[viCol]).trim(), voterName: String(r[vnCol]).trim() }));

console.log(`Excel rows loaded: ${records.length}`);

console.log("Connecting to MongoDB...");
dns.setServers(["8.8.8.8", "8.8.4.4"]);
await mongoose.connect(process.env.MONGODB_URI, { dbName: "voter_management" });
const col = mongoose.connection.collection("voters");

// Backup first
const toBackup = await col.find(
  { voterId: { $in: records.map(r => r.voterId) } },
  { projection: { _id:1, voterId:1, voterName:1 } }
).toArray();
const backupFile = path.join(dir, `backup_voterNames_${Date.now()}.json`);
writeFileSync(backupFile, JSON.stringify(toBackup, null, 2));
console.log(`Backup saved: ${backupFile} (${toBackup.length} records)`);

// Build bulkWrite ops
const ops = records.map(r => ({
  updateOne: {
    filter: { voterId: r.voterId },
    update: { $set: { voterName: r.voterName } },
    upsert: false
  }
}));

console.log("Running bulkWrite...");
const result = await col.bulkWrite(ops, { ordered: false });

console.log("\n✅ DONE");
console.log(`Total Excel records  : ${records.length}`);
console.log(`Matched in MongoDB   : ${result.matchedCount}`);
console.log(`Modified (updated)   : ${result.modifiedCount}`);
console.log(`Unmatched (skipped)  : ${records.length - result.matchedCount}`);

await mongoose.disconnect();
