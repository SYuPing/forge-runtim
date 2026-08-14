import assert from "node:assert/strict";
import test from "node:test";

test("Repair_WhenCauseIsSpec_ShouldRollbackToToSpec", async () => {
	const { createRepairOrchestrator } = await import("../../src/repair/repair-orchestrator.ts");
	const orchestrator = createRepairOrchestrator();

	const result = await orchestrator.repair({ cause: "spec" });

	assert.equal(result, "TO_SPEC");
});
