import assert from "node:assert/strict";
import test from "node:test";

import { createForgeSessionState } from "../../src/runtime/session-state.ts";
import { createEvidencePackage } from "../../src/evidence/evidence-engine.ts";

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

test("GrillConfirmation_WhenNoExternalEvidence_ShouldCreateHumanPremiseEvidence", () => {
	const session = createForgeSessionState();
	const request = "建立一個全新的產品，確認需求與範圍";
	const question = "是否確認新產品需求與範圍？";
	const answer = "確認";
	const decisionId = "new-product-scope-confirmation";
	const round = session.startGrillRound(request, Object.freeze({ candidates: {}, manifest: [] }));
	session.requireWaitUser({
		kind: "grill_confirmation",
		roundId: round.roundId,
		decisionId,
		evidenceIds: [],
		options: ["確認", "修改"],
		question,
		recommendation: "確認",
	});

	session.recordAnswer(answer);

	const premises = session.getHumanPremises();
	assert.equal(premises.length, 1);
	const premise = premises[0];
	assert.ok(premise);
	assert.equal(premise.kind, "human_premise");
	assert.match(premise.content, new RegExp(request));
	assert.match(premise.content, new RegExp(question));
	assert.match(premise.content, new RegExp(answer));
	assert.equal(premise.metadata.roundId, round.roundId);
	assert.equal(premise.metadata.decisionId, decisionId);
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
	const beforeReplay = structuredClone(session.current());
	assert.equal(beforeReplay.stage, "GRILL");

	const replayedState = session.requireWaitUser({
		kind: "grill_confirmation",
		roundId: round.roundId,
		decisionId: "decision-1",
		decisionSummary: "第二次等待回答",
		evidenceIds: ["evidence-2"],
		options: ["選擇 A", "選擇 B"],
		question: "是否要改採另一個方案？",
		recommendation: "選擇 B",
	});

	assert.deepEqual(replayedState, beforeReplay);
	assert.deepEqual(session.current(), beforeReplay);
	assert.equal(session.getHumanDecisions().length, 1);
});

test("SessionState_WhenSameDecisionIdAppearsInNewGrillRound_ShouldRejectWholeChainDuplicate", () => {
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
	const beforeDuplicate = structuredClone(session.current());
	const duplicateState = session.requireWaitUser({
		kind: "grill_confirmation",
		roundId: secondRound.roundId,
		decisionId: "decision-reused-across-rounds",
		evidenceIds: [],
		options: ["改採用"],
		question: "第二輪是否仍採用？",
		recommendation: "改採用",
	});

	assert.deepEqual(duplicateState, beforeDuplicate);
	assert.deepEqual(session.current(), beforeDuplicate);
	assert.equal(session.current().stage, "GRILL");
	assert.equal(session.getHumanDecisions().length, 1);
	assert.match(session.getHumanDecisions()[0]?.statement ?? "", /採用/);
});

test("SessionState_WhenAnsweredOldRoundPayloadIsReplayed_ShouldNoOp", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	const firstRound = session.startGrillRound("第一輪確認", snapshot);
	const payload = {
		kind: "grill_confirmation" as const,
		roundId: firstRound.roundId,
		decisionId: "answered-old-round",
		evidenceIds: [],
		options: ["採用"],
		question: "是否採用？",
		recommendation: "採用",
	};

	session.requireWaitUser(payload);
	session.recordAnswer("採用");
	session.startGrillRound("第二輪確認", snapshot);
	const beforeReplay = structuredClone(session.current());

	assert.deepEqual(session.requireWaitUser(payload), beforeReplay);
	assert.deepEqual(session.requireGrillResult(payload), beforeReplay);
	assert.deepEqual(session.current(), beforeReplay);
	assert.equal(session.getHumanDecisions().length, 1);
});

test("SessionState_WhenBlankAnswerIsRecorded_ShouldRemainWaitingWithoutSaving", () => {
	const session = createForgeSessionState();
	const round = session.startGrillRound("空白回答確認", Object.freeze({ candidates: {}, manifest: [] }));
	session.requireWaitUser({
		kind: "grill_confirmation",
		roundId: round.roundId,
		decisionId: "blank-answer",
		evidenceIds: [],
		options: ["採用"],
		question: "是否採用？",
		recommendation: "採用",
	});
	const beforeBlankAnswer = structuredClone(session.current());

	const afterBlankAnswer = session.recordAnswer("   ");

	assert.deepEqual(afterBlankAnswer, beforeBlankAnswer);
	assert.deepEqual(session.current(), beforeBlankAnswer);
	assert.equal(session.getHumanDecisions().length, 0);
});

