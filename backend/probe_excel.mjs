import readExcelFile from "read-excel-file/node";
const p = "C:/Users/tsrir/Documents/MAIN PROJECTS/ELECTION/Srimukhalingam_VoterID_Telugu_VoterName.xlsx";
const result = await readExcelFile(p);
console.log("isArray:", Array.isArray(result));
console.log("length:", result && result.length);
if (Array.isArray(result)) {
  console.log("first row:", JSON.stringify(result[0]));
  console.log("second row:", JSON.stringify(result[1]));
} else {
  // maybe it's an object with .rows property
  console.log("keys:", Object.keys(result || {}));
  if (result && result.rows) {
    console.log("rows[0]:", JSON.stringify((result.rows || [])[0]));
    console.log("rows[1]:", JSON.stringify((result.rows || [])[1]));
  }
}
