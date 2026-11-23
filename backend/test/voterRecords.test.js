import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFallbackMatch,
  buildVoterSearchStage,
  escapeRegex,
  parsePagination,
  validateVoterRecord,
} from "../src/lib/voterRecords.js";
import { Voter } from "../src/models/Voter.js";

const validRecord = {
  wardno: 9,
  serialNumber: 1876,
  voterName: "అన్నపుార్ణ తమ్మన్నగారి",
  voterNameEn: "Annapuarna Tammannagari",
  relationName: "లక్ష్మయ్య",
  age: 74,
  gender: "Female",
  houseNumber: "643",
  voterId: "IQV1377498",
  pageNumber: 80,
};

test("validates the ten-field JSON record and allows a null house number", () => {
  assert.deepEqual(validateVoterRecord(validRecord), []);
  assert.deepEqual(
    validateVoterRecord({ ...validRecord, houseNumber: null }),
    [],
  );
  assert.deepEqual(validateVoterRecord({ ...validRecord, extra: true }), [
    "extra",
  ]);
  assert.deepEqual(validateVoterRecord({ ...validRecord, age: "74" }), [
    "age",
  ]);
});

test("builds safe Atlas Search requests for text and numeric lookups", () => {
  const textSearch = buildVoterSearchStage("Annapuarna");
  assert.equal(textSearch.$search.index, "voter_search");
  assert.equal(textSearch.$search.compound.should.length, 3);
  assert.deepEqual(
    textSearch.$search.compound.should.map((condition) =>
      condition.autocomplete?.path,
    ),
    ["voterNameEn", "voterId", "houseNumber"],
  );
  assert.equal(
    buildVoterSearchStage("9").$search.compound.should.length,
    5,
  );
  assert.equal(
    buildVoterSearchStage("A.*").$search.compound.should[0].autocomplete.query,
    "A.*",
  );
  assert.throws(() => buildVoterSearchStage(""), TypeError);
  assert.throws(() => buildVoterSearchStage("a".repeat(101)), TypeError);
});

test("builds safe fallback regex match objects for text and numeric queries", () => {
  assert.equal(escapeRegex("test (123) [abc] *+?"), "test \\(123\\) \\[abc\\] \\*\\+\\?");
  const fallbackText = buildFallbackMatch("Suguna");
  assert.equal(fallbackText.$or.length, 4);
  assert.equal(fallbackText.$or[0].voterNameEn instanceof RegExp, true);
  assert.equal(fallbackText.$or[0].voterNameEn.test("Suguna Dammannagari"), true);
  assert.equal(fallbackText.$or[0].voterNameEn.test("suguna"), true);

  const fallbackNumber = buildFallbackMatch("12");
  assert.equal(fallbackNumber.$or.length, 6);
  assert.equal(fallbackNumber.$or[4].serialNumber, 12);
  assert.equal(fallbackNumber.$or[5].wardno, 12);

  assert.throws(() => buildFallbackMatch(""), TypeError);
  assert.throws(() => buildFallbackMatch("b".repeat(101)), TypeError);
});

test("validates pagination and enforces a maximum page size", () => {
  assert.deepEqual(parsePagination(undefined, undefined), {
    page: 1,
    limit: 20,
    skip: 0,
  });
  assert.deepEqual(parsePagination("3", "50"), {
    page: 3,
    limit: 50,
    skip: 100,
  });
  assert.throws(() => parsePagination("0", "20"), TypeError);
  assert.throws(() => parsePagination("1", "101"), TypeError);
});

test("Mongoose schema has the required fields and a unique voterId index", () => {
  assert.deepEqual(
    Object.keys(Voter.schema.paths).filter(
      (key) => key !== "_id" && key !== "__v",
    ),
    [
      "wardno",
      "serialNumber",
      "voterName",
      "voterNameEn",
      "relationName",
      "age",
      "gender",
      "houseNumber",
      "voterId",
      "pageNumber",
    ],
  );
  assert.equal(
    Voter.schema.indexes().some(
      ([keys, options]) => keys.voterId === 1 && options.unique === true,
    ),
    true,
  );
  const preserved = new Voter({
    ...validRecord,
    voterName: " తెలుగు పేరు ",
    voterNameEn: " English Name ",
  });
  assert.equal(preserved.voterName, " తెలుగు పేరు ");
  assert.equal(preserved.voterNameEn, " English Name ");
});