test("GrillConfirmation_WhenAnswerIsNotConfirmed_ShouldNotCreateHumanPremiseEvidence", () => {
	const session = createForgeSessionState();
	const round = session.startGrillRound("確認新產品規範", Object.freeze({ candidates: {}, manifest: [] }));
	session.requireWaitUser({
		kind: "grill_confirmation",
		roundId: round.roundId,
		decisionId: "unconfirmed-answer",
		evidenceIds: [],
		options: ["確認", "修改"],
		question: "是否確認？",
		recommendation: "確認",
	});

	session.recordAnswer("   ");

	assert.equal(session.current().stage, "WAIT_USER");
	assert.deepEqual(session.getHumanPremises(), []);
	assert.deepEqual(session.getHumanDecisions(), []);
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

test("SessionState_WhenKnowledgeUnderstandingCompletes_ShouldStoreFullPackageBeforeContextBuild", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("交付完整 Knowledge Understanding", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);

	const retrievalResult = session.completeDeepKnowledge([], undefined, retrievalIdentity);
	assert.equal(retrievalResult.kind, "accepted");

	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-knowledge-understanding",
		kind: "wiki",
		source: "wiki/spec",
		title: "Knowledge Understanding 規格",
		content: "已驗證的規格內容",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [
			{
				decisionId: "decision-knowledge-understanding",
				statement: "採用已驗證的規格",
				evidenceIds: [evidence.evidenceId],
			},
		],
		findings: [
			{
				statement: "已確認規格可供 Context Build 使用",
				evidenceIds: [evidence.evidenceId],
			},
		],
		limitations: [{ statement: "尚未接上自動續跑 Context Build", blocking: false }],
		knowledgeSummary: "已驗證的完整知識摘要",
	});

	const result = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });

	assert.equal(result.kind, "accepted");
	assert.equal(result.state.stage, "CONTEXT_BUILD");
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), evidencePackage);
	const storedPackage = session.getKnowledgeUnderstandingPackage();
	assert.ok(storedPackage);
	assert.equal(storedPackage.knowledgeSummary, "已驗證的完整知識摘要");
	assert.deepEqual(storedPackage.decisions, evidencePackage.decisions);
	assert.deepEqual(storedPackage.findings, evidencePackage.findings);
	assert.deepEqual(storedPackage.limitations, evidencePackage.limitations);
	assert.deepEqual(storedPackage.evidenceIds, [evidence.evidenceId]);
});

test("CompleteContextBuild_WhenCandidateIsValid_ShouldStoreCandidateAndEnterAdrBuild", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("交付完整 Knowledge Understanding", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);

	session.completeDeepKnowledge([], undefined, retrievalIdentity);
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-context-build",
		kind: "wiki",
		source: "wiki/spec",
		title: "Context Build 規格",
		content: "已驗證的 Context Build 規格內容",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [
			{
				decisionId: "decision-context-build",
				statement: "採用已驗證的 Context Build 規格",
				evidenceIds: [evidence.evidenceId],
			},
		],
		findings: [
			{
				statement: "已確認規格可供 Context Build 使用",
				evidenceIds: [evidence.evidenceId],
			},
		],
		limitations: [{ statement: "尚未接上自動續跑 Context Build", blocking: false }],
		knowledgeSummary: "已驗證的完整知識摘要",
	});

	const understandingResult = session.handleDeepResult(understandingIdentity, {
		kind: "completed",
		evidencePackage,
	});
	assert.equal(understandingResult.kind, "accepted");
	assert.equal(understandingResult.state.stage, "CONTEXT_BUILD");
	const storedPackage = session.getKnowledgeUnderstandingPackage();
	assert.ok(storedPackage);
	const contextIdentity = session.currentContextBuildAttempt();
	assert.ok(contextIdentity);
	const candidate = {
		glossary: [
			{
				term: "產品範圍",
				definition: "使用者確認的新產品需求邊界。",
				evidenceIds: [evidence.evidenceId],
			},
		],
	};

	const result = session.completeContextBuild(contextIdentity, { kind: "completed", candidate });

	assert.equal(result.kind, "accepted");
	assert.equal(result.state.stage, "ADR_BUILD");
	const storedCandidate = session.getContextCandidate();
	assert.deepEqual(storedCandidate, candidate);
	assert.notStrictEqual(storedCandidate, candidate);
	assert.ok(Object.isFrozen(storedCandidate));
	assert.ok(Object.isFrozen(storedCandidate.glossary));
	assert.ok(Object.isFrozen(storedCandidate.glossary[0]));
	assert.ok(Object.isFrozen(storedCandidate.glossary[0].evidenceIds));
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), storedPackage);
});

test("CompleteContextBuild_WhenCandidateIsValid_ShouldIssueAdrBuildAttempt", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("交付 Context Build 後建立 ADR Build attempt", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-adr-build-attempt",
		kind: "wiki",
		source: "wiki/spec",
		title: "ADR Build attempt 規格",
		content: "已驗證的 ADR Build attempt 規格內容",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "已驗證的完整知識摘要",
	});
	const understandingResult = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });
	assert.equal(understandingResult.kind, "accepted");
	assert.equal(understandingResult.state.stage, "CONTEXT_BUILD");
	const contextIdentity = session.currentContextBuildAttempt();
	assert.ok(contextIdentity);

	const result = session.completeContextBuild(contextIdentity, {
		kind: "completed",
		candidate: {
			glossary: [
				{
					term: "產品範圍",
					definition: "使用者確認的新產品需求邊界。",
					evidenceIds: [evidence.evidenceId],
				},
			],
		},
	});

	assert.equal(result.kind, "accepted");
	assert.equal(result.state.stage, "ADR_BUILD");
	const adrIdentity = session.currentAdrBuildAttempt();
	assert.ok(adrIdentity);
	assert.ok(adrIdentity.attemptId.length > 0);
	assert.notEqual(adrIdentity.attemptId, contextIdentity.attemptId);
	assert.equal(adrIdentity.sourceRoundId, contextIdentity.sourceRoundId);
	assert.equal(session.currentContextBuildAttempt(), undefined);
});

