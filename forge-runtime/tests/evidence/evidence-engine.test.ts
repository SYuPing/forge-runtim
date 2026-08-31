import assert from "node:assert/strict";
import test from "node:test";

import {
	createEvidencePackage,
	validateEvidencePackage,
} from "../../src/evidence/evidence-engine.ts";

test("EvidencePackage_WhenInheritedAndSupplementalEvidenceMerge_ShouldPreserveOrigins", () => {
	const result = createEvidencePackage({
		knowledgeSummary: "繼承與補充證據均已保留來源",
		inherited: [
			{
				evidenceId: "ev-inherited-1",
				kind: "wiki",
				source: "https://example.com/inherited",
				title: "Inherited evidence",
				content: "Inherited content",
				metadata: { sourceRoundId: "round-1" },
			},
		],
		supplemental: [
			{
				evidenceId: "ev-supplemental-1",
				kind: "code_base",
				source: "src/example.ts",
				title: "Supplemental evidence",
				content: "Supplemental content",
				metadata: { sourceRoundId: "round-1" },
			},
		],
		decisions: [],
		findings: [],
		limitations: [],
	});

	assert.deepEqual(result, {
		knowledgeSummary: "繼承與補充證據均已保留來源",
		evidence: [
			{
				evidenceId: "ev-inherited-1",
				kind: "wiki",
				source: "https://example.com/inherited",
				title: "Inherited evidence",
				content: "Inherited content",
				metadata: { sourceRoundId: "round-1" },
				origin: "grill",
			},
			{
				evidenceId: "ev-supplemental-1",
				kind: "code_base",
				source: "src/example.ts",
				title: "Supplemental evidence",
				content: "Supplemental content",
				metadata: { sourceRoundId: "round-1" },
				origin: "deep_retrieval",
			},
		],
		evidenceIds: ["ev-inherited-1", "ev-supplemental-1"],
		decisions: [],
		findings: [],
		limitations: [],
	});
});

test("EvidencePackage_WhenKnowledgeSummaryIsProvided_ShouldPreserveSummaryAndDeriveEvidenceIdsInOrder", () => {
	const result = createEvidencePackage({
		knowledgeSummary: "已驗證的知識摘要",
		inherited: [
			{
				evidenceId: "ev-inherited-1",
				kind: "wiki",
				source: "https://example.com/inherited",
				title: "Inherited evidence",
				content: "Inherited content",
				metadata: { sourceRoundId: "round-1" },
			},
		],
		supplemental: [
			{
				evidenceId: "ev-supplemental-1",
				kind: "code_base",
				source: "src/example.ts",
				title: "Supplemental evidence",
				content: "Supplemental content",
				metadata: { sourceRoundId: "round-1" },
			},
		],
		decisions: [],
		findings: [],
		limitations: [],
	});

	assert.equal(result.knowledgeSummary, "已驗證的知識摘要");
	assert.deepEqual(result.evidenceIds, ["ev-inherited-1", "ev-supplemental-1"]);
});

test("EvidencePackage_WhenKnowledgeSummaryIsBlank_ShouldReject", () => {
	const result = createEvidencePackage({
		knowledgeSummary: "   ",
		inherited: [
			{
				evidenceId: "ev-valid-1",
				kind: "wiki",
				source: "https://example.com/valid",
				title: "Valid evidence",
				content: "Valid content",
				metadata: { sourceRoundId: "round-1" },
			},
		],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
	});

	const validation = validateEvidencePackage(result);

	assert.deepEqual(validation, { ok: false, errors: ["knowledgeSummary 不可為空白"] });
});

test("EvidencePackage_WhenKnowledgeSummaryCrosses4000CodePointBoundary_ShouldEnforceLimit", () => {
	const packageWithSummary = (knowledgeSummary: string) => createEvidencePackage({
		knowledgeSummary,
		inherited: [
			{
				evidenceId: "ev-valid-1",
				kind: "wiki",
				source: "https://example.com/valid",
				title: "Valid evidence",
				content: "Valid content",
				metadata: { sourceRoundId: "round-1" },
			},
		],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
	});

	assert.equal(validateEvidencePackage(packageWithSummary("😀".repeat(4000))).ok, true);
	assert.deepEqual(validateEvidencePackage(packageWithSummary("😀".repeat(4001))), {
		ok: false,
		errors: ["knowledgeSummary 內容超過 4000 個 Unicode 字元"],
	});
});

