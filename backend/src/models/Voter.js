import mongoose from "mongoose";

const voterSchema = new mongoose.Schema(
  {
    wardno: { type: Number, required: true, min: 1 },
    serialNumber: { type: Number, required: true, min: 1 },
    voterName: { type: String, required: true },
    voterNameEn: { type: String, required: true },
    relationName: { type: String, default: null },
    age: { type: Number, required: true, min: 1, max: 120 },
    gender: { type: String, required: true },
    houseNumber: { type: String, default: null },
    voterId: { type: String, required: true },
    pageNumber: { type: Number, min: 1 },
  },
  {
    strict: "throw",
    versionKey: false,
  },
);

voterSchema.index({ voterId: 1 }, { unique: true, name: "voter_id_unique" });
voterSchema.index(
  { wardno: 1, serialNumber: 1 },
  { name: "ward_serial_lookup" },
);

export const Voter =
  mongoose.models.Voter || mongoose.model("Voter", voterSchema);
