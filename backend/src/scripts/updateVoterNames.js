import dns from "node:dns";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import readExcelFile from "read-excel-file/node";
import mongoose from "mongoose";
import { safeStartupError } from "../lib/startupErrors.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultWorkbookPath = fileURLToPath(
  new URL(
    "../../../Srimukhalingam_VoterID_Telugu_VoterName.xlsx",
    import.meta.url,
  ),
);
const backupDirectory = path.resolve(scriptDirectory, "../../backups");

dotenv.config({ path: path.resolve(scriptDirectory, "../../.env") });

function parseArguments(args) {
  let apply = false;
  let workbookPath = defaultWorkbookPath;

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--apply") {
      apply = true;
    } else if (args[index] === "--file" && args[index + 1]) {
      workbookPath = path.resolve(args[index + 1]);
      index += 1;
    } else {
      throw new Error(
        "Usage: node src/scripts/updateVoterNames.js [--apply] [--file <path>]",
      );
    }
  }

  return { apply, workbookPath };
}

function getErrorMessage(error) {
  if (
    error.name?.startsWith("Mongo") ||
    error.name?.startsWith("Mongoose") ||
    ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ETIMEDOUT"].includes(
      error.code,
    )
  ) {
    return safeStartupError(error);
  }
  return error.message;
}

async function readExcelRecords(workbookPath) {
  const worksheets = await readExcelFile(workbookPath);
  const worksheet = worksheets[0];
  if (!worksheet || worksheet.data.length === 0) {
    throw new Error("The Excel workbook does not contain a worksheet.");
  }

  const headers = worksheet.data[0];
  const headerColumns = new Map(headers.map((header, index) => [header, index]));

  if (
    headers.length !== 2 ||
    headerColumns.size !== 2 ||
    !headerColumns.has("voterId") ||
    !headerColumns.has("voterName")
  ) {
    throw new Error(
      'The first worksheet must have exactly the headers "voterId" and "voterName".',
    );
  }

  const voterIdColumn = headerColumns.get("voterId");
  const voterNameColumn = headerColumns.get("voterName");
  const records = [];

  for (const [index, row] of worksheet.data.slice(1).entries()) {
    const rowNumber = index + 2;
    if (row.every((value) => value == null || String(value).trim() === "")) {
      continue;
    }

    if (
      row.slice(2).some((value) => value != null && String(value).trim() !== "")
    ) {
      throw new Error(`Unexpected populated column on Excel row ${rowNumber}.`);
    }

    const voterIdValue = row[voterIdColumn];
    const voterNameValue = row[voterNameColumn];
    if (
      typeof voterIdValue !== "string" ||
      typeof voterNameValue !== "string"
    ) {
      throw new Error(
        `Excel row ${rowNumber} must contain voterId and voterName as text.`,
      );
    }

    const voterId = voterIdValue.trim();
    if (!voterId || !voterNameValue.trim()) {
      throw new Error(
        `Excel row ${rowNumber} must contain both a voterId and a voterName.`,
      );
    }

    records.push({ rowNumber, voterId, voterName: voterNameValue });
  }

  return records;
}

function countByVoterId(records) {
  const counts = new Map();
  for (const record of records) {
    counts.set(record.voterId, (counts.get(record.voterId) ?? 0) + 1);
  }
  return counts;
}

function makeUpdatePlan(records, mongoDocuments) {
  const excelCounts = countByVoterId(records);
  const documentsByVoterId = new Map();
  for (const document of mongoDocuments) {
    const documents = documentsByVoterId.get(document.voterId) ?? [];
    documents.push(document);
    documentsByVoterId.set(document.voterId, documents);
  }

  const duplicateExcelIds = new Map(
    [...excelCounts].filter(([, count]) => count > 1),
  );
  const unmatchedRecords = records.filter(
    ({ voterId }) => !documentsByVoterId.has(voterId),
  );
  const plan = [];

  for (const record of records) {
    if (excelCounts.get(record.voterId) !== 1) {
      continue;
    }

    const documents = documentsByVoterId.get(record.voterId) ?? [];
    if (documents.length === 1) {
      plan.push({ record, document: documents[0] });
    }
  }

  return {
    plan,
    duplicateExcelIds,
    unmatchedRecords,
    documentsByVoterId,
  };
}