test("EvidencePackage_WhenCreated_ShouldOwnFrozenCopiesOfKnowledgeData", () => {
	const inheritedEvidence = {
		evidenceId: "ev-inherited-1",
		kind: "wiki",
		source: "https://example.com/inherited",
		title: "Inherited evidence",
		content: "Inherited content",
		metadata: {
			sourceRoundId: "round-1",
			nested: { label: "原始" },
			tags: ["原始標籤"],
		} as Record<string, unknown>,
	};
	const inherited = [inheritedEvidence];
	const supplemental: NonNullable<Parameters<typeof createEvidencePackage>[0]["supplemental"]> = [];
	const decisions = [{ decisionId: "decision-1", statement: "原始決策", evidenceIds: ["ev-inherited-1"] }];
	const findings = [{ statement: "原始發現", evidenceIds: ["ev-inherited-1"] }];
	const limitations = [{ statement: "原始限制", blocking: false }];

	const result = createEvidencePackage({
		knowledgeSummary: "測試知識摘要",
		inherited,
		supplemental,
		decisions,
		findings,
		limitations,
	});

	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.evidence), true);
	assert.equal(Object.isFrozen(result.evidenceIds), true);
	assert.equal(Object.isFrozen(result.decisions), true);
	assert.equal(Object.isFrozen(result.findings), true);
	assert.equal(Object.isFrozen(result.limitations), true);
	assert.equal(Object.isFrozen(result.evidence[0]), true);
	assert.equal(Object.isFrozen(result.decisions[0]), true);
	assert.equal(Object.isFrozen(result.findings[0]), true);
	assert.equal(Object.isFrozen(result.decisions[0].evidenceIds), true);
	assert.equal(Object.isFrozen(result.findings[0].evidenceIds), true);
	assert.equal(Object.isFrozen(result.evidence[0].metadata), true);
	assert.equal(Object.isFrozen((result.evidence[0].metadata.nested as { label: string })), true);
	assert.equal(Object.isFrozen((result.evidence[0].metadata.tags as string[])), true);

	inherited.push({ ...inheritedEvidence, evidenceId: "ev-inherited-2" });
	inheritedEvidence.content = "被修改的內容";
	inheritedEvidence.metadata.sourceRoundId = "被修改的 round";
	(inheritedEvidence.metadata.nested as { label: string }).label = "被修改的巢狀內容";
	(inheritedEvidence.metadata.tags as string[]).push("被追加的標籤");
	decisions.push({ decisionId: "decision-2", statement: "被追加的決策", evidenceIds: [] });
	decisions[0].statement = "被修改的決策";
	decisions[0].evidenceIds.push("ev-inherited-2");
	findings.push({ statement: "被追加的發現", evidenceIds: [] });
	findings[0].statement = "被修改的發現";
	findings[0].evidenceIds.push("ev-inherited-2");
	limitations.push({ statement: "被追加的限制", blocking: true });

	assert.equal(result.evidence.length, 1);
	assert.equal(result.evidence[0].content, "Inherited content");
	assert.equal(result.evidence[0].metadata.sourceRoundId, "round-1");
	assert.equal((result.evidence[0].metadata.nested as { label: string }).label, "原始");
	assert.deepEqual(result.evidence[0].metadata.tags, ["原始標籤"]);
	assert.deepEqual(result.evidenceIds, ["ev-inherited-1"]);
	assert.deepEqual(result.decisions, [{ decisionId: "decision-1", statement: "原始決策", evidenceIds: ["ev-inherited-1"] }]);
	assert.deepEqual(result.findings, [{ statement: "原始發現", evidenceIds: ["ev-inherited-1"] }]);
	assert.deepEqual(result.limitations, [{ statement: "原始限制", blocking: false }]);
});

test("EvidencePackage_WhenDerivedEvidenceIdsAreTampered_ShouldReject", () => {
	const result = createEvidencePackage({
		knowledgeSummary: "測試知識摘要",
		inherited: [
			{
				evidenceId: "ev-valid-1",
				kind: "wiki",
				source: "https://example.com/valid",
				title: "Valid evidence",
				content: "Valid content",
				metadata: { sourceRoundId: "round-1" },
			},
		],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
	});
	const forged = { ...result, evidenceIds: ["ev-forged"] };

	const validation = validateEvidencePackage(forged);

	assert.deepEqual(validation, { ok: false, errors: ["evidenceIds 必須由 evidence 衍生且順序一致"] });
});

