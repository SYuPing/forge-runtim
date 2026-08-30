import assert from "node:assert/strict";
import test from "node:test";

import {
	createEvidencePackage,
	validateEvidencePackage,
} from "../../src/evidence/evidence-engine.ts";

test("EvidencePackage_WhenInheritedAndSupplementalEvidenceMerge_ShouldPreserveOrigins", () => {
	const result = createEvidencePackage({
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
		decisions: [],
		findings: [],
		limitations: [],
	});
});

test("EvidencePackage_WhenHumanPremiseInputIsIncluded_ShouldAssignHumanPremiseOrigin", () => {
	const result = createEvidencePackage({
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
		decisions: [],
		findings: [],
		limitations: [],
	});
});

test("EvidencePackage_WhenEvidenceIdDuplicates_ShouldReject", () => {
	const result = createEvidencePackage({
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
		decisions: [],
		findings: [{ statement: "未標示推論前綴的實作結論", evidenceIds: ["ev-human-premise-1"] }],
		limitations: [],
	} as unknown as Parameters<typeof validateEvidencePackage>[0];

	const validation = validateEvidencePackage(result);

	assert.equal(validation.ok, false);
});

test("EvidencePackage_WhenFindingHasNoEvidence_ShouldReject", () => {
	const result = createEvidencePackage({
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
