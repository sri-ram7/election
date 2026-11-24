import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultWorkbookPath = fileURLToPath(
  new URL(
    "../../../Srimukhalingam_VoterID_Telugu_VoterName.xlsx",
    import.meta.url,
  ),
);
console.log("scriptDirectory:", scriptDirectory);
console.log("defaultWorkbookPath:", defaultWorkbookPath);

// Check if file exists
import fs from "node:fs";
console.log("file exists:", fs.existsSync(defaultWorkbookPath));