test("PrepareAdrBuild_WhenCandidatesAreValid_ShouldStoreImmutableCandidatesWithoutAdvancing", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("準備 ADR Build candidate", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-adr-candidate",
		kind: "wiki",
		source: "wiki/spec",
		title: "ADR candidate 規格",
		content: "已驗證的 ADR candidate 證據",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "已驗證的完整知識摘要",
	});
	const understandingResult = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });
	assert.equal(understandingResult.kind, "accepted");
	assert.equal(understandingResult.state.stage, "CONTEXT_BUILD");
	const contextIdentity = session.currentContextBuildAttempt();
	assert.ok(contextIdentity);
	const contextCandidate = {
		glossary: [
			{
				term: "產品範圍",
				definition: "使用者確認的新產品需求邊界。",
				evidenceIds: [evidence.evidenceId],
			},
		],
	};
	const contextResult = session.completeContextBuild(contextIdentity, { kind: "completed", candidate: contextCandidate });
	assert.equal(contextResult.kind, "accepted");
	assert.equal(contextResult.state.stage, "ADR_BUILD");
	const adrIdentity = session.currentAdrBuildAttempt();
	assert.ok(adrIdentity);
	const storedContextCandidate = session.getContextCandidate();
	const storedKnowledgePackage = session.getKnowledgeUnderstandingPackage();
	assert.ok(storedContextCandidate);
	assert.ok(storedKnowledgePackage);
	const candidate = {
		records: [
			{
				decision: "採用單一產品範圍",
				rationale: "可由 Context candidate 與使用者前提共同支持。",
				consequences: ["後續規格沿用此範圍"],
				citations: [evidence.evidenceId],
			},
		],
		handoff: {
			summary: "Context Build 已完成，準備進入規格化。",
			nextSessionFocus: "依 ADR candidate 產生正式規格。",
			references: ["Documents/CONTEXT.md", "Documents/ADR.md"],
			suggestedSkills: ["execute-designed-plan"],
		},
	};

	const result = session.prepareAdrBuild(adrIdentity, candidate);

	assert.equal(result.kind, "accepted");
	assert.equal(result.state.stage, "ADR_BUILD");
	const storedCandidate = session.getAdrBuildCandidate();
	assert.deepEqual(storedCandidate, candidate);
	assert.notStrictEqual(storedCandidate, candidate);
	assert.ok(Object.isFrozen(storedCandidate));
	assert.ok(Object.isFrozen(storedCandidate.records));
	assert.ok(Object.isFrozen(storedCandidate.records[0]));
	assert.ok(Object.isFrozen(storedCandidate.records[0].consequences));
	assert.ok(Object.isFrozen(storedCandidate.records[0].citations));
	assert.ok(Object.isFrozen(storedCandidate.handoff));
	assert.ok(Object.isFrozen(storedCandidate.handoff.references));
	assert.ok(Object.isFrozen(storedCandidate.handoff.suggestedSkills));
	assert.deepEqual(session.currentAdrBuildAttempt(), adrIdentity);
	assert.strictEqual(session.getContextCandidate(), storedContextCandidate);
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), storedKnowledgePackage);
});

test("FinalizeAdrBuild_WhenDocumentsCommitted_ShouldEnterToSpec", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("完成 ADR Build 文件提交", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-finalize-adr-build",
		kind: "wiki",
		source: "wiki/spec",
		title: "Finalize ADR Build 規格",
		content: "已驗證的文件提交規格內容",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "已驗證的完整知識摘要",
	});
	const understandingResult = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });
	assert.equal(understandingResult.kind, "accepted");
	assert.equal(understandingResult.state.stage, "CONTEXT_BUILD");
	const contextIdentity = session.currentContextBuildAttempt();
	assert.ok(contextIdentity);
	const contextCandidate = {
		glossary: [
			{
				term: "產品範圍",
				definition: "使用者確認的新產品需求邊界。",
				evidenceIds: [evidence.evidenceId],
			},
		],
	};
	const contextResult = session.completeContextBuild(contextIdentity, { kind: "completed", candidate: contextCandidate });
	assert.equal(contextResult.kind, "accepted");
	assert.equal(contextResult.state.stage, "ADR_BUILD");
	const adrIdentity = session.currentAdrBuildAttempt();
	assert.ok(adrIdentity);
	const adrCandidate = {
		records: [
			{
				decision: "採用單一產品範圍",
				rationale: "由 Context candidate 與已驗證證據共同支持。",
				consequences: ["後續規格沿用此範圍"],
				citations: [evidence.evidenceId],
			},
		],
		handoff: {
			summary: "ADR Build 已完成，準備進入規格化。",
			nextSessionFocus: "依 ADR candidate 產生正式規格。",
			references: ["Documents/CONTEXT.md", "Documents/ADR.md"],
			suggestedSkills: ["execute-designed-plan"],
		},
	};
	assert.equal(session.prepareAdrBuild(adrIdentity, adrCandidate).kind, "accepted");
	const storedAdrCandidate = session.getAdrBuildCandidate();
	const storedContextCandidate = session.getContextCandidate();
	const storedKnowledgePackage = session.getKnowledgeUnderstandingPackage();
	assert.ok(storedAdrCandidate);
	assert.ok(storedContextCandidate);
	assert.ok(storedKnowledgePackage);

	const result = session.finalizeAdrBuild(adrIdentity, {
		kind: "committed",
		baseHash: "a".repeat(64),
	});

	assert.equal(result.kind, "accepted");
	assert.equal(result.state.stage, "TO_SPEC");
	assert.equal(session.currentAdrBuildAttempt(), undefined);
	assert.strictEqual(session.getAdrBuildCandidate(), storedAdrCandidate);
	assert.strictEqual(session.getContextCandidate(), storedContextCandidate);
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), storedKnowledgePackage);
	assert.equal(session.current().waitUser, undefined);
});

