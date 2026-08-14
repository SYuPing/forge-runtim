import assert from "node:assert/strict";
import test from "node:test";

test("Transition_WhenMandatoryStageSkipped_ShouldReject", async () => {
	const { createStateMachine } = await import("../../src/workflow/state-machine.ts");
	const machine = createStateMachine({ initialStage: "INTENT_UNDERSTANDING" });

	assert.throws(
		() => machine.transitionTo("DEEP_KNOWLEDGE_RETRIEVAL"),
		/Error|reject|invalid|mandatory|skip/i,
	);
});

test("StateMachine_WhenUserConfirms_ShouldAllowReturnToGrill", async () => {
	const { createStateMachine } = await import("../../src/workflow/state-machine.ts");
	const machine = createStateMachine({ initialStage: "USER_CONFIRMED" });

	assert.equal(machine.canTransitionTo("GRILL"), true);
	machine.transitionTo("GRILL");
	assert.equal(machine.getStage(), "GRILL");
});
