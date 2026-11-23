import mongoose from "mongoose";

const importIssueSchema = new mongoose.Schema(
  {
    recordNumber: { type: Number, required: true },
    type: { type: String, enum: ["duplicate", "failed"], required: true },
    fields: [{ type: String }],
    code: { type: String, default: null },
    message: { type: String, required: true },
  },
  { _id: false },
);

const importRunSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["queued", "running", "completed", "completed_with_errors", "failed"],
      default: "queued",
      required: true,
    },
    active: { type: Boolean, default: true },
    sourceFile: { type: String, required: true },
    totalRecords: { type: Number, required: true },
    processedRecords: { type: Number, default: 0 },
    importedCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    issues: { type: [importIssueSchema], default: [] },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

importRunSchema.index(
  { active: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
    name: "single_active_import",
  },
);
importRunSchema.index({ createdAt: -1 }, { name: "import_history" });

export const ImportRun =
  mongoose.models.ImportRun || mongoose.model("ImportRun", importRunSchema);
