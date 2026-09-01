import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGrillingSkillInvocation } from "../../src/grill/grill-skill.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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

test("BuildGrillingSkillInvocation_WhenOptionsAreRequested_ShouldRequireCompleteRecordableAnswers", () => {
	const prompt = buildGrillingSkillInvocation("新增 runtime contract");

	assert.match(prompt, /questions\[\]\.options.*必須.*可直接記錄為 decision 的完整答案/);
});

test("BuildGrillingSkillInvocation_WhenFreeTextIsAvailable_ShouldForbidInputInstructionOptions", () => {
	const prompt = buildGrillingSkillInvocation("新增 runtime contract");

	assert.match(prompt, /options 禁止使用「請輸入／請提供……」等操作指示；自由文字輸入責任交給 WAIT_USER UI。/);
});

test("BuildGrillingSkillInvocation_WhenAnswerRemainsInsufficient_ShouldRequireNewClarificationDecisionId", () => {
	const prompt = buildGrillingSkillInvocation("新增 runtime contract", "grill-2");

	assert.match(prompt, /若回答語意仍不足.*下一輪.*新的 clarification decision/);
	assert.match(prompt, /不得重用已回答的 decisionId/);
});

test("GrillingSkill_WhenConverging_ShouldLimitQuestionsToObjectiveKnowledgeGaps", () => {
	const prompt = buildGrillingSkillInvocation("收斂 runtime contract 的方案");

	assert.match(prompt, /(?:converge|收斂)/i);
	assert.match(prompt, /客觀.*(?:知識|資訊)|(?:知識|資訊).*盲點|evidence|證據/i);
	assert.match(prompt, /最多一題|只.*一題|一個.*問題/);
	assert.match(prompt, /READY_FOR_DEEP/);
	assert.match(prompt, /(?:實作|implementation).*細節|合理預設|可預設|default/i);
});

test("GrillingSkill_WhenTheSingleGapIsAnswered_ShouldEnterDeepWithoutAnotherGrillRound", () => {
	const prompt = buildGrillingSkillInvocation("收斂後補上唯一的知識盲點");

	assert.match(prompt, /回答.*(?:直接|自動).*DEEP_KNOWLEDGE_RETRIEVAL|DEEP_KNOWLEDGE_RETRIEVAL.*回答/);
	assert.match(prompt, /不得.*(?:Grill|grill).*round|不得.*checkpoint|不得.*第二題|不再.*(?:Grill|grill)/i);
});

test("GrillingSkill_WhenPackaged_ShouldResolveSkillInsidePackage", () => {
	const invocation = buildGrillingSkillInvocation("收斂 runtime contract");
	const location = invocation.match(/<skill name="grilling" location="([^"]+)">/)?.[1];

	assert.ok(location);
	const resolvedLocation = resolve(location);
	const packageRelativePath = relative(packageRoot, resolvedLocation).replaceAll("\\", "/");
	assert.equal(packageRelativePath, "skills/grilling/SKILL.md");
	assert.ok(packageRelativePath.split("/")[0] !== "..", "skill must stay inside package root");
	assert.ok(existsSync(resolvedLocation));
});