function makeBulkOperations(plan) {
  return plan
    .filter(({ record, document }) => document.voterName !== record.voterName)
    .map(({ record, document }) => {
      const hasVoterName = Object.prototype.hasOwnProperty.call(
        document,
        "voterName",
      );
      return {
        updateOne: {
          filter: {
            _id: document._id,
            voterId: record.voterId,
            voterName: hasVoterName
              ? { $eq: document.voterName, $exists: true }
              : { $exists: false },
          },
          update: { $set: { voterName: record.voterName } },
          upsert: false,
        },
      };
    });
}

function printIdCounts(label, entries) {
  console.log(`${label}: ${entries.length}`);
  if (entries.length === 0) {
    console.log("  None");
    return;
  }
  for (const { id, count } of entries) {
    console.log(`  ${id} (count: ${count})`);
  }
}

function printPlanSummary({
  records,
  plan,
  unmatchedRecords,
  duplicateExcelIds,
  duplicateMongoIds,
  documentsByVoterId,
}) {
  const unmatchedCounts = countByVoterId(unmatchedRecords);
  const unmatchedIds = [...unmatchedCounts].map(([id, count]) => ({
    id,
    count,
  }));
  const excelDuplicateEntries = [...duplicateExcelIds].map(([id, count]) => ({
    id,
    count,
  }));
  const mongoDuplicateEntries = duplicateMongoIds.map(({ _id, count }) => ({
    id: _id,
    count,
  }));

  console.log(`Total Excel records: ${records.length}`);
  console.log(`Excel voter IDs found in MongoDB: ${documentsByVoterId.size}`);
  console.log(`Matched records eligible for update: ${plan.length}`);
  console.log(`Unmatched records: ${unmatchedRecords.length}`);
  printIdCounts("Duplicate voter IDs in Excel", excelDuplicateEntries);
  printIdCounts("Duplicate voter IDs in MongoDB", mongoDuplicateEntries);
  printIdCounts("Unmatched voter IDs", unmatchedIds);

  console.log("Sample old and new voter names:");
  if (plan.length === 0) {
    console.log("  No unambiguous matching records.");
  } else {
    for (const { record, document } of plan.slice(0, 10)) {
      console.log(
        `  ${record.voterId}: ${JSON.stringify(document.voterName ?? null)} -> ${JSON.stringify(record.voterName)}`,
      );
    }
  }
}