test("EvidencePackage_WhenHumanPremiseInputIsIncluded_ShouldAssignHumanPremiseOrigin", () => {
	const result = createEvidencePackage({
		knowledgeSummary: "人類前提證據已正確標記來源",
		inherited: [],
		supplemental: [],
		humanPremise: [
			{
				evidenceId: "ev-human-premise-1",
				kind: "human_premise",
				source: "forge://human-premise",
				title: "Human premise",
				content: "goal=G\nquestion=Q\nanswer=確認",
				metadata: { needsDiscoveryCount: 2, sourceRoundIds: ["round-1", "round-2"] },
			},
		],
		decisions: [],
		findings: [],
		limitations: [],
	});

	assert.deepEqual(result, {
		knowledgeSummary: "人類前提證據已正確標記來源",
		evidence: [
			{
				evidenceId: "ev-human-premise-1",
				kind: "human_premise",
				source: "forge://human-premise",
				title: "Human premise",
				content: "goal=G\nquestion=Q\nanswer=確認",
				metadata: { needsDiscoveryCount: 2, sourceRoundIds: ["round-1", "round-2"] },
				origin: "human_premise",
			},
		],
		evidenceIds: ["ev-human-premise-1"],
		decisions: [],
		findings: [],
		limitations: [],
	});
});

test("EvidencePackage_WhenEvidenceIdDuplicates_ShouldReject", () => {
	const result = createEvidencePackage({
		knowledgeSummary: "測試知識摘要",
		inherited: [
			{
				evidenceId: "ev-duplicate-1",
				kind: "wiki",
				source: "https://example.com/inherited",
				title: "Inherited evidence",
				content: "Inherited content",
				metadata: { sourceRoundId: "round-1" },
			},
		],
		supplemental: [
			{
				evidenceId: "ev-duplicate-1",
				kind: "code_base",
				source: "src/example.ts",
				title: "Supplemental evidence",
				content: "Supplemental content",
				metadata: { sourceRoundId: "round-1" },
			},
		],
		decisions: [],
		findings: [],
		limitations: [],
	});

	const validation = validateEvidencePackage(result);

	assert.equal(validation.ok, false);
});

test("EvidencePackage_WhenFindingReferencesUnknownEvidence_ShouldReject", () => {
	const result = createEvidencePackage({
		knowledgeSummary: "測試知識摘要",
		inherited: [
			{
				evidenceId: "ev-known-1",
				kind: "wiki",
				source: "https://example.com/known",
				title: "Known evidence",
				content: "Known content",
				metadata: { sourceRoundId: "round-1" },
			},
		],
		supplemental: [],
		decisions: [],
		findings: [{ statement: "Finding", evidenceIds: ["ev-unknown-1"] }],
		limitations: [],
	});

	const validation = validateEvidencePackage(result);

	assert.equal(validation.ok, false);
});

test("EvidencePackage_WhenFindingReferencesOnlyHumanPremiseWithoutInferencePrefix_ShouldReject", () => {
	const result = {
		knowledgeSummary: "測試知識摘要",
		evidence: [
			{
				evidenceId: "ev-human-premise-1",
				kind: "human_premise",
				source: "user",
				title: "Human premise",
				content: "User-provided premise",
				metadata: {},
				origin: "human_premise",
			},
		],
		evidenceIds: ["ev-human-premise-1"],
		decisions: [],
		findings: [{ statement: "未標示推論前綴的實作結論", evidenceIds: ["ev-human-premise-1"] }],
		limitations: [],
	} as unknown as Parameters<typeof validateEvidencePackage>[0];

	const validation = validateEvidencePackage(result);

	assert.equal(validation.ok, false);
});

test("EvidencePackage_WhenFindingHasNoEvidence_ShouldReject", () => {
	const result = createEvidencePackage({
		knowledgeSummary: "測試知識摘要",
		inherited: [],
		supplemental: [],
		decisions: [],
		findings: [{ statement: "Unsupported finding", evidenceIds: [] }],
		limitations: [],
	});

	const validation = validateEvidencePackage(result);

	assert.equal(validation.ok, false);
});