test("PrepareAdrBuild_WhenRecordCitesUnknownEvidence_ShouldFailClosed", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("未知 citation 的 ADR Build candidate", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-adr-validation",
		kind: "wiki",
		source: "wiki/spec",
		title: "ADR validation 規格",
		content: "已驗證的 ADR validation 證據",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "已驗證的完整知識摘要",
	});
	const understandingResult = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });
	assert.equal(understandingResult.kind, "accepted");
	assert.equal(understandingResult.state.stage, "CONTEXT_BUILD");
	const contextIdentity = session.currentContextBuildAttempt();
	assert.ok(contextIdentity);
	const contextCandidate = {
		glossary: [
			{
				term: "產品範圍",
				definition: "使用者確認的新產品需求邊界。",
				evidenceIds: [evidence.evidenceId],
			},
		],
	};
	const contextResult = session.completeContextBuild(contextIdentity, { kind: "completed", candidate: contextCandidate });
	assert.equal(contextResult.kind, "accepted");
	assert.equal(contextResult.state.stage, "ADR_BUILD");
	const adrIdentity = session.currentAdrBuildAttempt();
	assert.ok(adrIdentity);
	const storedContextCandidate = session.getContextCandidate();
	const storedKnowledgePackage = session.getKnowledgeUnderstandingPackage();
	assert.ok(storedContextCandidate);
	assert.ok(storedKnowledgePackage);
	const candidate = {
		records: [
			{
				decision: "採用單一產品範圍",
				rationale: "其餘欄位有效，但 citation 不存在於 Knowledge Package。",
				consequences: ["後續規格沿用此範圍"],
				citations: ["ev-not-in-package"],
			},
		],
		handoff: {
			summary: "Context Build 已完成，準備進入規格化。",
			nextSessionFocus: "依 ADR candidate 產生正式規格。",
			references: ["Documents/CONTEXT.md", "Documents/ADR.md"],
			suggestedSkills: ["execute-designed-plan"],
		},
	};

	const result = session.prepareAdrBuild(adrIdentity, candidate);

	assert.equal(result.kind, "invalid");
	if (result.kind !== "invalid") throw new Error("未知 citation 應拒絕 ADR candidate");
	assert.ok(result.errors.some((error) => error.includes("ev-not-in-package")));
	assert.equal(result.state.stage, "ADR_BUILD");
	assert.equal(session.getAdrBuildCandidate(), undefined);
	assert.deepEqual(session.currentAdrBuildAttempt(), adrIdentity);
	assert.strictEqual(session.getContextCandidate(), storedContextCandidate);
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), storedKnowledgePackage);
});

test("PrepareAdrBuild_WhenHandoffContainsObviousSecret_ShouldFailClosed", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("敏感資訊檢查的 ADR Build candidate", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-adr-secret-validation",
		kind: "wiki",
		source: "wiki/spec",
		title: "ADR secret validation 規格",
		content: "已驗證的 ADR secret validation 證據",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "已驗證的完整知識摘要",
	});
	const understandingResult = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });
	assert.equal(understandingResult.kind, "accepted");
	assert.equal(understandingResult.state.stage, "CONTEXT_BUILD");
	const contextIdentity = session.currentContextBuildAttempt();
	assert.ok(contextIdentity);
	const contextCandidate = {
		glossary: [
			{
				term: "產品範圍",
				definition: "使用者確認的新產品需求邊界。",
				evidenceIds: [evidence.evidenceId],
			},
		],
	};
	const contextResult = session.completeContextBuild(contextIdentity, { kind: "completed", candidate: contextCandidate });
	assert.equal(contextResult.kind, "accepted");
	assert.equal(contextResult.state.stage, "ADR_BUILD");
	const storedContextCandidate = session.getContextCandidate();
	assert.ok(storedContextCandidate);
	const adrIdentity = session.currentAdrBuildAttempt();
	assert.ok(adrIdentity);
	const candidate = {
		records: [
			{
				decision: "採用單一產品範圍",
				rationale: "record 與 citation 均有合法證據支持。",
				consequences: ["後續規格沿用此範圍"],
				citations: [evidence.evidenceId],
			},
		],
		handoff: {
			summary: "交接摘要 api_key=sk-live-secret-value",
			nextSessionFocus: "依 ADR candidate 產生正式規格。",
			references: ["Documents/CONTEXT.md", "Documents/ADR.md"],
			suggestedSkills: ["execute-designed-plan"],
		},
	};

	const result = session.prepareAdrBuild(adrIdentity, candidate);

	assert.equal(result.kind, "invalid");
	if (result.kind !== "invalid") throw new Error("handoff 明文敏感資訊應拒絕 ADR candidate");
	assert.ok(result.errors.some((error) => /敏感|secret/i.test(error)));
	assert.equal(result.state.stage, "ADR_BUILD");
	assert.equal(session.getAdrBuildCandidate(), undefined);
	assert.deepEqual(session.currentAdrBuildAttempt(), adrIdentity);
	assert.strictEqual(session.getContextCandidate(), storedContextCandidate);
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), evidencePackage);
});

test("CompleteContextBuild_WhenCandidateCitesUnknownEvidence_ShouldFailClosed", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("拒絕未知 Context Build 證據", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-context-known",
		kind: "wiki",
		source: "wiki/spec",
		title: "Context Build 已知證據",
		content: "候選內容可引用的已知證據",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "已驗證的 Context Build 摘要",
	});
	const understandingResult = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });
	assert.equal(understandingResult.kind, "accepted");
	assert.equal(understandingResult.state.stage, "CONTEXT_BUILD");
	const contextIdentity = session.currentContextBuildAttempt();
	assert.ok(contextIdentity);
	const storedPackage = session.getKnowledgeUnderstandingPackage();
	assert.ok(storedPackage);

	const result = session.completeContextBuild(contextIdentity, {
		kind: "completed",
		candidate: {
			glossary: [
				{
					term: "產品範圍",
					definition: "使用者確認的新產品需求邊界。",
					evidenceIds: ["ev-not-in-package"],
				},
			],
		},
	});

	assert.equal(result.kind, "invalid");
	assert.ok(result.errors.some((error) => error.includes("ev-not-in-package")));
	assert.equal(result.state.stage, "CONTEXT_BUILD");
	assert.equal(session.getContextCandidate(), undefined);
	assert.deepEqual(session.currentContextBuildAttempt(), contextIdentity);
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), storedPackage);
});

