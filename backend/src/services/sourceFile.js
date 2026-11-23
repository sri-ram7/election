import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateVoterRecord } from "../lib/voterRecords.js";

const sourcePath = fileURLToPath(
  new URL("../../../output/voters.json", import.meta.url),
);

export async function readSourceRecords() {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("The server-side output/voters.json file was not found");
    }
    if (error instanceof SyntaxError) {
      throw new Error("The server-side voter JSON is invalid");
    }
    throw error;
  }
  if (!Array.isArray(parsed)) {
    throw new Error("The server-side voter JSON must contain an array");
  }
  return parsed;
}

export async function validateSourceRecords(records, Voter) {
  const invalidRecords = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const fields = validateVoterRecord(record);
    if (fields.length) {
      invalidRecords.push({ recordNumber: index + 1, fields });
      continue;
    }

    try {
      await new Voter(record).validate();
    } catch (error) {
      invalidRecords.push({
        recordNumber: index + 1,
        fields: Object.keys(error.errors ?? {}),
      });
    }
  }
  return invalidRecords;
}

export const sourceFileLabel = "output/voters.json";
