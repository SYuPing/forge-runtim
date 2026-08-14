import assert from "node:assert/strict";
import test from "node:test";
import { buildGrillingSkillInvocation } from "../../src/grill/grill-skill.ts";

test("buildGrillingSkillInvocation_WhenEvidenceSnapshotIsReused_ShouldRequireVerificationOnlyOnItsFirstRound", () => {
	const prompt = buildGrillingSkillInvocation("新增 runtime contract", "grill-1", [
		{
			candidateId: "ev-evidence" as `ev-${string}`,
			kind: "wiki",
			source: "wiki/contract.md",
			title: "contract.md",
		},
	]);

	assert.match(prompt, /新 snapshot 的首輪.*必須.*forge_grill_evidence/);
	assert.match(prompt, /同一 snapshot 的後續 round.*可重用.*已查核 evidence/);
	assert.match(prompt, /必須呼叫 forge_grill_complete/);
	assert.doesNotMatch(prompt, /請只輸出單一 JSON 物件/);
	assert.doesNotMatch(prompt, /JSON 欄位固定為/);
});

test("buildGrillingSkillInvocation_WhenGrillToolsAreDeclared_ShouldAllowOnlyTheTwoDomainTools", () => {
	const prompt = buildGrillingSkillInvocation("新增 runtime contract");

	assert.match(prompt, /Grill v1 僅允許 forge_grill_evidence 與 forge_grill_complete；所有其他工具（包含原生與未知工具）一律禁止。/);
});

test("GrillSkill_WhenInvocationBuilt_ShouldRequireCompletionToolWithoutAssistantProse", () => {
	const prompt = buildGrillingSkillInvocation("新增 runtime contract");

	assert.match(prompt, /forge_grill_evidence/);
	assert.match(prompt, /forge_grill_complete/);
	assert.match(prompt, /完成結果只能透過 forge_grill_complete 提交/);
	assert.match(prompt, /NEEDS_CONFIRMATION 時，questions 只放一題/);
	assert.match(prompt, /READY_FOR_DEEP 時，questions 輸出空陣列/);
	assert.doesNotMatch(prompt, /只輸出一個最阻塞的確認問題/);
	assert.doesNotMatch(prompt, /(?:允許|可以|請|應).{0,12}(?:assistant prose|其他文字結果)/i);
});