test("CompleteContextBuild_WhenAmbiguityCitesUnknownEvidence_ShouldFailClosed", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("拒絕未知歧義 Context Build 證據", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-context-ambiguity-known",
		kind: "wiki",
		source: "wiki/spec",
		title: "歧義已知證據",
		content: "可供歧義選項引用的已知證據",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "已驗證的 Context Build 摘要",
	});
	const understandingResult = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });
	assert.equal(understandingResult.kind, "accepted");
	assert.equal(understandingResult.state.stage, "CONTEXT_BUILD");
	const contextIdentity = session.currentContextBuildAttempt();
	assert.ok(contextIdentity);
	const storedPackage = session.getKnowledgeUnderstandingPackage();
	assert.ok(storedPackage);

	const result = session.completeContextBuild(contextIdentity, {
		kind: "ambiguous",
		ambiguity: {
			decisionId: "context-unknown-evidence",
			question: "產品範圍要採用哪一種定義？",
			options: ["最小範圍", "完整範圍"],
			recommendation: "最小範圍",
			evidenceIds: ["ev-not-in-package"],
		},
	});

	assert.equal(result.kind, "invalid");
	assert.ok(result.errors.some((error) => error.includes("ev-not-in-package")));
	assert.equal(result.state.stage, "CONTEXT_BUILD");
	assert.equal(result.state.waitUser, undefined);
	assert.deepEqual(session.currentContextBuildAttempt(), contextIdentity);
	assert.equal(session.getContextCandidate(), undefined);
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), storedPackage);
});

test("CompleteContextBuild_WhenMaterialAmbiguityExists_ShouldEnterWaitUserWithoutPersisting", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("交付完整 Knowledge Understanding", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);

	session.completeDeepKnowledge([], undefined, retrievalIdentity);
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-context-ambiguity",
		kind: "wiki",
		source: "wiki/spec",
		title: "Context Build 歧義規格",
		content: "需要使用者確認的 Context Build 邊界",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [{ statement: "Context Build 邊界仍有歧義", blocking: false }],
		knowledgeSummary: "已驗證的完整知識摘要",
	});

	const understandingResult = session.handleDeepResult(understandingIdentity, {
		kind: "completed",
		evidencePackage,
	});
	assert.equal(understandingResult.kind, "accepted");
	assert.equal(understandingResult.state.stage, "CONTEXT_BUILD");
	const storedPackage = session.getKnowledgeUnderstandingPackage();
	assert.ok(storedPackage);
	const contextIdentity = session.currentContextBuildAttempt();
	assert.ok(contextIdentity);

	const result = session.completeContextBuild(contextIdentity, {
		kind: "ambiguous",
		ambiguity: {
			decisionId: "context-scope",
			question: "產品範圍要採用哪一種定義？",
			options: ["最小範圍", "完整範圍"],
			recommendation: "最小範圍",
			evidenceIds: [evidence.evidenceId],
		},
	});

	assert.equal(result.kind, "ambiguous");
	assert.equal(result.state.stage, "WAIT_USER");
	assert.deepEqual(result.state.waitUser, {
		kind: "context_ambiguity",
		roundId: contextIdentity.sourceRoundId,
		decisionId: "context-scope",
		question: "產品範圍要採用哪一種定義？",
		options: ["最小範圍", "完整範圍"],
		recommendation: "最小範圍",
		evidenceIds: [evidence.evidenceId],
	});
	assert.equal(session.getContextCandidate(), undefined);
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), storedPackage);
});

test("ContextAmbiguity_WhenUserAnswers_ShouldResumeContextBuildWithNewAttempt", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("恢復 Context Build", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);

	session.completeDeepKnowledge([], undefined, retrievalIdentity);
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-context-resume",
		kind: "wiki",
		source: "wiki/spec",
		title: "Context Build 恢復規格",
		content: "需要使用者選擇後恢復 Context Build",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [{ statement: "Context Build 邊界仍有歧義", blocking: false }],
		knowledgeSummary: "已驗證的完整知識摘要",
	});

	const understandingResult = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });
	assert.equal(understandingResult.kind, "accepted");
	assert.equal(understandingResult.state.stage, "CONTEXT_BUILD");
	const storedPackage = session.getKnowledgeUnderstandingPackage();
	assert.ok(storedPackage);
	const oldIdentity = session.currentContextBuildAttempt();
	assert.ok(oldIdentity);
	const ambiguityResult = session.completeContextBuild(oldIdentity, {
		kind: "ambiguous",
		ambiguity: {
			decisionId: "context-resume-scope",
			question: "產品範圍要採用哪一種定義？",
			options: ["最小範圍", "完整範圍"],
			recommendation: "最小範圍",
			evidenceIds: [evidence.evidenceId],
		},
	});
	assert.equal(ambiguityResult.kind, "ambiguous");

	const resumedState = session.recordAnswer("完整範圍");
	assert.equal(resumedState.stage, "CONTEXT_BUILD");
	assert.equal(resumedState.waitUser, undefined);
	assert.deepEqual(session.getHumanDecisions(), [
		{
			decisionId: "context-resume-scope",
			statement: "問題：產品範圍要採用哪一種定義？；決定：完整範圍",
			evidenceIds: [evidence.evidenceId],
		},
	]);
	const newIdentity = session.currentContextBuildAttempt();
	assert.ok(newIdentity);
	assert.notEqual(newIdentity.attemptId, oldIdentity.attemptId);
	assert.equal(newIdentity.sourceRoundId, oldIdentity.sourceRoundId);
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), storedPackage);

	const staleResult = session.completeContextBuild(oldIdentity, {
		kind: "completed",
		candidate: {
			glossary: [
				{
					term: "產品範圍",
					definition: "使用者選擇的完整需求邊界。",
					evidenceIds: [evidence.evidenceId],
				},
			],
		},
	});
	assert.equal(staleResult.kind, "stale");
	assert.equal(session.current().stage, "CONTEXT_BUILD");
});

