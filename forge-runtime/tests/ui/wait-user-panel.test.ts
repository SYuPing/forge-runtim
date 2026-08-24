import assert from "node:assert/strict";
import test from "node:test";
import { buildWaitUserPanel } from "../../src/ui/wait-user-panel.ts";

test("WaitUserPanel_WhenEvidenceIdsRepeat_ShouldShowUniqueEvidenceCountWithoutGenericActions", () => {
	const panel = buildWaitUserPanel({
		lastEvidenceIds: [],
		stage: "WAIT_USER",
		waitUser: {
			kind: "grill_confirmation",
			roundId: "grill-1",
			decisionId: "decision-1",
			evidenceIds: ["ev-a", "ev-a", "ev-b"],
			options: ["採用方案 A"],
			question: "要採用哪個方案？",
			recommendation: "採用方案 A",
		},
	});

	assert.ok(panel);
	assert.match(panel, /Evidence: 2 項/);
	assert.doesNotMatch(panel, /ev-a|ev-b/);
	assert.doesNotMatch(panel, /Confirm:|Reject:/);
});
