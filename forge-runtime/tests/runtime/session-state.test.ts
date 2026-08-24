import assert from "node:assert/strict";
import test from "node:test";

import { createForgeSessionState } from "../../src/runtime/session-state.ts";

test("SessionState_WhenAnswerRecorded_ShouldEnterUserConfirmedThenGrill", () => {
	const session = createForgeSessionState();
	const round = session.startGrillRound("回答確認", Object.freeze({ candidates: {}, manifest: [] }));
	session.requireWaitUser({
		kind: "grill_confirmation",
		roundId: round.roundId,
		decisionId: "decision-1",
		evidenceIds: ["evidence-1"],
		options: ["選擇 A", "選擇 B"],
		question: "要採用哪個方案？",
		recommendation: "選擇 A",
	});

	session.recordAnswer("選擇 A");

	const finalState = session.current();
	assert.equal(finalState.stage, "GRILL");
	assert.equal(finalState.waitUser, undefined);
	assert.ok(finalState.decisionSummary?.includes("選擇 A"));
	assert.notEqual(finalState.stage, "DEEP_KNOWLEDGE_RETRIEVAL");
});

test("SessionState_WhenDecisionAlreadyAnswered_ShouldRejectDuplicate", () => {
	const session = createForgeSessionState();
	const round = session.startGrillRound("重複回答確認", Object.freeze({ candidates: {}, manifest: [] }));
	session.requireWaitUser({
		kind: "grill_confirmation",
		roundId: round.roundId,
		decisionId: "decision-1",
		decisionSummary: "第一次等待回答",
		evidenceIds: ["evidence-1"],
		options: ["選擇 A", "選擇 B"],
		question: "要採用哪個方案？",
		recommendation: "選擇 A",
	});
	session.recordAnswer("選擇 A");

	session.requireWaitUser({
		kind: "grill_confirmation",
		roundId: round.roundId,
		decisionId: "decision-1",
		decisionSummary: "第二次等待回答",
		evidenceIds: ["evidence-2"],
		options: ["選擇 A", "選擇 B"],
		question: "是否要改採另一個方案？",
		recommendation: "選擇 B",
	});
	const beforeDuplicate = structuredClone(session.current());
	assert.equal(beforeDuplicate.stage, "WAIT_USER");

	const rejectedState = session.recordAnswer("選擇 B");

	assert.deepEqual(rejectedState, beforeDuplicate);
	assert.deepEqual(session.current(), beforeDuplicate);
});

test("SessionState_WhenSameDecisionIdAppearsInNewGrillRound_ShouldAnswerAgain", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });

	const firstRound = session.startGrillRound("第一輪普通確認", snapshot);
	session.requireWaitUser({
		kind: "grill_confirmation",
		roundId: firstRound.roundId,
		decisionId: "decision-reused-across-rounds",
		evidenceIds: [],
		options: ["採用"],
		question: "第一輪是否採用？",
		recommendation: "採用",
	});
	assert.equal(session.recordAnswer("採用").stage, "GRILL");

	const secondRound = session.startGrillRound("第二輪普通確認", snapshot);
	session.requireWaitUser({
		kind: "grill_confirmation",
		roundId: secondRound.roundId,
		decisionId: "decision-reused-across-rounds",
		evidenceIds: [],
		options: ["改採用"],
		question: "第二輪是否仍採用？",
		recommendation: "改採用",
	});

	const finalState = session.recordAnswer("改採用");

	assert.equal(finalState.stage, "GRILL");
	assert.equal(finalState.waitUser, undefined);
	assert.ok(finalState.decisionSummary?.includes("改採用"));
});

test("SessionState_WhenContinueRequested_ShouldRetainRoundAndSnapshot", () => {
	const session = createForgeSessionState();
	const snapshot = {
		candidates: {},
		manifest: [],
	};

	const started = session.startGrillRound("請繼續評估唯一候選方案", snapshot);
	const continued = session.continueGrillRound();

	assert.equal(typeof started.roundId, "string");
	assert.ok(started.roundId.length > 0);
	assert.equal(continued.roundId, started.roundId);
	assert.equal(continued.request, started.request);
	assert.strictEqual(continued.snapshot, started.snapshot);
	assert.strictEqual(continued.snapshot, snapshot);
});

test("SessionState_同一不可變Snapshot跨回答建立下一輪時_應僅首輪為第一輪", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});

	const firstRound = session.startGrillRound("請先評估唯一候選方案", snapshot);
	assert.equal(firstRound.isFirstRoundOfSnapshot, true);
	assert.equal(session.isFirstGrillRoundOfSnapshot(), true);

	session.requireWaitUser({
		kind: "grill_confirmation",
		roundId: firstRound.roundId,
		decisionId: "decision-1",
		evidenceIds: [],
		options: ["繼續"],
		question: "是否繼續？",
		recommendation: "繼續",
	});
	session.recordAnswer("繼續");

	const nextRound = session.startGrillRound("依相同證據繼續評估", snapshot);
	assert.equal(nextRound.isFirstRoundOfSnapshot, false);
	assert.equal(session.isFirstGrillRoundOfSnapshot(), false);
});

test("SessionState_WhenNormalConfirmationIdCollidesWithRoundId_ShouldStillEnterGrill", () => {
	const session = createForgeSessionState();
	const round = session.startGrillRound("請評估一般確認問題", Object.freeze({ candidates: {}, manifest: [] }));
	session.requireWaitUser({
		kind: "grill_confirmation",
		roundId: round.roundId,
		decisionId: "grill-1",
		evidenceIds: [],
		options: ["採用", "拒絕"],
		question: "是否採用？",
		recommendation: "採用",
	});

	const finalState = session.recordAnswer("採用");

	assert.equal(finalState.stage, "GRILL");
	assert.equal(finalState.waitUser, undefined);
});