test("RequireAdrDecision_WhenMaterialAmbiguityExists_ShouldEnterWaitUserWithoutPersisting", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("交付 ADR Build 歧義決策", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-adr-ambiguity",
		kind: "wiki",
		source: "wiki/spec",
		title: "ADR Build 歧義規格",
		content: "需要使用者確認的 ADR 決策邊界",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "已驗證的完整知識摘要",
	});
	const understandingResult = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });
	assert.equal(understandingResult.kind, "accepted");
	assert.equal(understandingResult.state.stage, "CONTEXT_BUILD");
	const contextIdentity = session.currentContextBuildAttempt();
	assert.ok(contextIdentity);
	const contextCandidate = {
		glossary: [
			{
				term: "產品範圍",
				definition: "使用者確認的新產品需求邊界。",
				evidenceIds: [evidence.evidenceId],
			},
		],
	};
	const contextResult = session.completeContextBuild(contextIdentity, { kind: "completed", candidate: contextCandidate });
	assert.equal(contextResult.kind, "accepted");
	assert.equal(contextResult.state.stage, "ADR_BUILD");
	const adrIdentity = session.currentAdrBuildAttempt();
	assert.ok(adrIdentity);
	const storedPackage = session.getKnowledgeUnderstandingPackage();
	const storedContextCandidate = session.getContextCandidate();
	assert.ok(storedPackage);
	assert.ok(storedContextCandidate);

	const result = session.requireAdrDecision(adrIdentity, {
		decisionId: "adr-scope",
		question: "ADR 的產品範圍要採用哪一種定義？",
		options: ["最小範圍", "完整範圍"],
		recommendation: "最小範圍",
		evidenceIds: [evidence.evidenceId],
	});

	assert.equal(result.kind, "ambiguous");
	assert.equal(result.state.stage, "WAIT_USER");
	assert.deepEqual(result.state.waitUser, {
		kind: "adr_ambiguity",
		roundId: adrIdentity.sourceRoundId,
		decisionId: "adr-scope",
		question: "ADR 的產品範圍要採用哪一種定義？",
		options: ["最小範圍", "完整範圍"],
		recommendation: "最小範圍",
		evidenceIds: [evidence.evidenceId],
	});
	assert.equal(session.getAdrBuildCandidate(), undefined);
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), storedPackage);
	assert.strictEqual(session.getContextCandidate(), storedContextCandidate);
});

test("AdrAmbiguity_WhenUserAnswers_ShouldResumeAdrBuildWithNewAttempt", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("ADR Build 歧義回答後恢復", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);
	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-adr-resume",
		kind: "wiki",
		source: "wiki/spec",
		title: "ADR Build 恢復規格",
		content: "需要使用者選擇後恢復 ADR Build",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "已驗證的完整知識摘要",
	});
	const understandingResult = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });
	assert.equal(understandingResult.kind, "accepted");
	assert.equal(understandingResult.state.stage, "CONTEXT_BUILD");
	const contextIdentity = session.currentContextBuildAttempt();
	assert.ok(contextIdentity);
	const contextResult = session.completeContextBuild(contextIdentity, {
			kind: "completed",
			candidate: {
				glossary: [
					{
						term: "產品範圍",
						definition: "使用者確認的新產品需求邊界。",
						evidenceIds: [evidence.evidenceId],
					},
				],
			},
		});
	assert.equal(contextResult.kind, "accepted");
	assert.equal(contextResult.state.stage, "ADR_BUILD");
	const oldIdentity = session.currentAdrBuildAttempt();
	assert.ok(oldIdentity);
	const storedPackage = session.getKnowledgeUnderstandingPackage();
	const storedContextCandidate = session.getContextCandidate();
	assert.ok(storedPackage);
	assert.ok(storedContextCandidate);

	const ambiguityResult = session.requireAdrDecision(oldIdentity, {
		decisionId: "adr-resume-scope",
		question: "ADR 的產品範圍要採用哪一種定義？",
		options: ["最小範圍", "完整範圍"],
		recommendation: "最小範圍",
		evidenceIds: [evidence.evidenceId],
	});
	assert.equal(ambiguityResult.kind, "ambiguous");

	const resumedState = session.recordAnswer("完整範圍");
	assert.equal(resumedState.stage, "ADR_BUILD");
	assert.equal(resumedState.waitUser, undefined);
	assert.deepEqual(session.getHumanDecisions(), [
		{
			decisionId: "adr-resume-scope",
			statement: "問題：ADR 的產品範圍要採用哪一種定義？；決定：完整範圍",
			evidenceIds: [evidence.evidenceId],
		},
	]);
	const newIdentity = session.currentAdrBuildAttempt();
	assert.ok(newIdentity);
	assert.notEqual(newIdentity.attemptId, oldIdentity.attemptId);
	assert.equal(newIdentity.sourceRoundId, oldIdentity.sourceRoundId);
	const staleResult = session.prepareAdrBuild(oldIdentity, {
		records: [],
		handoff: {
			summary: "",
			nextSessionFocus: "",
			references: [],
			suggestedSkills: [],
		},
	});
	assert.equal(staleResult.kind, "stale");
	assert.equal(session.getAdrBuildCandidate(), undefined);
	assert.strictEqual(session.getContextCandidate(), storedContextCandidate);
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), storedPackage);
});

