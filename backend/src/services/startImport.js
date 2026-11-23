import { processImportRun } from "./importService.js";
import { sourceFileLabel } from "./sourceFile.js";

export async function startImport({ records, Voter, ImportRun }) {
  const run = await ImportRun.create({
    status: "queued",
    active: true,
    sourceFile: sourceFileLabel,
    totalRecords: records.length,
  });

  setImmediate(() => {
    processImportRun({
      runId: run._id,
      records,
      Voter,
      ImportRun,
    }).catch(async () => {
      try {
        await ImportRun.updateOne(
          { _id: run._id, active: true },
          {
            $set: {
              status: "failed",
              active: false,
              finishedAt: new Date(),
              issues: [
                {
                  recordNumber: 0,
                  type: "failed",
                  fields: [],
                  code: "IMPORT_WORKER_FAILED",
                  message: "The import worker could not complete the run",
                },
              ],
            },
          },
        );
      } catch {
        console.error("Could not save the import worker failure state");
      }
    });
  });
  return run;
}
