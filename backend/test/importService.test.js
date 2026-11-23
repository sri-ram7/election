import test from "node:test";
import assert from "node:assert/strict";
import { processImportRun } from "../src/services/importService.js";

function makeRecord(overrides = {}) {
  return {
    wardno: 1,
    serialNumber: 1,
    voterName: "తెలుగు పేరు",
    voterNameEn: "Telugu Name",
    relationName: "ബന്ധു",
    age: 40,
    gender: "Female",
    houseNumber: null,
    voterId: "ABC1234567",
    pageNumber: 3,
    ...overrides,
  };
}

function createFakeModels(existingIds = []) {
  const storedIds = new Set(existingIds);
  const runUpdates = [];
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
    async insertMany(records, options) {
      assert.deepEqual(options, { ordered: false });
      batchSizes.push(records.length);
      const inserted = [];
      const errors = [];
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (storedIds.has(record.voterId)) {
          errors.push({ index, code: 11000 });
        } else {
          storedIds.add(record.voterId);
          inserted.push(record);
        }
      }
      if (errors.length) {
        const error = new Error("bulk write failed");
        error.writeErrors = errors;
        throw error;
      }
      return inserted;
    },
  };
  const ImportRun = {
    async updateOne(_filter, update) {
      runUpdates.push(update.$set);
    },
  };
  return { Voter, ImportRun, storedIds, runUpdates, batchSizes };
}

test("imports valid records, counts source and database duplicates, and reports invalid rows", async () => {
  const { Voter, ImportRun, storedIds, runUpdates } = createFakeModels([
    "EXISTING123",
  ]);
  const records = [
    makeRecord({ voterId: "NEW0000001", serialNumber: 1 }),
    makeRecord({ voterId: "EXISTING123", serialNumber: 2 }),
    makeRecord({ voterId: "NEW0000001", serialNumber: 3 }),
    makeRecord({ voterId: "BAD0000001", age: "not-a-number", serialNumber: 4 }),
  ];

  const summary = await processImportRun({
    runId: "run-id",
    records,
    Voter,
    ImportRun,
    batchSize: 2,
  });

  test("never sends more than 500 records to insertMany", async () => {
    const { Voter, ImportRun, batchSizes } = createFakeModels();
    const records = Array.from({ length: 1001 }, (_, index) =>
      makeRecord({
        serialNumber: index + 1,
        voterId: `ID${String(index).padStart(8, "0")}`,
      }),
    );
    const summary = await processImportRun({
      runId: "run-id",
      records,
      Voter,
      ImportRun,
    });

    assert.deepEqual(batchSizes, [500, 500, 1]);
    assert.equal(summary.importedCount, 1001);
    assert.equal(summary.status, "completed");
  });

  test("re-running an import is idempotent by voter ID", async () => {
    const { Voter, ImportRun, storedIds } = createFakeModels();
    const records = [
      makeRecord({ voterId: "IDEMPOTENT1", serialNumber: 1 }),
      makeRecord({ voterId: "IDEMPOTENT2", serialNumber: 2 }),
    ];
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

    assert.equal(first.importedCount, 2);
    assert.equal(second.importedCount, 0);
    assert.equal(second.duplicateCount, 2);
    assert.equal(storedIds.size, 2);
  });

  test("accounts for partial insertMany failures without logging voter IDs", async () => {
    const { Voter, ImportRun, storedIds, runUpdates } = createFakeModels();
    Voter.insertMany = async (records, options) => {
      assert.deepEqual(options, { ordered: false });
      storedIds.add(records[0].voterId);
      const error = new Error("duplicate key");
      error.writeErrors = [{ index: 1, code: 11000 }];
      throw error;
    };
    const summary = await processImportRun({
      runId: "partial-run",
      records: [
        makeRecord({ voterId: "PARTIAL0001", serialNumber: 1 }),
        makeRecord({ voterId: "PARTIAL0002", serialNumber: 2 }),
      ],
      Voter,
      ImportRun,
    });

    assert.equal(summary.importedCount, 1);
    assert.equal(summary.duplicateCount, 1);
    assert.equal(summary.failedCount, 0);
    assert.equal(summary.status, "completed");
    assert.equal(storedIds.has("PARTIAL0001"), true);
    assert.equal(storedIds.has("PARTIAL0002"), false);
    assert.equal(
      JSON.stringify(runUpdates.at(-1).issues).includes("PARTIAL"),
      false,
    );
  });

  assert.deepEqual(summary, {
    processedCount: 4,
    importedCount: 1,
    duplicateCount: 2,
    failedCount: 1,
    status: "completed_with_errors",
  });
  assert.equal(storedIds.has("NEW0000001"), true);
  assert.equal(runUpdates.at(-1).active, false);
  assert.equal(runUpdates.at(-1).issues.length, 3);
  assert.equal(
    Object.hasOwn(runUpdates.at(-1).issues[0], "voterId"),
    false,
  );
});
