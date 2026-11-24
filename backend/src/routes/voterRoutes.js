import { Router } from "express";
import mongoose from "mongoose";
import {
  buildFallbackMatch,
  buildVoterSearchStage,
  parsePagination,
} from "../lib/voterRecords.js";
import { requireCsrf } from "../middleware/adminAuth.js";

const SEARCH_FIELDS =
  "wardno serialNumber voterName voterNameEn relationName age gender houseNumber voterId pageNumber";

export function createVoterRouter({ Voter, ImportRun }) {
  const router = Router();

  router.get("/search", async (req, res, next) => {
    try {
      const { page, limit, skip } = parsePagination(
        req.query.page,
        req.query.limit,
      );

      // --- Filters: wardno and age ---
      const filterMatch = {};
      const wardnoRaw = req.query.wardno;
      const ageRaw    = req.query.age;
      if (wardnoRaw !== undefined && wardnoRaw !== "") {
        const wardno = Number(wardnoRaw);
        if (!Number.isInteger(wardno) || wardno < 1) {
          return res.status(400).json({ error: "wardno must be a positive integer" });
        }
        filterMatch.wardno = wardno;
      }
      if (ageRaw !== undefined && ageRaw !== "") {
        const age = Number(ageRaw);
        if (!Number.isInteger(age) || age < 1 || age > 120) {
          return res.status(400).json({ error: "age must be between 1 and 120" });
        }
        filterMatch.age = age;
      }
      const hasFilter = Object.keys(filterMatch).length > 0;

      // --- Sort ---
      const allowedSortFields = new Set(["wardno", "serialNumber", "voterNameEn", "age"]);
      const sortField = allowedSortFields.has(req.query.sortBy) ? req.query.sortBy : null;
      const sortStage = sortField
        ? { $sort: { [sortField]: 1, wardno: 1, serialNumber: 1 } }
        : { $sort: { wardno: 1, serialNumber: 1 } };

      const facetStage = {
        $facet: {
          items: [
            sortStage,
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                wardno: 1,
                serialNumber: 1,
                voterName: 1,
                voterNameEn: 1,
                relationName: 1,
                age: 1,
                gender: 1,
                houseNumber: 1,
                voterId: 1,
                pageNumber: 1,
              },
            },
          ],
          metadata: [{ $count: "total" }],
        },
      };

      let result;
      const q = req.query.q;

      if (hasFilter && (!q || !q.trim())) {
        // Filter only — no text search needed
        [result] = await Voter.aggregate([
          { $match: filterMatch },
          facetStage,
        ]);
      } else if (hasFilter) {
        // Filter + text search
        const searchStage = buildVoterSearchStage(q);
        try {
          [result] = await Voter.aggregate([
            searchStage,
            { $match: filterMatch },
            facetStage,
          ]);
        } catch (searchError) {
          if (process.env.NODE_ENV !== "test") {
            console.warn("Atlas Search failed, falling back:", searchError.message);
          }
          const fallback = buildFallbackMatch(q);
          [result] = await Voter.aggregate([
            { $match: { ...fallback, ...filterMatch } },
            facetStage,
          ]);
        }
      } else {
        // Text search only (original behaviour)
        const searchStage = buildVoterSearchStage(q);
        try {
          [result] = await Voter.aggregate([searchStage, facetStage]);
        } catch (searchError) {
          if (process.env.NODE_ENV !== "test") {
            console.warn("Atlas Search failed, falling back:", searchError.message);
          }
          const fallback = buildFallbackMatch(q);
          [result] = await Voter.aggregate([
            { $match: fallback },
            facetStage,
          ]);
        }
      }

      const items  = result?.items ?? [];
      const total  = result?.metadata[0]?.total ?? 0;
      res.json({ items, page, limit, total, totalPages: Math.ceil(total / limit) });
    } catch (error) {
      if (error instanceof TypeError) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  router.get("/import-runs", async (_req, res, next) => {
    try {
      const runs = await ImportRun.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .select(
          "status sourceFile totalRecords processedRecords importedCount duplicateCount failedCount issues startedAt finishedAt createdAt",
        )
        .lean();
      res.json({ items: runs });
    } catch (error) {
      next(error);
    }
  });

  router.get("/bulk-import/preview", async (_req, res, next) => {
    try {
      const { readSourceRecords, validateSourceRecords } = await import(
        "../services/sourceFile.js"
      );
      const records = await readSourceRecords();
      const invalidRecords = await validateSourceRecords(records, Voter);
      res.json({
        totalRecords: records.length,
        invalidCount: invalidRecords.length,
        invalidRecords,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/bulk-import", requireCsrf, async (_req, res, next) => {
    try {
      const { readSourceRecords, validateSourceRecords } = await import(
        "../services/sourceFile.js"
      );
      const { startImport } = await import("../services/startImport.js");
      const records = await readSourceRecords();
      const invalidRecords = await validateSourceRecords(records, Voter);
      if (invalidRecords.length) {
        return res.status(422).json({
          error: "Source file contains invalid voter records",
          totalRecords: records.length,
          invalidCount: invalidRecords.length,
          invalidRecords,
        });
      }
      const run = await startImport({ records, Voter, ImportRun });
      res.status(202).json({ run });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ error: "An import is already running" });
      }
      next(error);
    }
  });

  router.get("/bulk-import/:runId", async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.runId)) {
        return res.status(400).json({ error: "Invalid import run ID" });
      }
      const run = await ImportRun.findById(req.params.runId)
        .select(
          "status sourceFile totalRecords processedRecords importedCount duplicateCount failedCount issues startedAt finishedAt createdAt",
        )
        .lean();
      if (!run) return res.status(404).json({ error: "Import run not found" });
      res.json({ run });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "Invalid voter ID" });
      }
      const voter = await Voter.findById(req.params.id).select(SEARCH_FIELDS).lean();
      if (!voter) return res.status(404).json({ error: "Voter not found" });
      res.json({ voter });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
