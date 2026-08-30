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

test("SessionState_WhenDeepAttemptIdentityChanges_ShouldRejectStaleCall", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});

	session.startGrillRound("請評估深度知識", snapshot);
	session.beginDeepKnowledge("第一次深度知識嘗試");
	const firstIdentity = session.currentDeepAttempt();
	assert.ok(firstIdentity);

	session.beginDeepKnowledge("第二次深度知識嘗試");
	const result = session.completeDeepKnowledge([], undefined, firstIdentity);

	assert.equal(result.kind, "stale");
	assert.equal(session.current().stage, "DEEP_KNOWLEDGE_RETRIEVAL");
});

test("SessionState_WhenContinueRetriesDeep_ShouldIssueNewAttemptId", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});
	const round = session.startGrillRound("同一份輸入", snapshot);

	session.beginDeepKnowledge("同一份輸入");
	const firstIdentity = session.currentDeepAttempt();
	assert.ok(firstIdentity);

	session.beginDeepKnowledge();
	const secondIdentity = session.currentDeepAttempt();
	assert.ok(secondIdentity);

	assert.notEqual(secondIdentity.attemptId, firstIdentity.attemptId);
	assert.equal(secondIdentity.sourceRoundId, firstIdentity.sourceRoundId);
	assert.equal(secondIdentity.sourceRoundId, round.roundId);
	assert.equal(session.current().decisionSummary, "同一份輸入");
});
test("SessionState_WhenDeepCancelled_ShouldPreserveCurrentInput", () => {
	const state = createForgeSessionState();
	const snapshot = Object.freeze({
		candidates: Object.freeze({}),
		manifest: Object.freeze([]),
	});

	const startedRound = state.startGrillRound("取消後仍保留的輸入", snapshot);
	state.beginDeepKnowledge("取消後仍保留的輸入");
	const identity = state.currentDeepAttempt();
	assert.ok(identity);
	state.recordDeepSupplementalEvidence(identity, "ev-deep-cancelled");

	state.cancelDeepKnowledge();

	assert.equal(state.currentDeepAttempt(), undefined);
	assert.equal(state.current().decisionSummary, "取消後仍保留的輸入");
	assert.equal(state.current().stage, "DEEP_KNOWLEDGE_RETRIEVAL");
	assert.strictEqual(state.continueGrillRound().snapshot, startedRound.snapshot);
	assert.deepEqual(state.getDeepSupplementalEvidenceIds(), new Set(["ev-deep-cancelled"]));
});
test("SessionState_WhenSnapshotChanges_ShouldDiscardOldSupplementalEvidence", () => {
	const snapshotA = Object.freeze({ candidates: Object.freeze({}), manifest: Object.freeze([]) });
	const snapshotB = Object.freeze({ candidates: Object.freeze({}), manifest: Object.freeze([]) });
	const state = createForgeSessionState();

	state.startGrillRound("request", snapshotA);
	state.beginDeepKnowledge();
	const identity = state.currentDeepAttempt();
	assert.ok(identity);
	state.recordDeepSupplementalEvidence(identity, "ev-deep-a");
	assert.deepEqual(state.getDeepSupplementalEvidenceIds(), new Set(["ev-deep-a"]));

	state.startGrillRound("retry", snapshotA);
	assert.deepEqual(state.getDeepSupplementalEvidenceIds(), new Set(["ev-deep-a"]));

	state.startGrillRound("new snapshot", snapshotB);
	assert.deepEqual(state.getDeepSupplementalEvidenceIds(), new Set());
	assert.equal(state.currentDeepAttempt(), undefined);
});

test("SessionState_WhenNeedsDiscoveryOccursTwice_ShouldEnterDeepDiscoveryFallbackWaitUser", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });

	session.beginGrill();
	session.startGrillRound("資料不足時重試深度知識", snapshot);
	session.beginDeepKnowledge();
	const firstIdentity = session.currentDeepAttempt();
	assert.ok(firstIdentity);

	const firstResult = session.handleDeepResult(firstIdentity, { kind: "needs_discovery" });
	assert.equal(firstResult.kind, "accepted");
	assert.equal(session.current().stage, "LIGHT_DISCOVERY");

	session.beginGrill();
	session.startGrillRound("資料不足時第二次重試深度知識", snapshot);
	session.beginDeepKnowledge();
	const secondIdentity = session.currentDeepAttempt();
	assert.ok(secondIdentity);

	const secondResult = session.handleDeepResult(secondIdentity, { kind: "needs_discovery" });
	if (secondResult.kind !== "accepted") throw new Error("第二次 needs_discovery 應接受並進入 WAIT_USER");

	assert.deepEqual(
		{
			kind: secondResult.kind,
			stage: secondResult.state.stage,
			waitUser: {
				kind: secondResult.state.waitUser?.kind,
				question: secondResult.state.waitUser?.question,
				options: secondResult.state.waitUser?.options,
				recommendation: secondResult.state.waitUser?.recommendation,
			},
		},
		{
			kind: "accepted",
			stage: "WAIT_USER",
			waitUser: {
				kind: "deep_discovery_fallback",
				question: "此專案資料來源不足，將以前次grill/ 資料來源所得之證據進行後續開發，請確認",
				options: ["確認", "同意"],
				recommendation: "確認",
			},
		},
	);
});