test("SessionState_切換EvidenceSnapshot後_不應沿用舊Snapshot已抓取證據", () => {
	const session = createForgeSessionState();
	const snapshotA = Object.freeze({
		candidates: Object.freeze({
			"ev-a": Object.freeze({
				candidateId: "ev-a" as const,
				kind: "code_base" as const,
				source: "src/a.ts",
				title: "候選 A",
				content: "內容 A",
				metadata: Object.freeze({}),
			}),
		}),
		manifest: Object.freeze([
			{ candidateId: "ev-a" as const, kind: "code_base" as const, source: "src/a.ts", title: "候選 A" },
		]),
	} as const);
	const snapshotB = Object.freeze({
		candidates: Object.freeze({
			"ev-b": Object.freeze({
				candidateId: "ev-b" as const,
				kind: "code_base" as const,
				source: "src/b.ts",
				title: "候選 B",
				content: "內容 B",
				metadata: Object.freeze({}),
			}),
		}),
		manifest: Object.freeze([
			{ candidateId: "ev-b" as const, kind: "code_base" as const, source: "src/b.ts", title: "候選 B" },
		]),
	} as const);

	session.startGrillRound("評估 A", snapshotA);
	session.recordEvidenceFetch("ev-a");
	assert.deepEqual([...session.getFetchedEvidenceIds()], ["ev-a"]);

	session.startGrillRound("同一快照繼續評估", snapshotA);
	assert.deepEqual([...session.getFetchedEvidenceIds()], ["ev-a"]);

	session.startGrillRound("改用 B", snapshotB);
	assert.deepEqual([...session.getFetchedEvidenceIds()], []);
});

test("SessionState_WhenCompletionOmissionFirstOccurs_ShouldEnterRecoveryOnce", () => {
	const session = createForgeSessionState();
	session.beginGrill();
	const snapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});
	const beforeOmission = session.startGrillRound("請完成目前評估", snapshot);

	const recorded = session.recordCompletionOmission();

	const finalState = session.current();
	const roundAfterOmission = session.continueGrillRound();
	assert.equal(recorded, true);
	assert.equal(finalState.stage, "GRILL");
	assert.deepEqual(finalState.validationRepair, {
		rootCause: "RECOVERY_REQUIRED",
		rollbackTarget: "GRILL",
	});
	assert.equal(finalState.waitUser, undefined);
	assert.equal(roundAfterOmission.roundId, beforeOmission.roundId);
	assert.equal(roundAfterOmission.request, beforeOmission.request);
	assert.strictEqual(roundAfterOmission.snapshot, beforeOmission.snapshot);
});

test("SessionState_WhenSameAttemptOmissionRepeats_ShouldRemainSingleRecovery", () => {
	const session = createForgeSessionState();
	session.beginGrill();
	const snapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});
	session.startGrillRound("請完成目前評估", snapshot);

	assert.equal(session.recordCompletionOmission(), true);
	const stateAfterFirst = session.current();
	const roundAfterFirst = session.continueGrillRound();

	assert.equal(session.recordCompletionOmission(), false);
	const stateAfterSecond = session.current();
	const roundAfterSecond = session.continueGrillRound();
	assert.deepEqual(stateAfterSecond, stateAfterFirst);
	assert.equal(roundAfterSecond.roundId, roundAfterFirst.roundId);
	assert.equal(roundAfterSecond.request, roundAfterFirst.request);
	assert.strictEqual(roundAfterSecond.snapshot, roundAfterFirst.snapshot);
		assert.deepEqual(stateAfterSecond.validationRepair, stateAfterFirst.validationRepair);
		assert.equal(stateAfterSecond.waitUser, undefined);
	});

test("SessionState_WhenExplicitRetryRequested_ShouldRetainRoundAndSnapshotAndStartNewAttempt", () => {
	const session = createForgeSessionState();
	session.beginGrill();
	const snapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});
	const initialRound = session.startGrillRound("請完成目前評估", snapshot);

	assert.equal(session.recordCompletionOmission(), true);
	assert.deepEqual(session.current().validationRepair, {
		rootCause: "RECOVERY_REQUIRED",
		rollbackTarget: "GRILL",
	});

	const retryRound = session.retryGrillRound();
	assert.ok(retryRound);
	assert.equal(retryRound.roundId, initialRound.roundId);
	assert.equal(retryRound.request, initialRound.request);
	assert.strictEqual(retryRound.snapshot, initialRound.snapshot);
	assert.equal(session.current().stage, "GRILL");
	assert.equal(session.current().validationRepair, undefined);
	assert.equal(session.recordCompletionOmission(), true);
});

test("SessionState_WhenResetStartsNextWorkflow_ShouldKeepGrillRoundIdsMonotonic", () => {
	const session = createForgeSessionState();
	const firstSnapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});
	const secondSnapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});

	session.beginIntent();
	session.beginLightDiscovery();
	session.beginGrill();
	const firstRound = session.startGrillRound("請評估第一個工作流程", firstSnapshot);
	assert.equal(firstRound.roundId, "grill-1");

	session.reset();
	session.beginIntent();
	session.beginLightDiscovery();
	session.beginGrill();
	const secondRound = session.startGrillRound("請評估重設後的工作流程", secondSnapshot);

	assert.equal(secondRound.roundId, "grill-2");
});
