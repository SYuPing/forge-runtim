import assert from "node:assert/strict";
import test from "node:test";
import { createEvidencePackage } from "../../src/evidence/evidence-engine.ts";
import { buildContextBuildSkillInvocation } from "../../src/knowledge/context-build-skill.ts";
import type { ContextCandidate } from "../../src/knowledge/context-builder.ts";

test("BuildContextSkillInvocation_WhenPackageIsValid_ShouldExposeOnlyStructuredFactsAndIdentity", () => {
	const evidenceId = "human-premise-context-77";
	const knowledgePackage = createEvidencePackage({
		inherited: [],
		supplemental: [],
		humanPremise: [
			{
				evidenceId,
				kind: "human_premise",
				source: "forge://human-premise",
				title: "使用者前提",
				content: "RAW_EVIDENCE_MUST_NOT_APPEAR",
				metadata: { roundId: "grill-12", decisionId: "decision-context-77" },
			},
		],
		decisions: [
			{
				decisionId: "decision-context-77",
				statement: "Context 只整理產品領域語言。",
				evidenceIds: [evidenceId],
			},
		],
		findings: [{ statement: "目前只有使用者前提可供 Context 建模。", evidenceIds: [evidenceId] }],
		limitations: [{ statement: "尚無外部事實證據。", blocking: false }],
		knowledgeSummary: "SUMMARY_MUST_NOT_APPEAR",
	});

	const invocation = buildContextBuildSkillInvocation({
		stage: "CONTEXT_BUILD",
		identity: { attemptId: "context-77", sourceRoundId: "grill-12" },
		knowledgePackage,
	});
	const exposed = JSON.stringify(invocation);

	assert.match(exposed, /context-build/);
	assert.match(exposed, /forge_context_complete/);
	assert.match(exposed, /context-77/);
	assert.match(exposed, /grill-12/);
	assert.match(exposed, new RegExp(evidenceId));
	assert.match(exposed, /decision-context-77/);
	assert.match(exposed, /目前只有使用者前提可供 Context 建模/);
	assert.match(exposed, /尚無外部事實證據/);
	assert.match(exposed, /human_premise/);
	assert.doesNotMatch(exposed, /RAW_EVIDENCE_MUST_NOT_APPEAR/);
	assert.doesNotMatch(exposed, /SUMMARY_MUST_NOT_APPEAR/);
});

test("BuildAdrSkillInvocation_WhenContextCandidateIsValid_ShouldExposeAdrToolAndIdentity", () => {
	const evidenceId = "human-premise-adr-8";
	const knowledgePackage = createEvidencePackage({
		inherited: [],
		supplemental: [],
		humanPremise: [
			{
				evidenceId,
				kind: "human_premise",
				source: "forge://human-premise",
				title: "使用者前提",
				content: "RAW_ADR_EVIDENCE_MUST_NOT_APPEAR",
				metadata: { roundId: "grill-12", decisionId: "decision-adr-8" },
			},
		],
		decisions: [
			{
				decisionId: "decision-adr-8",
				statement: "採用以領域語言整理 ADR。",
				evidenceIds: [evidenceId],
			},
		],
		findings: [{ statement: "Context candidate 已建立。", evidenceIds: [evidenceId] }],
		limitations: [],
		knowledgeSummary: "SUMMARY_ADR_MUST_NOT_APPEAR",
	});
	const contextCandidate: ContextCandidate = {
		glossary: [{ term: "領域語言", definition: "產品中共同使用的核心術語。", evidenceIds: [evidenceId] }],
	};

	const invocation = buildContextBuildSkillInvocation({
		stage: "ADR_BUILD",
		identity: { attemptId: "adr-8", sourceRoundId: "grill-12" },
		knowledgePackage,
		contextCandidate,
	});
	const exposed = JSON.stringify(invocation);

	assert.match(exposed, /context-build/);
	assert.match(exposed, /forge_adr_complete/);
	assert.match(exposed, /ADR_BUILD/);
	assert.match(exposed, /adr-8/);
	assert.match(exposed, /grill-12/);
	assert.match(exposed, /領域語言/);
	assert.match(exposed, /產品中共同使用的核心術語/);
	assert.match(exposed, new RegExp(evidenceId));
	assert.match(exposed, /採用以領域語言整理 ADR/);
	assert.doesNotMatch(exposed, /完成工具：forge_context_complete/);
	assert.doesNotMatch(exposed, /RAW_ADR_EVIDENCE_MUST_NOT_APPEAR/);
	assert.doesNotMatch(exposed, /SUMMARY_ADR_MUST_NOT_APPEAR/);
});