test("SessionState_WhenDeepDiscoveryFallbackReceivesNonExactAnswer_ShouldRemainWaitUser", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });

	session.beginGrill();
	session.startGrillRound("資料不足時重試深度知識", snapshot);
	session.beginDeepKnowledge();
	const firstIdentity = session.currentDeepAttempt();
	assert.ok(firstIdentity);
	session.handleDeepResult(firstIdentity, { kind: "needs_discovery" });

	session.beginGrill();
	session.startGrillRound("資料不足時第二次重試深度知識", snapshot);
	session.beginDeepKnowledge();
	const secondIdentity = session.currentDeepAttempt();
	assert.ok(secondIdentity);
	session.handleDeepResult(secondIdentity, { kind: "needs_discovery" });

	const before = session.current();
	session.recordAnswer("我同意");
	const after = session.current();

	assert.deepEqual(
		{
			stage: after.stage,
			waitUser: after.waitUser,
			humanDecisionCount: session.getHumanDecisions().length,
		},
		{
			stage: "WAIT_USER",
			waitUser: before.waitUser,
			humanDecisionCount: 0,
		},
	);
});

test("SessionState_WhenDeepDiscoveryFallbackReceivesExactConfirmation_ShouldBeginKnowledgeUnderstanding", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });

	session.beginGrill();
	session.startGrillRound("資料不足時重試深度知識", snapshot);
	session.beginDeepKnowledge();
	const firstIdentity = session.currentDeepAttempt();
	assert.ok(firstIdentity);
	session.handleDeepResult(firstIdentity, { kind: "needs_discovery" });

	session.beginGrill();
	session.startGrillRound("資料不足時第二次重試深度知識", snapshot);
	session.beginDeepKnowledge();
	const secondIdentity = session.currentDeepAttempt();
	assert.ok(secondIdentity);
	session.handleDeepResult(secondIdentity, { kind: "needs_discovery" });

	session.recordAnswer("  確認  ");
	const confirmedState = session.current();
	session.beginDeepKnowledge(undefined, "KNOWLEDGE_UNDERSTANDING");
	const understandingState = session.current();
	const understandingIdentity = session.currentDeepAttempt();

	assert.deepEqual(
		{
			confirmed: {
				stage: confirmedState.stage,
				waitUser: confirmedState.waitUser,
				humanDecisionCount: session.getHumanDecisions().length,
			},
			understanding: {
				stage: understandingState.stage,
				activeIdentity: understandingIdentity !== undefined,
				identityPhase: understandingIdentity?.phase,
			},
		},
		{
			confirmed: {
				stage: "USER_CONFIRMED",
				waitUser: undefined,
				humanDecisionCount: 1,
			},
			understanding: {
				stage: "KNOWLEDGE_UNDERSTANDING",
				activeIdentity: true,
				identityPhase: "KNOWLEDGE_UNDERSTANDING",
			},
		},
	);
});

test("SessionState_WhenNeedsDiscoveryOccursAgainAfterFallbackConfirmation_ShouldRemainInFallbackWaitUser", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });

	session.beginGrill();
	session.startGrillRound("資料不足時第一次重試深度知識", snapshot);
	session.beginDeepKnowledge();
	const firstIdentity = session.currentDeepAttempt();
	assert.ok(firstIdentity);
	const firstResult = session.handleDeepResult(firstIdentity, { kind: "needs_discovery" });
	assert.equal(firstResult.kind, "accepted");
	assert.equal(firstResult.state.stage, "LIGHT_DISCOVERY");

	session.beginGrill();
	session.startGrillRound("資料不足時第二次重試深度知識", snapshot);
	session.beginDeepKnowledge();
	const secondIdentity = session.currentDeepAttempt();
	assert.ok(secondIdentity);
	const fallbackResult = session.handleDeepResult(secondIdentity, { kind: "needs_discovery" });
	assert.equal(fallbackResult.kind, "accepted");
	assert.equal(fallbackResult.state.stage, "WAIT_USER");

	session.recordAnswer("確認");
	assert.equal(session.current().stage, "USER_CONFIRMED");
	session.beginDeepKnowledge(undefined, "KNOWLEDGE_UNDERSTANDING");
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	assert.equal(understandingIdentity.phase, "KNOWLEDGE_UNDERSTANDING");

	const thirdResult = session.handleDeepResult(understandingIdentity, { kind: "needs_discovery" });

	assert.equal(thirdResult.kind, "accepted");
	assert.equal(thirdResult.state.stage, "WAIT_USER");
	assert.equal(thirdResult.state.waitUser?.kind, "deep_discovery_fallback");
	assert.equal(
		thirdResult.state.waitUser?.question,
		"此專案資料來源不足，將以前次grill/ 資料來源所得之證據進行後續開發，請確認",
	);
	assert.deepEqual(thirdResult.state.waitUser?.options, ["確認", "同意"]);
	assert.equal(thirdResult.state.waitUser?.recommendation, "確認");
});

