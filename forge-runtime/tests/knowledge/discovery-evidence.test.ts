import assert from "node:assert/strict";
import test from "node:test";

test("Discovery_WhenModeIsLight_ShouldReturnSummaryOnly", async () => {
	const { discoverEvidence } = await import("../../src/knowledge/discovery-engine.ts");
	const results = await discoverEvidence({
		mode: "light",
		documents: [
			{
				title: "Forge Runtime 架構",
				summary: "描述 discovery engine 的摘要輸出需求",
				content: "這裡是完整原文，light mode 不應直接暴露這段內容。",
				source: "docs://forge-runtime/architecture",
			},
		],
	});

	assert.equal(Array.isArray(results), true);
	assert.equal(results.length, 1);

	const [evidence] = results;

	assert.equal(evidence.title, "Forge Runtime 架構");
	assert.equal(evidence.summary, "描述 discovery engine 的摘要輸出需求");
	assert.equal(evidence.source, "docs://forge-runtime/architecture");
	assert.equal(typeof evidence.evidenceId, "string");
	assert.equal("content" in evidence, false);
	assert.deepEqual(Object.keys(evidence).sort(), ["evidenceId", "source", "summary", "title"]);
});

test("Evidence_WhenBuildingContext_ShouldPreserveCitation", async () => {
	const { buildContextItems } = await import("../../src/knowledge/context-builder.ts");
	const { createEvidencePackage } = await import("../../src/evidence/evidence-engine.ts");
	const knowledgeUnderstanding = createEvidencePackage({
		inherited: [],
		supplemental: [],
		decisions: [],
		findings: [],
		limitations: [],
		knowledgeSummary: "描述 discovery engine 的摘要輸出需求",
	});
	const result = await buildContextItems({
		evidence: [
		{
			evidenceId: "EV-0001",
			source: "docs://forge-runtime/architecture",
			summary: "描述 discovery engine 的摘要輸出需求",
			title: "Forge Runtime 架構",
		},
	],
		knowledgeUnderstanding,
	});
	const contextItems = result.items;

	assert.equal(Array.isArray(contextItems), true);
	assert.equal(contextItems.length, 1);

	const [contextItem] = contextItems;

	assert.equal(contextItem.evidenceId, "EV-0001");
	assert.equal(contextItem.source, "docs://forge-runtime/architecture");
});

test("ContextBuilder_WhenKnowledgeUnderstandingProvided_ShouldReturnItemsAndSamePackage", async () => {
	const { buildContextItems } = await import("../../src/knowledge/context-builder.ts");
	const { createEvidencePackage } = await import("../../src/evidence/evidence-engine.ts");
	const knowledgeUnderstanding = createEvidencePackage({
		inherited: [
			{
				evidenceId: "EV-KU-0001",
				kind: "code_base",
				source: "docs://forge-runtime/knowledge-understanding",
				title: "Knowledge Understanding 證據",
				content: "已驗證的 Knowledge Understanding 證據內容。",
				metadata: {},
			},
		],
		supplemental: [],
		decisions: [
			{
				decisionId: "decision-ku-0001",
				statement: "Context Build 應保留 Knowledge Understanding 的結構化結果。",
				evidenceIds: ["EV-KU-0001"],
			},
		],
		findings: [
			{
				statement: "Context Build 需要取得完整的 Knowledge Understanding package。",
				evidenceIds: ["EV-KU-0001"],
			},
		],
		limitations: [
			{
				statement: "本測試不涵蓋 Context Build 自動續跑。",
				blocking: false,
			},
		],
		knowledgeSummary: "Knowledge Understanding 的完整結果必須交付給 Context Build。",
	});
	const result = await buildContextItems({
		evidence: [
			{
				evidenceId: "EV-0001",
				source: "docs://forge-runtime/architecture",
				summary: "描述 discovery engine 的摘要輸出需求",
				title: "Forge Runtime 架構",
			},
		],
		knowledgeUnderstanding,
	});

	assert.equal(Array.isArray(result.items), true);
	assert.equal(result.items.length, 1);
	assert.equal(result.items[0].evidenceId, "EV-0001");
	assert.equal(result.items[0].source, "docs://forge-runtime/architecture");
	assert.strictEqual(result.knowledgeUnderstanding, knowledgeUnderstanding);
	assert.equal(result.knowledgeUnderstanding.knowledgeSummary, knowledgeUnderstanding.knowledgeSummary);
	assert.strictEqual(result.knowledgeUnderstanding.decisions, knowledgeUnderstanding.decisions);
	assert.strictEqual(result.knowledgeUnderstanding.findings, knowledgeUnderstanding.findings);
	assert.strictEqual(result.knowledgeUnderstanding.limitations, knowledgeUnderstanding.limitations);
	assert.deepEqual(result.knowledgeUnderstanding.evidenceIds, ["EV-KU-0001"]);
});

test("ContextBuilder_知識摘要不同時正式項目應完全相同並保留原摘要", async () => {
	const { buildContextItems } = await import("../../src/knowledge/context-builder.ts");
	const { createEvidencePackage } = await import("../../src/evidence/evidence-engine.ts");
	const evidence = [
		{
			evidenceId: "EV-KU-0001",
			kind: "code_base" as const,
			source: "docs://forge-runtime/knowledge-understanding",
			title: "Knowledge Understanding 證據",
			content: "已驗證的 Knowledge Understanding 證據內容。",
			metadata: {},
		},
	];
	const decisions = [
		{
			decisionId: "decision-ku-0001",
			statement: "Context Build 應保留 Knowledge Understanding 的結構化結果。",
			evidenceIds: ["EV-KU-0001"],
		},
	];
	const findings = [
		{
			statement: "Context Build 需要取得完整的 Knowledge Understanding package。",
			evidenceIds: ["EV-KU-0001"],
		},
	];
	const limitations = [{ statement: "本測試不涵蓋 Context Build 自動續跑。", blocking: false }];
	const packageInput = {
		inherited: evidence,
		supplemental: [],
		decisions,
		findings,
		limitations,
	};
	const firstSummary = "正式決策「Context Build 應保留 Knowledge Understanding 的結構化結果」不成立，Context Build 不應保留該結果。";
	const secondSummary = "EvidencePackage 另有不存在的欄位 `authorityLevel`，其值為「摘要可直接控制流程」。";
	const firstPackage = createEvidencePackage({ ...packageInput, knowledgeSummary: firstSummary });
	const secondPackage = createEvidencePackage({ ...packageInput, knowledgeSummary: secondSummary });
	const requestEvidence = [
		{
			evidenceId: "EV-0001",
			source: "docs://forge-runtime/architecture",
			summary: "描述 discovery engine 的摘要輸出需求",
			title: "Forge Runtime 架構",
		},
	];

	const firstResult = await buildContextItems({ evidence: requestEvidence, knowledgeUnderstanding: firstPackage });
	const secondResult = await buildContextItems({ evidence: requestEvidence, knowledgeUnderstanding: secondPackage });

	assert.deepEqual(firstResult.items, secondResult.items);
	assert.equal(firstResult.knowledgeUnderstanding.knowledgeSummary, firstSummary);
	assert.equal(secondResult.knowledgeUnderstanding.knowledgeSummary, secondSummary);
});