test("SessionState_WhenKnowledgeUnderstandingPackageIsInvalid_ShouldRemainInUnderstandingWithoutPartialSave", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("拒絕無效 Knowledge Understanding", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);

	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidence = {
		evidenceId: "ev-invalid-knowledge-summary",
		kind: "wiki",
		source: "wiki/spec",
		title: "無效摘要測試",
		content: "已驗證的規格內容",
		metadata: {},
	};
	const evidencePackage = createEvidencePackage({
		inherited: [evidence],
		supplemental: [],
		decisions: [
			{
				decisionId: "decision-invalid-knowledge-summary",
				statement: "採用已驗證的規格",
				evidenceIds: [evidence.evidenceId],
			},
		],
		findings: [
			{
				statement: "已確認規格可供 Context Build 使用",
				evidenceIds: [evidence.evidenceId],
			},
		],
		limitations: [{ statement: "尚未接上自動續跑 Context Build", blocking: false }],
		knowledgeSummary: "   ",
	});
	const stateBefore = session.current();
	const identityBefore = session.currentDeepAttempt();

	const result = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });

	assert.equal(result.kind, "invalid");
	assert.ok(result.errors.includes("knowledgeSummary 不可為空白"));
	assert.deepEqual(session.current(), stateBefore);
	assert.strictEqual(session.currentDeepAttempt(), identityBefore);
	assert.equal(session.getKnowledgeUnderstandingPackage(), undefined);
	assert.equal(session.current().stage, "KNOWLEDGE_UNDERSTANDING");
});

test("SessionState_WhenResetStartsNewWorkflow_ShouldClearKnowledgeUnderstandingPackage", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("重設 Knowledge Understanding 工作流程", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);

	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidencePackage = createEvidencePackage({
		inherited: [],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "已完成且可供 Context Build 使用的知識摘要",
	});
	const result = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });

	assert.equal(result.kind, "accepted");
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), evidencePackage);

	const resetState = session.reset();

	assert.equal(resetState.stage, "RECEIVE");
	assert.equal(session.getKnowledgeUnderstandingPackage(), undefined);
});

test("SessionState_WhenDeepKnowledgeIsCancelled_ShouldClearKnowledgeUnderstandingPackage", () => {
	const session = createForgeSessionState();
	const snapshot = Object.freeze({ candidates: {}, manifest: [] });
	session.startGrillRound("取消 Knowledge Understanding 工作流程", snapshot);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);

	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidencePackage = createEvidencePackage({
		inherited: [],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "已完成且可供 Context Build 使用的知識摘要",
	});
	const result = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });

	assert.equal(result.kind, "accepted");
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), evidencePackage);

	session.cancelDeepKnowledge();

	assert.equal(session.getKnowledgeUnderstandingPackage(), undefined);
});