async function createBackup(changedPlan, workbookPath) {
  await fs.mkdir(backupDirectory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(
    backupDirectory,
    `voter-name-backup-${timestamp}.json`,
  );
  const backup = {
    createdAt: new Date().toISOString(),
    sourceFile: path.basename(workbookPath),
    database: "voter_management",
    collection: "voters",
    records: changedPlan.map(({ record, document }) => {
      return {
        _id: document._id.toString(),
        voterId: record.voterId,
        voterNameExists: Object.prototype.hasOwnProperty.call(
          document,
          "voterName",
        ),
        voterName: document.voterName ?? null,
      };
    }),
  };

  await fs.writeFile(backupPath, JSON.stringify(backup, null, 2), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return backupPath;
}

async function confirmUpdate() {
  if (!stdin.isTTY) {
    throw new Error(
      "Apply mode requires an interactive terminal for confirmation.",
    );
  }

  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question(
      'Type "UPDATE" to continue with the voterName updates: ',
    );
    return answer === "UPDATE";
  } finally {
    terminal.close();
  }
}

function printFinalSummary({
  totalRecords,
  matchedRecords,
  modifiedRecords,
  unmatchedRecords,
  failedUpdates,
}) {
  console.log("\nFinal verification:");
  console.log(`Total records in Excel: ${totalRecords}`);
  console.log(`Total matched records: ${matchedRecords}`);
  console.log(`Total successfully modified records: ${modifiedRecords}`);
  console.log(`Total unmatched records: ${unmatchedRecords}`);
  console.log(`Total failed updates: ${failedUpdates}`);
}

async function run() {
  const { apply, workbookPath } = parseArguments(process.argv.slice(2));
  const records = await readExcelRecords(workbookPath);
  console.log(`Loaded Excel file: ${path.basename(workbookPath)}`);

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set in backend/.env.");
  }
  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(
      process.env.MONGODB_DNS_SERVERS.split(",").map((server) =>
        server.trim(),
      ),
    );
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: "voter_management",
  });

  try {
    const collection = mongoose.connection.collection("voters");
    const duplicateMongoIds = await collection
      .aggregate([
        { $match: { voterId: { $type: "string" } } },
        { $group: { _id: "$voterId", count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    const excelIds = [...new Set(records.map(({ voterId }) => voterId))];
    const mongoDocuments = excelIds.length
      ? await collection
          .find(
            { voterId: { $in: excelIds } },
            { projection: { _id: 1, voterId: 1, voterName: 1 } },
          )
          .toArray()
      : [];
    const summary = makeUpdatePlan(records, mongoDocuments);
    const duplicateMongoIdSet = new Set(
      duplicateMongoIds.map(({ _id }) => _id),
    );
    const targetedDuplicateMongoIds = [...summary.documentsByVoterId]
      .filter(([id]) => duplicateMongoIdSet.has(id))
      .map(([id, documents]) => ({ _id: id, count: documents.length }));

    printPlanSummary({
      ...summary,
      duplicateMongoIds,
    });
    if (targetedDuplicateMongoIds.length > 0) {
      console.log(
        `Matching records excluded due to duplicate MongoDB voter IDs: ${targetedDuplicateMongoIds.length}`,
      );
    }

    if (!apply) {
      console.log("\nDry run only. No backup or database updates were made.");
      return;
    }

    if (summary.plan.length === 0) {
      console.log("\nNo unambiguous matching records to update.");
      printFinalSummary({
        totalRecords: records.length,
        matchedRecords: 0,
        modifiedRecords: 0,
        unmatchedRecords: summary.unmatchedRecords.length,
        failedUpdates: 0,
      });
      return;
    }

    if (!(await confirmUpdate())) {
      console.log("Cancelled. No backup or database updates were made.");
      return;
    }

    const changedPlan = summary.plan.filter(
      ({ record, document }) => document.voterName !== record.voterName,
    );
    const operations = makeBulkOperations(changedPlan);
    if (operations.length === 0) {
      console.log("All matched voter names are already up to date.");
      printFinalSummary({
        totalRecords: records.length,
        matchedRecords: summary.plan.length,
        modifiedRecords: 0,
        unmatchedRecords: summary.unmatchedRecords.length,
        failedUpdates: 0,
      });
      return;
    }

    const backupPath = await createBackup(changedPlan, workbookPath);
    console.log(`Backup created: ${backupPath}`);

    let modifiedRecords = 0;
    let failedUpdates = operations.length;
    try {
      const result = await collection.bulkWrite(operations, { ordered: false });
      modifiedRecords = result.modifiedCount;
      failedUpdates = operations.length - result.matchedCount;
    } catch (error) {
      const result = error.result;
      const matchedCount = result?.matchedCount ?? result?.nMatched ?? 0;
      const modifiedCount = result?.modifiedCount ?? result?.nModified ?? 0;
      modifiedRecords = modifiedCount;
      failedUpdates = Math.max(0, operations.length - matchedCount);
      console.error(`Bulk update error: ${getErrorMessage(error)}`);
    }

    printFinalSummary({
      totalRecords: records.length,
      matchedRecords: summary.plan.length,
      modifiedRecords,
      unmatchedRecords: summary.unmatchedRecords.length,
      failedUpdates,
    });
    if (failedUpdates > 0) {
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

export { makeBulkOperations, makeUpdatePlan, readExcelRecords };

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch((error) => {
    console.error(`Voter name update failed: ${getErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
