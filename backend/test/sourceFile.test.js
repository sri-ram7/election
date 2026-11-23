import test from "node:test";
import assert from "node:assert/strict";
import { Voter } from "../src/models/Voter.js";
import {
  readSourceRecords,
  validateSourceRecords,
} from "../src/services/sourceFile.js";
import { processImportRun } from "../src/services/importService.js";

test("the unchanged JSON source validates against the Mongoose voter schema", async () => {
  const records = await readSourceRecords();
  const invalidRecords = await validateSourceRecords(records, Voter);

  assert.equal(records.length, 2580);
  assert.deepEqual(invalidRecords, []);
  assert.equal(
    records.every(
      (record) =>
        Object.keys(record).length === 10 &&
        Object.hasOwn(record, "voterName") &&
        Object.hasOwn(record, "voterNameEn"),
    ),
    true,
  );
  assert.equal(new Set(records.map((record) => record.voterId)).size, 2580);
  assert.equal(
    records.filter((record) => record.houseNumber === null).length,
    1,
  );
});

test("the full source imports once in 500-record batches and reruns as duplicates", async () => {
  const records = await readSourceRecords();
  const storedIds = new Set();
  const batchSizes = [];
  const Voter = {
    find({ voterId: { $in: ids } }) {
      return {
        select() {
          return {
            lean: async () =>
              ids
                .filter((id) => storedIds.has(id))
                .map((voterId) => ({ voterId })),
          };
        },
      };
    },
    async insertMany(batch, options) {
      assert.deepEqual(options, { ordered: false });
      batchSizes.push(batch.length);
      for (const record of batch) storedIds.add(record.voterId);
      return batch;
    },
  };
  const ImportRun = { updateOne: async () => {} };

  const first = await processImportRun({
    runId: "first-run",
    records,
    Voter,
    ImportRun,
  });
  const second = await processImportRun({
    runId: "second-run",
    records,
    Voter,
    ImportRun,
  });

  assert.deepEqual(batchSizes, [500, 500, 500, 500, 500, 80]);
  assert.equal(first.importedCount, 2580);
  assert.equal(first.duplicateCount, 0);
  assert.equal(first.failedCount, 0);
  assert.equal(second.importedCount, 0);
  assert.equal(second.duplicateCount, 2580);
  assert.equal(storedIds.size, 2580);
});