test("SessionState_WhenNewEvidenceSnapshotStarts_ShouldClearKnowledgeUnderstandingPackage", () => {
	const session = createForgeSessionState();
	const snapshotA = Object.freeze({ candidates: {}, manifest: [] });
	const snapshotB = Object.freeze({
		candidates: Object.freeze({
			"ev-candidate-b": Object.freeze({
				candidateId: "ev-candidate-b" as const,
				kind: "wiki" as const,
				source: "wiki/spec-b",
				title: "snapshot B 規格",
				content: "snapshot B 的候選證據",
				metadata: Object.freeze({}),
			}),
		}),
		manifest: Object.freeze([
			{
				candidateId: "ev-candidate-b" as const,
				kind: "wiki" as const,
				source: "wiki/spec-b",
				title: "snapshot B 規格",
			},
		]),
	});
	session.startGrillRound("完成 snapshot A 的 Knowledge Understanding", snapshotA);
	session.beginDeepKnowledge();
	const retrievalIdentity = session.currentDeepAttempt();
	assert.ok(retrievalIdentity);
	session.completeDeepKnowledge([], undefined, retrievalIdentity);

	const understandingIdentity = session.currentDeepAttempt();
	assert.ok(understandingIdentity);
	const evidencePackage = createEvidencePackage({
		inherited: [],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "snapshot A 的完整知識摘要",
	});
	const result = session.handleDeepResult(understandingIdentity, { kind: "completed", evidencePackage });

	assert.equal(result.kind, "accepted");
	assert.strictEqual(session.getKnowledgeUnderstandingPackage(), evidencePackage);

	session.startGrillRound("開始不同的 snapshot B", snapshotB);

	assert.equal(session.getKnowledgeUnderstandingPackage(), undefined);
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
				options: ["確認", "取消"],
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
	assert.deepEqual(thirdResult.state.waitUser?.options, ["確認", "取消"]);
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

test("GrillRoundBudget_WhenAcceptedAnswersReachEight_ShouldRequireCheckpoint", () => {
	const state = createForgeSessionState();
	const snapshot = { candidates: {}, manifest: [] };
	const round = state.startGrillRound("需要測試 Forge runtime", snapshot);

	for (let answerNumber = 1; answerNumber <= 8; answerNumber += 1) {
		state.requireGrillResult({
			kind: "grill_confirmation",
			roundId: round.roundId,
			decisionId: `decision-${answerNumber}`,
			evidenceIds: [],
			options: ["確認"],
			question: `第 ${answerNumber} 題`,
			recommendation: "確認",
		});
		state.recordAnswer("確認");
	}

	assert.equal(state.getHumanDecisions().length, 8);
	assert.equal(state.getHumanDecisions()[7]?.decisionId, "decision-8");
	assert.equal(state.current().stage, "WAIT_USER");
	assert.equal(state.current().waitUser?.kind, "grill_checkpoint");
	assert.equal(state.current().waitUser?.roundId, round.roundId);
});

test("GrillRoundBudget_WhenAcceptedAnswersAreBelowEight_ShouldAllowNextRound", () => {
	const state = createForgeSessionState();
	const snapshot = { candidates: {}, manifest: [] };
	const firstRound = state.startGrillRound("需要測試少於八次回答", snapshot);

	for (let answerNumber = 1; answerNumber <= 7; answerNumber += 1) {
		state.requireGrillResult({
			kind: "grill_confirmation",
			roundId: firstRound.roundId,
			decisionId: `decision-${answerNumber}`,
			evidenceIds: [],
			options: ["確認"],
			question: `第 ${answerNumber} 題`,
			recommendation: "確認",
		});
		state.recordAnswer("確認");
	}

	const nextRound = state.startGrillRound("少於八次回答後開始下一輪", snapshot);

	assert.notEqual(nextRound.roundId, firstRound.roundId);
	assert.equal(nextRound.request, "少於八次回答後開始下一輪");
	assert.equal(state.current().waitUser, undefined);
	assert.notEqual(state.current().waitUser?.kind, "grill_checkpoint");
});

test("GrillRoundBudget_WhenCompletionIsRejectedOrRetried_ShouldNotConsumeBudget", () => {
	const snapshot = { candidates: {}, manifest: [] };

	const rejected = createForgeSessionState();
	const rejectedRound = rejected.startGrillRound("拒絕完成後仍需完整回答", snapshot);
	rejected.requireGrillResult({
		kind: "grill_confirmation",
		roundId: rejectedRound.roundId,
		decisionId: "rejected-completion",
		evidenceIds: [],
		options: ["確認"],
		question: "是否完成？",
		recommendation: "確認",
	});
	rejected.reject("重新評估");
	assert.equal(rejected.current().stage, "GRILL");
	const rejectedRetry = rejected.continueGrillRound();

	for (let answerNumber = 1; answerNumber <= 7; answerNumber += 1) {
		rejected.requireGrillResult({
			kind: "grill_confirmation",
			roundId: rejectedRetry.roundId,
			decisionId: `rejected-retry-${answerNumber}`,
			evidenceIds: [],
			options: ["確認"],
			question: `拒絕後第 ${answerNumber} 題`,
			recommendation: "確認",
		});
		rejected.recordAnswer("確認");
	}
	assert.equal(rejected.current().stage, "GRILL");
	rejected.requireGrillResult({
		kind: "grill_confirmation",
		roundId: rejectedRetry.roundId,
		decisionId: "rejected-retry-8",
		evidenceIds: [],
		options: ["確認"],
		question: "拒絕後第 8 題",
		recommendation: "確認",
	});
	rejected.recordAnswer("確認");
	assert.equal(rejected.getHumanDecisions().length, 8);
	assert.equal(rejected.current().waitUser?.kind, "grill_checkpoint");

	const retried = createForgeSessionState();
	const retriedRound = retried.startGrillRound("重試完成後仍需完整回答", snapshot);
	retried.recordCompletionOmission();
	const retryRound = retried.retryGrillRound();
	assert.ok(retryRound);

	for (let answerNumber = 1; answerNumber <= 7; answerNumber += 1) {
		retried.requireGrillResult({
			kind: "grill_confirmation",
			roundId: retriedRound.roundId,
			decisionId: `completion-retry-${answerNumber}`,
			evidenceIds: [],
			options: ["確認"],
			question: `重試後第 ${answerNumber} 題`,
			recommendation: "確認",
		});
		retried.recordAnswer("確認");
	}
	assert.equal(retried.current().stage, "GRILL");
	retried.requireGrillResult({
		kind: "grill_confirmation",
		roundId: retriedRound.roundId,
		decisionId: "completion-retry-8",
		evidenceIds: [],
		options: ["確認"],
		question: "重試後第 8 題",
		recommendation: "確認",
	});
	retried.recordAnswer("確認");
	assert.equal(retried.getHumanDecisions().length, 8);
	assert.equal(retried.current().waitUser?.kind, "grill_checkpoint");
});

test("GrillCheckpoint_WhenAnswerIsStaleOrDuplicated_ShouldRemainWaiting", () => {
	const state = createForgeSessionState();
	const snapshot = { candidates: {}, manifest: [] };
	const round = state.startGrillRound("驗證 checkpoint 的過期回答", snapshot);

	for (let answerNumber = 1; answerNumber <= 8; answerNumber += 1) {
		state.requireGrillResult({
			kind: "grill_confirmation",
			roundId: round.roundId,
			decisionId: `checkpoint-decision-${answerNumber}`,
			evidenceIds: [],
			options: ["確認"],
			question: `第 ${answerNumber} 題`,
			recommendation: "確認",
		});
		state.recordAnswer("確認");
	}

	const beforeStaleAnswer = structuredClone(state.current());
	const staleAnswerState = state.recordAnswer("確認");

	assert.deepEqual(staleAnswerState, beforeStaleAnswer);
	assert.deepEqual(state.current(), beforeStaleAnswer);
	assert.equal(state.current().stage, "WAIT_USER");
	assert.equal(state.current().waitUser?.kind, "grill_checkpoint");
	assert.equal(state.current().waitUser?.roundId, round.roundId);
	assert.equal(state.getHumanDecisions().length, 8);
	assert.equal(state.continueGrillRound().roundId, round.roundId);
});
