import test from "node:test";
import assert from "node:assert/strict";
import { selectAudience } from "./fieldservice_broadcast.ts";

test("completed work orders go to the completion audience", () => {
  const audience = selectAudience({
    announcementId: "ann-17",
    message: "Photo review is ready",
    workOrderId: "wo-42",
    photoUrls: ["https://example.com/after.jpg"],
    dispatchStatus: "complete",
    technicianFollowUp: "Ask the learner to confirm the repair"
  });
  assert.equal(audience, "field-service-completions");
});
