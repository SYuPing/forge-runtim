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

test("StateMachine_WhenUserConfirmsFromWait_ShouldAllowReturnToLightDiscovery", async () => {
	const { createStateMachine } = await import("../../src/workflow/state-machine.ts");
	const machine = createStateMachine({ initialStage: "WAIT_USER" });

	machine.transitionTo("USER_CONFIRMED");
	assert.equal(machine.canTransitionTo("LIGHT_DISCOVERY"), true);
	machine.transitionTo("LIGHT_DISCOVERY");
	assert.equal(machine.getStage(), "LIGHT_DISCOVERY");
});

test("StateMachine_WhenRetrievalCompletes_ShouldEnterKnowledgeUnderstanding", async () => {
	const { createForgeSessionState } = await import("../../src/runtime/session-state.ts");
	const session = createForgeSessionState();
	const snapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});

	session.startGrillRound("理解需求", snapshot);
	session.beginDeepKnowledge("Retrieval 開始");
	const identity = session.currentDeepAttempt();
	assert.ok(identity);

	const result = session.handleDeepResult(identity, {
		kind: "completed",
		evidenceIds: ["ev-1"],
		decisionSummary: "Retrieval 完成",
	});

	assert.equal(result.kind, "accepted");
	assert.equal(result.state.stage, "KNOWLEDGE_UNDERSTANDING");
	assert.equal(session.current().stage, "KNOWLEDGE_UNDERSTANDING");
	assert.equal(session.currentDeepAttempt()?.phase, "KNOWLEDGE_UNDERSTANDING");
});

test("StateMachine_WhenUnderstandingCompletes_ShouldEnterContextBuild", async () => {
	const { createForgeSessionState } = await import("../../src/runtime/session-state.ts");
	const { createEvidencePackage } = await import("../../src/evidence/evidence-engine.ts");
	const session = createForgeSessionState();
	const snapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});

	session.startGrillRound("理解需求", snapshot);
	session.beginDeepKnowledge("Retrieval 開始");
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);

	const retrievalResult = session.handleDeepResult(retrievalIdentity, {
		kind: "completed",
		evidenceIds: ["ev-1"],
		decisionSummary: "Retrieval 完成",
	});
	assert.equal(retrievalResult.kind, "accepted");

	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	assert.equal(understandingIdentity.phase, "KNOWLEDGE_UNDERSTANDING");
	const evidencePackage = createEvidencePackage({
		inherited: [],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "Understanding 完成",
	});

	const result = session.handleDeepResult(understandingIdentity, {
		kind: "completed",
		evidencePackage,
	});

	assert.equal(result.kind, "accepted");
	assert.equal(result.state.stage, "CONTEXT_BUILD");
	assert.equal(session.current().stage, "CONTEXT_BUILD");
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), evidencePackage);
});

test("StateMachine_WhenDeepNeedsDecision_ShouldCreateWaitUserRound", async () => {
	const { createForgeSessionState } = await import("../../src/runtime/session-state.ts");
	const session = createForgeSessionState();
	const snapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});

	session.startGrillRound("理解需求", snapshot);
	session.beginGrill("Grill 完成");
	session.beginDeepKnowledge("Retrieval 開始");
	const identity = session.currentDeepAttempt();
	assert.ok(identity);

	const result = session.handleDeepResult(identity, {
		kind: "needs_decision",
		decisionId: "deep-decision-1",
		question: "要採用哪個方向？",
		options: ["方向 A", "方向 B"],
		recommendation: "方向 A",
		evidenceIds: ["ev-1"],
		decisionSummary: "需要使用者決定",
	});

	assert.equal(result.kind, "accepted");
	assert.equal(session.current().stage, "WAIT_USER");
	assert.deepEqual(session.current().waitUser, {
		kind: "deep_decision",
		roundId: identity.attemptId,
		decisionId: "deep-decision-1",
		question: "要採用哪個方向？",
		options: ["方向 A", "方向 B"],
		recommendation: "方向 A",
		evidenceIds: ["ev-1"],
	});
	assert.equal(session.currentDeepAttempt(), undefined);
	assert.deepEqual(session.current().lastEvidenceIds, ["ev-1"]);
});

test("StateMachine_WhenDeepNeedsDiscovery_ShouldEnterLightDiscovery", async () => {
	const { createForgeSessionState } = await import("../../src/runtime/session-state.ts");
	const session = createForgeSessionState();
	const snapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});

	session.startGrillRound("理解需求", snapshot);
	session.beginDeepKnowledge("保留的 Deep 輸入");
	const identity = session.currentDeepAttempt();
	assert.ok(identity);

	const result = session.handleDeepResult(identity, {
		kind: "needs_discovery",
		decisionSummary: "需要補找資料",
	});

	assert.equal(result.kind, "accepted");
	assert.equal(result.state.stage, "LIGHT_DISCOVERY");
	assert.equal(session.current().stage, "LIGHT_DISCOVERY");
	assert.equal(result.state.decisionSummary, "需要補找資料");
	assert.equal(session.currentDeepAttempt(), undefined);
	assert.equal(session.current().waitUser, undefined);
});

test("StateMachine_WhenTechnicalFailureOccurs_ShouldRemainInDeep", async () => {
	const { createForgeSessionState } = await import("../../src/runtime/session-state.ts");
	const session = createForgeSessionState();
	const snapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});

	session.startGrillRound("技術失敗後保留的輸入", snapshot);
	session.beginDeepKnowledge("技術失敗後保留的輸入");
	const identity = session.currentDeepAttempt();
	assert.ok(identity);

	session.cancelDeepKnowledge();
	const result = session.handleDeepResult(identity, {
		kind: "completed",
		evidenceIds: [],
		decisionSummary: "不應套用",
	});

	assert.equal(result.kind, "stale");
	assert.equal(session.current().stage, "DEEP_KNOWLEDGE_RETRIEVAL");
	assert.equal(session.current().decisionSummary, "技術失敗後保留的輸入");
	assert.equal(session.currentDeepAttempt(), undefined);
});
