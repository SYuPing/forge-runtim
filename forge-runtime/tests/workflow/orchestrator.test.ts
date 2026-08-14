import assert from "node:assert/strict";
import test from "node:test";

test("Transition_WhenGrillNeedsConfirmation_ShouldWaitUser", async () => {
	const { createOrchestrator } = await import("../../src/workflow/orchestrator.ts");
	const orchestrator = createOrchestrator({ initialStage: "GRILL" });

	orchestrator.handleGrillResult({ requiresUserConfirmation: true });

	assert.equal(orchestrator.getStage(), "WAIT_USER");
});

test("Transition_WhenUserConfirmed_ShouldResumeDeepKnowledge", async () => {
	const { createOrchestrator } = await import("../../src/workflow/orchestrator.ts");
	const orchestrator = createOrchestrator({ initialStage: "WAIT_USER" });

	(orchestrator as { handleUserConfirmation(): void }).handleUserConfirmation();

	assert.equal(orchestrator.getStage(), "USER_CONFIRMED");
});

test("ImplementGate_WhenTicketRequiresCode_ShouldEnterTdd", async () => {
	const { createOrchestrator } = await import("../../src/workflow/orchestrator.ts");
	const orchestrator = createOrchestrator({ initialStage: "IMPLEMENT_GATE" });

	(orchestrator as { handleImplementGate(input: { requiresCode: boolean }): void }).handleImplementGate({
		requiresCode: true,
	});

	assert.equal(orchestrator.getStage(), "TDD");
});

test("Judge_WhenValidationFails_ShouldRouteToRootCause", async () => {
	const { createOrchestrator } = await import("../../src/workflow/orchestrator.ts");
	const orchestrator = createOrchestrator({ initialStage: "VALIDATION" });

	(orchestrator as { handleValidationResult(input: { passed: boolean }): void }).handleValidationResult({
		passed: false,
	});

	assert.equal(orchestrator.getStage(), "ROOT_CAUSE");
});
