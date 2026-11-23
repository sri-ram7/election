export const VOTER_FIELDS = [
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
];

const REQUIRED_STRING_FIELDS = [
  "voterName",
  "voterNameEn",
  "gender",
  "voterId",
];
const REQUIRED_NUMBER_FIELDS = [
  "wardno",
  "serialNumber",
  "age",
  "pageNumber",
];

export function validateVoterRecord(record) {
  const fields = new Set();
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return ["record"];
  }

  for (const field of VOTER_FIELDS) {
    if (!Object.hasOwn(record, field)) fields.add(field);
  }
  for (const field of Object.keys(record)) {
    if (!VOTER_FIELDS.includes(field)) fields.add(field);
  }
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof record[field] !== "string" || !record[field].trim()) {
      fields.add(field);
    }
  }
  if (
    record.relationName !== undefined &&
    record.relationName !== null &&
    typeof record.relationName !== "string"
  ) {
    fields.add("relationName");
  }
  if (
    record.houseNumber !== null &&
    typeof record.houseNumber !== "string"
  ) {
    fields.add("houseNumber");
  }
  for (const field of REQUIRED_NUMBER_FIELDS) {
    if (!Number.isSafeInteger(record[field]) || record[field] < 1) {
      fields.add(field);
    }
  }
  if (Number.isSafeInteger(record.age) && record.age > 120) {
    fields.add("age");
  }

  return [...fields];
}

export function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildFallbackMatch(query) {
  const value = typeof query === "string" ? query.trim() : "";
  if (!value || value.length > 100) {
    throw new TypeError("Search query must contain 1 to 100 characters");
  }

  const escaped = escapeRegex(value);
  const regex = new RegExp(escaped, "i");
  const should = [
    { voterNameEn: regex },
    { voterId: regex },
    { houseNumber: regex },
    { voterName: regex },
  ];
  if (/^\d+$/.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number)) {
      should.push(
        { serialNumber: number },
        { wardno: number },
      );
    }
  }
  return { $or: should };
}

export function buildVoterSearchStage(query) {
  const value = typeof query === "string" ? query.trim() : "";
  if (!value || value.length > 100) {
    throw new TypeError("Search query must contain 1 to 100 characters");
  }

  const should = [
    {
      autocomplete: {
        query: value,
        path: "voterNameEn",
        tokenOrder: "sequential",
      },
    },
    {
      autocomplete: {
        query: value,
        path: "voterId",
        tokenOrder: "sequential",
      },
    },
    {
      autocomplete: {
        query: value,
        path: "houseNumber",
        tokenOrder: "sequential",
      },
    },
  ];
  if (/^\d+$/.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number)) {
      should.push(
        { equals: { path: "serialNumber", value: number } },
        { equals: { path: "wardno", value: number } },
      );
    }
  }
  return {
    $search: {
      index: "voter_search",
      compound: {
        should,
        minimumShouldMatch: 1,
      },
    },
  };
}

export function parsePagination(page, limit) {
  const parsedPage = page === undefined ? 1 : Number(page);
  const parsedLimit = limit === undefined ? 20 : Number(limit);
  if (
    !Number.isSafeInteger(parsedPage) ||
    parsedPage < 1 ||
    parsedPage > 1_000_000
  ) {
    throw new TypeError("page must be a positive integer");
  }
  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > 100
  ) {
    throw new TypeError("limit must be an integer from 1 to 100");
  }
  return {
    page: parsedPage,
    limit: parsedLimit,
    skip: (parsedPage - 1) * parsedLimit,
  };
}
