import dns from "node:dns";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readExcelFile from "read-excel-file/node";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, "../../.env") });

const workbookPath = "C:/Users/tsrir/Documents/MAIN PROJECTS/ELECTION/Srimukhalingam_VoterID_Telugu_VoterName.xlsx";

console.log("Step 1: reading Excel...");
let worksheets;
try {
  worksheets = await readExcelFile(workbookPath);
  console.log("worksheets type:", typeof worksheets, Array.isArray(worksheets));
  console.log("worksheets length:", worksheets?.length);
  const ws = worksheets[0];
  console.log("ws keys:", ws ? Object.keys(ws) : "undefined");
  console.log("ws.data length:", ws?.data?.length);
  console.log("ws.data[0]:", JSON.stringify(ws?.data?.[0]));
  console.log("ws.data[1]:", JSON.stringify(ws?.data?.[1]));
} catch (e) {
  console.error("Excel error:", e.message, e.stack);
}
