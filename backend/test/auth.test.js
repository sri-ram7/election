import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";

function createTestApp() {
  const app = createApp({
    Voter: {},
    ImportRun: {},
    adminConfig: {
      username: "test-admin",
      password: "test-password",
      sessionSecret: "test-session-secret-long-enough-123456",
    },
  });
  return app;
}

test("voter data endpoints require an authenticated administrator", async () => {
  const response = await request(createTestApp())
    .get("/api/voters/search?q=name")
    .expect(401);
  assert.equal(response.body.error, "Administrator login required");
});

test("login rotates the session and grants access only with CSRF protection", async () => {
  const agent = request.agent(createTestApp());
  const session = await agent.get("/api/auth/session").expect(200);
  const csrfToken = session.body.csrfToken;

  await agent
    .post("/api/auth/login")
    .send({ username: "test-admin", password: "test-password" })
    .expect(403);

  const login = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", csrfToken)
    .send({ username: "test-admin", password: "test-password" })
    .expect(200);

  assert.equal(login.body.authenticated, true);
  assert.notEqual(login.body.csrfToken, csrfToken);
  await agent.get("/api/voters/search").expect(400);
});

test("authenticated search uses Atlas Search and returns paginated results", async () => {
  const voter = {
    _id: "507f1f77bcf86cd799439011",
    wardno: 9,
    serialNumber: 1876,
    voterName: "తెలుగు పేరు",
    voterNameEn: "Annapuarna Tammannagari",
    relationName: "లక్ష్మయ్య",
    age: 74,
    gender: "Female",
    houseNumber: "643",
    voterId: "IQV1377498",
    pageNumber: 80,
  };
  let pipeline;
  const app = createApp({
    Voter: {
      aggregate(value) {
        pipeline = value;
        return Promise.resolve([{ items: [voter], metadata: [{ total: 21 }] }]);
      },
    },
    ImportRun: {},
    adminConfig: {
      username: "test-admin",
      password: "test-password",
      sessionSecret: "test-session-secret-long-enough-123456",
    },
  });
  const agent = request.agent(app);
  const session = await agent.get("/api/auth/session").expect(200);
  await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", session.body.csrfToken)
    .send({ username: "test-admin", password: "test-password" })
    .expect(200);

  const response = await agent
    .get("/api/voters/search?q=annapuarna&page=2&limit=5")
    .expect(200);

  assert.equal(pipeline[0].$search.index, "voter_search");
  assert.equal(pipeline[1].$facet.items[1].$skip, 5);
  assert.equal(response.body.total, 21);
  assert.equal(response.body.totalPages, 5);
  assert.equal(response.body.items[0].voterNameEn, voter.voterNameEn);
  assert.equal(response.body.items[0].voterName, voter.voterName);
});
