import test from "node:test";
import assert from "node:assert/strict";
import {
  makeBulkOperations,
  makeUpdatePlan,
} from "../src/scripts/updateVoterNames.js";

test("update plan excludes duplicated Excel and MongoDB voter IDs", () => {
  const records = [
    { rowNumber: 2, voterId: "EXCEL-DUP", voterName: "First" },
    { rowNumber: 3, voterId: "EXCEL-DUP", voterName: "Second" },
    { rowNumber: 4, voterId: "MONGO-DUP", voterName: "Third" },
    { rowNumber: 5, voterId: "UNMATCHED", voterName: "Fourth" },
    { rowNumber: 6, voterId: "UNIQUE", voterName: "New name" },
  ];
  const documents = [
    { _id: "1", voterId: "EXCEL-DUP", voterName: "Old" },
    { _id: "2", voterId: "MONGO-DUP", voterName: "Old A" },
    { _id: "3", voterId: "MONGO-DUP", voterName: "Old B" },
    { _id: "4", voterId: "UNIQUE", voterName: "Old name" },
  ];

  const result = makeUpdatePlan(records, documents);

  assert.deepEqual(result.plan.map(({ record }) => record.voterId), ["UNIQUE"]);
  assert.deepEqual([...result.duplicateExcelIds], [["EXCEL-DUP", 2]]);
  assert.deepEqual(
    result.unmatchedRecords.map(({ voterId }) => voterId),
    ["UNMATCHED"],
  );
});

test("bulk updates set only voterName, disable upsert, and skip unchanged names", () => {
  const plan = [
    {
      record: { voterId: "VOTER-1", voterName: "New name" },
      document: { _id: "1", voterId: "VOTER-1", voterName: "Old name" },
    },
    {
      record: { voterId: "VOTER-2", voterName: "Same name" },
      document: { _id: "2", voterId: "VOTER-2", voterName: "Same name" },
    },
  ];

  const operations = makeBulkOperations(plan);

  assert.equal(operations.length, 1);
  assert.deepEqual(operations[0].updateOne.update, {
    $set: { voterName: "New name" },
  });
  assert.equal(operations[0].updateOne.upsert, false);
  assert.deepEqual(operations[0].updateOne.filter, {
    _id: "1",
    voterId: "VOTER-1",
    voterName: { $eq: "Old name", $exists: true },
  });
});
