import readExcelFile from "read-excel-file/node";
import path from "node:path";
const workbookPath = "C:/Users/tsrir/Documents/MAIN PROJECTS/ELECTION/Srimukhalingam_VoterID_Telugu_VoterName.xlsx";

// Simulate exactly what the script does
const worksheets = await readExcelFile(workbookPath);
console.log("worksheets[0] type:", typeof worksheets[0], Array.isArray(worksheets[0]));

const worksheet = worksheets[0];
console.log("worksheet:", JSON.stringify(Object.keys(worksheet)));
console.log("worksheet.data type:", typeof worksheet.data, Array.isArray(worksheet.data));
console.log("worksheet.data.length:", worksheet.data.length);

const headers = worksheet.data[0];
console.log("headers:", JSON.stringify(headers));
console.log("headers.length:", headers.length);

const headerColumns = new Map(headers.map((header, index) => [header, index]));
console.log("headerColumns has voterId:", headerColumns.has("voterId"));
console.log("headerColumns has voterName:", headerColumns.has("voterName"));
console.log("SUCCESS: Excel parsing works correctly");