test("SessionState_WhenDeepDiscoveryFallbackIsCancelled_ShouldResetCounterBeforeRetry", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });

	session.beginGrill();
	session.startGrillRound("資料不足時第一次重試深度知識", snapshot);
	session.beginDeepKnowledge();
	const firstIdentity = session.currentDeepAttempt();
	assert.ok(firstIdentity);
	const firstResult = session.handleDeepResult(firstIdentity, { kind: "needs_discovery" });
	assert.equal(firstResult.kind, "accepted");
	assert.equal(firstResult.state.stage, "LIGHT_DISCOVERY");

	session.beginGrill();
	session.startGrillRound("資料不足時第二次重試深度知識", snapshot);
	session.beginDeepKnowledge();
	const secondIdentity = session.currentDeepAttempt();
	assert.ok(secondIdentity);
	const fallbackResult = session.handleDeepResult(secondIdentity, { kind: "needs_discovery" });
	assert.equal(fallbackResult.kind, "accepted");
	assert.equal(fallbackResult.state.stage, "WAIT_USER");
	assert.equal(fallbackResult.state.waitUser?.kind, "deep_discovery_fallback");

	const cancelledState = session.cancelDeepKnowledge();
	assert.equal(cancelledState.stage, "DEEP_KNOWLEDGE_RETRIEVAL");
	assert.equal(cancelledState.waitUser, undefined);
	assert.equal(session.currentDeepAttempt(), undefined);

	const retriedState = session.retryDeepKnowledge();
	const retriedIdentity = session.currentDeepAttempt();
	assert.ok(retriedIdentity);
	assert.equal(retriedState.stage, "DEEP_KNOWLEDGE_RETRIEVAL");
	assert.notEqual(retriedIdentity.attemptId, secondIdentity.attemptId);

	const afterRetryResult = session.handleDeepResult(retriedIdentity, { kind: "needs_discovery" });
	assert.equal(afterRetryResult.kind, "accepted");
	assert.equal(afterRetryResult.state.stage, "LIGHT_DISCOVERY");
	assert.equal(afterRetryResult.state.waitUser, undefined);
});

test("SessionState_WhenResetAfterNeedsDiscovery_ShouldTreatNextNeedsDiscoveryAsFirstOccurrence", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });

	session.beginGrill();
	session.startGrillRound("重設前的深度知識", snapshot);
	session.beginDeepKnowledge();
	const firstIdentity = session.currentDeepAttempt();
	assert.ok(firstIdentity);
	const firstResult = session.handleDeepResult(firstIdentity, { kind: "needs_discovery" });
	assert.equal(firstResult.kind, "accepted");
	assert.equal(session.current().stage, "LIGHT_DISCOVERY");

	session.reset();
	session.beginGrill();
	session.startGrillRound("重設後的深度知識", snapshot);
	session.beginDeepKnowledge();
	const nextIdentity = session.currentDeepAttempt();
	assert.ok(nextIdentity);
	const nextResult = session.handleDeepResult(nextIdentity, { kind: "needs_discovery" });

	assert.equal(nextResult.kind, "accepted");
	assert.equal(nextResult.state.stage, "LIGHT_DISCOVERY");
	assert.equal(nextResult.state.waitUser, undefined);
});

test("SessionState_WhenDeepEvidenceIdRepeats_ShouldKeepFirstSameContentAndRejectDifferentContent", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });

	session.startGrillRound("驗證 Deep evidence ID 衝突", snapshot);
	session.beginDeepKnowledge();
	const identity = session.currentDeepAttempt();
	assert.ok(identity);

	const firstEvidence = {
		evidenceId: "ev-conflict",
		kind: "human_premise",
		source: "使用者輸入",
		title: "第一筆標題",
		content: "內容 A",
		metadata: { source: "first", order: 1 },
	};
	const secondSameContent = {
		...firstEvidence,
		source: "另一個來源",
		title: "第二筆標題",
		metadata: { source: "second", order: 2 },
	};
	const differentContent = { ...firstEvidence, content: "內容 B" };

	session.recordDeepSupplementalEvidence(identity, firstEvidence.evidenceId, firstEvidence);
	session.recordDeepSupplementalEvidence(identity, secondSameContent.evidenceId, secondSameContent);

	assert.deepEqual(session.getDeepSupplementalEvidenceIds(), new Set(["ev-conflict"]));
	assert.deepEqual(session.getDeepSupplementalEvidence(), [firstEvidence]);

	const stateBeforeConflict = structuredClone(session.current());
	const identityBeforeConflict = session.currentDeepAttempt();
	assert.throws(
		() => session.recordDeepSupplementalEvidence(identity, differentContent.evidenceId, differentContent),
		(error: unknown) => error instanceof Error && error.message.includes("evidence_id_content_conflict"),
	);

	assert.deepEqual(session.getDeepSupplementalEvidenceIds(), new Set(["ev-conflict"]));
	assert.deepEqual(session.getDeepSupplementalEvidence(), [firstEvidence]);
	assert.deepEqual(session.current(), stateBeforeConflict);
	assert.deepEqual(session.currentDeepAttempt(), identityBeforeConflict);
});