test("EvidencePackage_WhenDecisionReferencesUnknownEvidence_ShouldReject", () => {
	const result = createEvidencePackage({
		knowledgeSummary: "測試知識摘要",
		inherited: [],
		supplemental: [],
		decisions: [{ decisionId: "decision-1", statement: "Decision", evidenceIds: ["ev-unknown-1"] }],
		findings: [],
		limitations: [],
	});

	const validation = validateEvidencePackage(result);

	assert.equal(validation.ok, false);
});

test("EvidencePackage_WhenDecisionIdDuplicates_ShouldRejectModelOverride", () => {
	const result = createEvidencePackage({
		knowledgeSummary: "測試知識摘要",
		inherited: [
			{
				evidenceId: "ev-decision-1",
				kind: "wiki",
				source: "https://example.com/decision",
				title: "Decision evidence",
				content: "Decision content",
				metadata: { sourceRoundId: "round-1" },
			},
		],
		supplemental: [],
		decisions: [
			{ decisionId: "decision-1", statement: "問題：採用方案 A；決定：採用方案 A（人類決定）", evidenceIds: ["ev-decision-1"] },
			{ decisionId: "decision-1", statement: "問題：採用方案 A；決定：採用方案 B（模型提交）", evidenceIds: ["ev-decision-1"] },
		],
		findings: [],
		limitations: [],
	});

	const validation = validateEvidencePackage(result);

	assert.equal(validation.ok, false);
});

test("EvidencePackage_WhenBlockingGapExists_ShouldRejectCompleted", () => {
	const result = createEvidencePackage({
		knowledgeSummary: "測試知識摘要",
		inherited: [
			{
				evidenceId: "ev-valid-1",
				kind: "wiki",
				source: "https://example.com/valid",
				title: "Valid evidence",
				content: "Valid content",
				metadata: { sourceRoundId: "round-1" },
			},
		],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [{ statement: "Blocking evidence gap", blocking: true }],
	});

	const validation = validateEvidencePackage(result);

	assert.equal(validation.ok, false);
});

function evidencePackageWithCounts(counts: { decisions?: number; findings?: number; limitations?: number }, statement: string) {
	const evidence = {
		evidenceId: "ev-limit-1",
		kind: "wiki",
		source: "https://example.com/limit",
		title: "Limit evidence",
		content: "Limit content",
		metadata: {},
	};
	return createEvidencePackage({
		knowledgeSummary: "測試知識摘要",
		inherited: [evidence],
		supplemental: [],
		decisions: Array.from({ length: counts.decisions ?? 0 }, (_, index) => ({
			decisionId: `decision-limit-${index}`,
			statement,
			evidenceIds: [evidence.evidenceId],
		})),
		findings: Array.from({ length: counts.findings ?? 0 }, () => ({
			statement,
			evidenceIds: [evidence.evidenceId],
		})),
		limitations: Array.from({ length: counts.limitations ?? 0 }, () => ({ statement, blocking: false })),
	});
}

test("EvidencePackage_WhenDecisionFindingLimitationCountAtMost50_ShouldAccept", () => {
	for (const kind of ["decisions", "findings", "limitations"] as const) {
		const validation = validateEvidencePackage(evidencePackageWithCounts({ [kind]: 50 }, "合法內容"));
		assert.equal(validation.ok, true, `${kind}=50 應被接受`);
	}
});

test("EvidencePackage_WhenDecisionFindingLimitationCountExceeds50_ShouldReject", () => {
	for (const kind of ["decisions", "findings", "limitations"] as const) {
		const validation = validateEvidencePackage(evidencePackageWithCounts({ [kind]: 51 }, "超過筆數"));
		assert.equal(validation.ok, false, `${kind}=51 應被拒絕`);
	}
});

test("EvidencePackage_WhenStatementsAre4000CodePoints_ShouldAccept", () => {
	const statement = "😀".repeat(4000);
	assert.equal(Array.from(statement).length, 4000);
	assert.equal(validateEvidencePackage(evidencePackageWithCounts({ decisions: 1, findings: 1, limitations: 1 }, statement)).ok, true);
});

test("EvidencePackage_WhenAnyStatementIs4001CodePoints_ShouldReject", () => {
	const statement = "😀".repeat(4001);
	assert.equal(Array.from(statement).length, 4001);
	for (const kind of ["decisions", "findings", "limitations"] as const) {
		const validation = validateEvidencePackage(evidencePackageWithCounts({ [kind]: 1 }, statement));
		assert.equal(validation.ok, false, `${kind} statement=4001 應被拒絕`);
	}
});
