import { validateVoterRecord } from "../lib/voterRecords.js";

function getWriteErrors(error) {
  if (Array.isArray(error.writeErrors)) return error.writeErrors;
  if (typeof error.result?.getWriteErrors === "function") {
    return error.result.getWriteErrors();
  }
  if (Array.isArray(error.result?.writeErrors)) return error.result.writeErrors;
  return [];
}

function writeErrorIndex(error) {
  return Number.isInteger(error.index) ? error.index : error.err?.index;
}

function safeWriteError(error) {
  const code = String(error.code ?? error.err?.code ?? "INSERT_FAILED");
  if (Number(error.code ?? error.err?.code) === 11000) {
    return { type: "duplicate", code: "DUPLICATE_VOTER_ID" };
  }
  return { type: "failed", code };
}

async function updateProgress(ImportRun, runId, update) {
  await ImportRun.updateOne({ _id: runId }, { $set: update });
}

export async function processImportRun({
  runId,
  records,
  Voter,
  ImportRun,
  batchSize = 500,
}) {
  let processedCount = 0;
  let importedCount = 0;
  let duplicateCount = 0;
  let failedCount = 0;
  const seenVoterIds = new Set();
  const issues = [];

  const addIssue = (recordNumber, type, message, fields = [], code = null) => {
    issues.push({ recordNumber, type, fields, code, message });
    if (type === "duplicate") duplicateCount += 1;
    else failedCount += 1;
  };

  await updateProgress(ImportRun, runId, {
    status: "running",
    startedAt: new Date(),
  });

  let fatalFailure = false;
  try {
    for (let offset = 0; offset < records.length; offset += batchSize) {
      const batch = records.slice(offset, offset + batchSize);
      const candidates = [];

      for (let index = 0; index < batch.length; index += 1) {
        const record = batch[index];
        const recordNumber = offset + index + 1;
        const invalidFields = validateVoterRecord(record);
        if (invalidFields.length) {
          addIssue(
            recordNumber,
            "failed",
            "Record does not match the voter schema",
            invalidFields,
            "INVALID_RECORD",
          );
          continue;
        }
        if (seenVoterIds.has(record.voterId)) {
          addIssue(
            recordNumber,
            "duplicate",
            "Voter ID already appeared earlier in this file",
            [],
            "DUPLICATE_VOTER_ID",
          );
          continue;
        }
        seenVoterIds.add(record.voterId);
        candidates.push({ record, recordNumber });
      }

      if (candidates.length) {
        const ids = candidates.map(({ record }) => record.voterId);
        const existing = await Voter.find({ voterId: { $in: ids } })
          .select("voterId")
          .lean();
        const existingIds = new Set(existing.map(({ voterId }) => voterId));
        const insertCandidates = [];

        for (const candidate of candidates) {
          if (existingIds.has(candidate.record.voterId)) {
            addIssue(
              candidate.recordNumber,
              "duplicate",
              "Voter ID already exists in the database",
              [],
              "DUPLICATE_VOTER_ID",
            );
          } else {
            insertCandidates.push(candidate);
          }
        }

        if (insertCandidates.length) {
          const writeErrorsByIndex = new Map();
          try {
            const inserted = await Voter.insertMany(
              insertCandidates.map(({ record }) => record),
              { ordered: false },
            );
            importedCount += inserted.length;
          } catch (error) {
            const writeErrors = getWriteErrors(error);
            for (const writeError of writeErrors) {
              const index = writeErrorIndex(writeError);
              if (Number.isInteger(index)) {
                writeErrorsByIndex.set(index, safeWriteError(writeError));
              }
            }

            if (
              !writeErrors.length ||
              writeErrorsByIndex.size !== writeErrors.length ||
              [...writeErrorsByIndex.keys()].some(
                (index) => index < 0 || index >= insertCandidates.length,
              )
            ) {
              throw error;
            }
            importedCount += insertCandidates.length - writeErrorsByIndex.size;
            for (const [index, result] of writeErrorsByIndex) {
              const candidate = insertCandidates[index];
              addIssue(
                candidate.recordNumber,
                result.type,
                result.type === "duplicate"
                  ? "Voter ID already exists in the database"
                  : "Database rejected this record",
                [],
                result.code,
              );
            }
          }
        }
      }

      processedCount += batch.length;
      await updateProgress(ImportRun, runId, {
        processedRecords: processedCount,
        importedCount,
        duplicateCount,
        failedCount,
        issues,
      });
    }
  } catch {
    fatalFailure = true;
    for (
      let recordNumber = processedCount + 1;
      recordNumber <= records.length;
      recordNumber += 1
    ) {
      addIssue(
        recordNumber,
        "failed",
        "Import stopped because a database operation failed",
        [],
        "DATABASE_OPERATION_FAILED",
      );
    }
    processedCount = records.length;
  }

  const status = fatalFailure
    ? "failed"
    : failedCount > 0
      ? "completed_with_errors"
      : "completed";
  await updateProgress(ImportRun, runId, {
    status,
    active: false,
    processedRecords: processedCount,
    importedCount,
    duplicateCount,
    failedCount,
    issues,
    finishedAt: new Date(),
  });
  return { processedCount, importedCount, duplicateCount, failedCount, status };
}
