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
	const contextItems = await buildContextItems({
		evidence: [
			{
				evidenceId: "EV-0001",
				source: "docs://forge-runtime/architecture",
				summary: "描述 discovery engine 的摘要輸出需求",
				title: "Forge Runtime 架構",
			},
		],
	});

	assert.equal(Array.isArray(contextItems), true);
	assert.equal(contextItems.length, 1);

	const [contextItem] = contextItems;

	assert.equal(contextItem.evidenceId, "EV-0001");
	assert.equal(contextItem.source, "docs://forge-runtime/architecture");
});
