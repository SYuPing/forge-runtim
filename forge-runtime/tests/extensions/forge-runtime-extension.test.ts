import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

type RegisteredCommand = {
	description?: string;
	handler: (args: string, ctx: unknown) => Promise<void>;
};

type RegisteredEventHandler = (event: unknown, ctx?: unknown) => Promise<unknown> | unknown;
type RegisteredTool = {
	name: string;
	parameters?: unknown;
	execute?: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: unknown,
	) => Promise<{
		content: Array<{ type: string; text: string }>;
		details: Record<string, unknown>;
	}>;
};
type SentUserMessage = {
	content: string;
	options?: { deliverAs?: "steer" | "followUp" };
};
type NewSessionOptions = {
	withSession?: (ctx: { sendUserMessage(content: string): Promise<void> | void }) => Promise<void> | void;
};
type ReplacementSessionInput = {
	content: string;
	result: unknown;
};

const waitUserPayload = JSON.stringify({
	question: "Proceed to deep knowledge retrieval?",
	recommendation: "confirm",
	options: ["confirm", "reject"],
	evidenceIds: ["EV-4242"],
	decisionSummary: "Need explicit user confirmation before continuing.",
});

const switchGrillResult = JSON.stringify({
	status: "NEEDS_CONFIRMATION",
	questions: [
		{
			id: "q-switch",
			question: "Should we switch to Plan B?",
			options: ["accept", "revise"],
		},
	],
	recommendation: {
		value: "accept",
		reason: "New request should enter the next forge flow.",
		confidence: 0.73,
	},
	evidence: ["EV-SWITCH"],
	requiresUserConfirmation: true,
});

const readyForDeepGrillResult = JSON.stringify({
	status: "READY_FOR_DEEP",
	questions: [],
	recommendation: {
		value: "proceed",
		reason: "已有足夠資訊進入 deep knowledge。",
		confidence: 0.91,
	},
	evidence: ["EV-READY"],
	requiresUserConfirmation: false,
});

const knowledgeBoundaryRequest = "請幫我測試 BoundaryToken";
const tempRootEvidence = "OnlyTempRootEvidence";

test("Extension_WhenGrillStarts_ShouldExposeOnlyDomainTools", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const { getActiveTools, sendInput } = await createExtensionHarness({ cwd: rootDir });

	await startFormalGrillRound(rootDir, sendInput);

	assert.deepEqual(getActiveTools().sort(), ["forge_grill_complete", "forge_grill_evidence"]);
});

test("Extension_WhenToolBoundaryCannotEnforce_ShouldNotStartGrill", async () => {
	const harness = await createExtensionHarness({ initialActiveTools: ["read"], withoutSetActiveTools: true });

	const result = await harness.sendInput("/grill-run 請幫我壓測方案 A");

	assert.deepEqual(result, { action: "handled" });
	assert.deepEqual(harness.getActiveTools(), ["read"]);
	assert.equal(harness.observedStatuses.some((status) => status.includes("GRILL")), false);
});

test("Extension_WhenNoGrillAttempt_ShouldBlockGrillToolCalls", async () => {
	const harness = await createExtensionHarness({ initialActiveTools: ["read"] });

	for (const toolName of ["forge_grill_evidence", "forge_grill_complete"]) {
		assert.deepEqual(
			await harness.toolCallHandler?.({ type: "tool_call", toolCallId: `call-${toolName}`, toolName, input: {} }),
			{ block: true },
			`${toolName} must be blocked without an active Grill attempt`,
		);
	}
});

test("Extension_WhenRequiredGrillSafetyCapabilityIsMissing_ShouldRejectGrillStartup", async () => {
	for (const row of [
		{ label: "registerTool", options: { withoutRegisterTool: true } },
		{ label: "getActiveTools", options: { withoutGetActiveTools: true } },
		{ label: "event hook", options: { withoutEventHook: true } },
	]) {
		const harness = await createExtensionHarness({ initialActiveTools: ["read"], ...row.options });

		if ("withoutEventHook" in row.options) {
			assert.equal(harness.inputHandler, undefined, `${row.label} 缺失時不得暴露可啟動 Grill 的 ingress`);
			continue;
		}

		const result = await harness.sendInput("/grill-run 請幫我壓測方案 A");
		assert.deepEqual(result, { action: "handled" }, `${row.label} 缺失時必須拒絕啟動 Grill`);
		assert.deepEqual(harness.getActiveTools(), ["read"]);
		assert.equal(harness.observedStatuses.some((status) => status.includes("GRILL")), false);
	}
});

test("Extension_WhenRelevanceGateFails_ShouldDisplayScopeQuestionAndEnterWaitUser", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"wiki/relevance-only.md",
		"RelevanceOnlyNeedle is documentary evidence, without a code_base candidate for deep knowledge.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 RelevanceOnlyNeedle");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "正式 ingress 應提供可查核的 snapshot candidate");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-relevance-gate-evidence", { candidateId }, undefined, undefined, {});

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to expose execute");
	await completionTool.execute(
		"call-relevance-gate-ready",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "先嘗試進入 deep。", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.doesNotMatch(harness.observedMessages.join("\n"), /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.deepEqual(
		await harness.toolCallHandler?.({ type: "tool_call", toolCallId: "call-relevance-read", toolName: "read", input: {} }),
		{ block: true },
	);
	const renderedPayload = harness.observedMessagePayloads.map((payload) => String(payload.content ?? "")).join("\n");
	assert.match(renderedPayload, /候選相關性不足|relevance gate/i);
	assert.match(renderedPayload, /來源|範圍/);
});

test("Extension_WhenSuccessfulSwitchReplacesPendingAssetApproval_ShouldNotResumeItOnApproval", async (t) => {
	const rootDir = createTempRoot({ withWiki: false, withCodeBase: false });
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({
		cwd: rootDir,
		newSession: async () => ({ cancelled: false }),
	});
	assert.deepEqual(await harness.sendInput("請幫我測試舊需求"), { action: "handled" });

	await harness.runCommand("switch 請幫我測試新需求");

	assert.deepEqual(await harness.sendInput("同意"), { action: "continue" });
	assert.equal(harness.observedStatuses.at(-1), undefined);
});

test("Extension_WhenGrillRunAliasUsesControlledAssets_ShouldCreateFormalRoundAndSnapshotManifest", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/alias-round-candidate.ts",
		"// AliasRoundNeedle gives this formal Grill round path and content signals.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput("/grill-run 請幫我測試 AliasRoundNeedle alias-round-candidate.ts");
	const invocation = (result as { text?: string }).text ?? "";

	assert.equal((result as { action?: string }).action, "transform");
	assert.match(invocation, /roundId\s*[:：]\s*grill-1/);
	assert.match(invocation, /\bev-[0-9a-f]{64}\b/);
	assert.match(invocation, /forge_grill_evidence 只接受 manifest 中的 candidateId/);
	assert.match(invocation, /完成時必須呼叫 forge_grill_complete；completion payload 必須原樣包含此 roundId/);
});

test("Extension_WhenNonDomainToolIsCalledDuringGrill_ShouldBlock", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const { sendInput, toolCallHandler } = await createExtensionHarness({ cwd: rootDir });

	await startFormalGrillRound(rootDir, sendInput);
	assert.ok(toolCallHandler, "Expected tool_call handler to be registered for the grill tool gate");

	const result = await toolCallHandler({ type: "tool_call", toolCallId: "call-non-domain", toolName: "read", input: {} });

	assert.deepEqual(result, { block: true });
});

test("Extension_WhenEvidenceCandidateIsKnown_ShouldReturnSnapshotContent", async (t) => {
	const rootDir = createTempRoot();
	const candidateContent = [
		"// SnapshotEvidenceNeedle is the frozen source for this Grill round.",
		'export const snapshotEvidenceCandidate = "immutable";',
	].join("\n");
	writeWorkspaceFile(rootDir, "code_base/src/snapshot-evidence-candidate.ts", candidateContent);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const startResult = await harness.sendInput("請幫我測試 SnapshotEvidenceNeedle snapshot-evidence-candidate.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	const evidenceResult = await evidenceTool.execute("call-known-evidence", { candidateId }, undefined, undefined, {});

	assert.equal(evidenceResult.content[0]?.text, candidateContent);
	assert.equal(evidenceResult.details.candidateId, candidateId);
	assert.equal(evidenceResult.details.kind, "code_base");
	assert.equal(evidenceResult.details.title, "snapshot-evidence-candidate.ts");
	assert.equal(evidenceResult.details.source, "code_base/src/snapshot-evidence-candidate.ts");
	assert.notEqual(evidenceResult.details.metadata, undefined);
});

test("Extension_WhenEvidenceCandidateIsUnknown_ShouldReject", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/unknown-evidence-candidate.ts",
		"// UnknownEvidenceNeedle keeps this snapshot active for the tool contract.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	await harness.sendInput("請幫我測試 UnknownEvidenceNeedle unknown-evidence-candidate.ts");
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");

	await assert.rejects(
		evidenceTool.execute("call-unknown-evidence", { candidateId: `ev-${"0".repeat(64)}` }, undefined, undefined, {}),
		(error: unknown) => {
			assert.equal(error instanceof Error ? error.message : String(error), "GRILL_EVIDENCE_CANDIDATE_NOT_FOUND");
			return true;
		},
	);
});

test("Extension_WhenCompletionNeedsConfirmation_ShouldDisplayQuestionAndEnterWaitUser", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/completion-evidence-candidate.ts",
		"// CompletionEvidenceNeedle is available for this Grill completion round.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const startResult = await harness.sendInput("請幫我測試 CompletionEvidenceNeedle completion-evidence-candidate.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-completion-evidence", { candidateId }, undefined, undefined, {});

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to expose execute");
	await completionTool.execute(
		"call-completion",
		{
			roundId: "grill-1",
			status: "NEEDS_CONFIRMATION",
			questions: [{ id: "q1", question: "選擇下一步？", options: ["A", "B"] }],
			recommendation: { value: "A", reason: "需要使用者決定", confidence: 0.8 },
			evidence: [candidateId],
			requiresUserConfirmation: true,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.match(harness.observedMessages.join("\n"), /WAIT_USER/);
	assert.deepEqual(harness.getActiveTools(), ["forge_grill_evidence", "forge_grill_complete"]);

	assert.ok(harness.messageUpdateHandler, "Expected message_update handler to be registered for Grill suppression");
	const updateEvent = {
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "completion prose must not leak" },
				{ type: "thinking", thinking: "completion thinking must not leak" },
			],
		},
	};
	await harness.messageUpdateHandler(updateEvent);
	assert.equal(updateEvent.message.content[0]?.text, "");
	assert.equal(updateEvent.message.content[1]?.thinking, "");
});

test("Extension_WhenPanelIsEmitted_ShouldUseVisibleContentContract", async () => {
	const harness = await createExtensionHarness();
	await harness.runCommand(`grill ambiguous ${waitUserPayload}`);

	const payload = harness.observedMessagePayloads.at(-1);
	assert.ok(payload, "Expected the extension to emit a panel message");
	const panelText = [
		"Forge WAIT_USER [waiting-user]",
		"",
		"Stage: WAIT_USER",
		"Question: Proceed to deep knowledge retrieval?",
		"Recommendation: confirm",
		"Options: confirm, reject",
		"Evidence: EV-4242",
		"Confirm: /forge-runtime confirm",
		"Reject: /forge-runtime reject",
		"",
		"Decision: Need explicit user confirmation before continuing.",
		"Evidence: EV-4242",
	].join("\n");
	assert.equal(payload.content, panelText);
	assert.equal(payload.display, true);
});

test("Extension_WhenUserAnswersQuestion_ShouldAutomaticallyStartNextGrillRound", async (t) => {
	const rootDir = createTempRoot();
	const goal = "請幫我測試 AnswerNextRoundNeedle answer-next-round-candidate.ts";
	writeWorkspaceFile(
		rootDir,
		"code_base/src/answer-next-round-candidate.ts",
		"// AnswerNextRoundNeedle is the immutable candidate for the next Grill round.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const startResult = await harness.sendInput(goal);
	assert.equal((startResult as { action?: string }).action, "transform");
	const firstInvocation = (startResult as { text?: string }).text ?? "";
	const candidateId = firstInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.match(firstInvocation, /roundId\s*[:：]\s*grill-1/);
	assert.ok(candidateId, "正式 Grill ingress 應建立 grill-1 的 manifest candidate");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "正式 Grill 應提供 evidence tool");
	await evidenceTool.execute("call-answer-next-round-evidence", { candidateId }, undefined, undefined, {});

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "正式 Grill 應提供 completion tool");
	await completionTool.execute(
		"call-answer-next-round-completion",
		{
			roundId: "grill-1",
			status: "NEEDS_CONFIRMATION",
			questions: [{ id: "q-answer-next-round", question: "是否繼續？", options: ["confirm", "reject"] }],
			recommendation: { value: "confirm", reason: "回答後需要開始下一 Grill round", confidence: 0.8 },
			evidence: [candidateId],
			requiresUserConfirmation: true,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);

	const answerResult = await harness.sendInput("confirm");
	assert.equal((answerResult as { action?: string }).action, "transform");
	const nextInvocation = (answerResult as { text?: string }).text ?? "";
	assert.match(nextInvocation, /roundId\s*[:：]\s*grill-2/);
	assert.match(nextInvocation, new RegExp(escapeRegExp(goal)));
	assert.match(nextInvocation, new RegExp(`\\b${candidateId}\\b`));
	assert.match(nextInvocation, /User answered decision "q-answer-next-round" with "confirm"\./);
	assert.equal(harness.observedUserMessageCalls.length, 0, "回答不應依賴 continue 或額外 followUp");
});

test("Extension_WhenFormalCompletionEntersWaitUser_ShouldBlockNonDomainTools", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "正式 Grill 應提供 evidence tool");
	await evidenceTool.execute("call-wait-user-evidence", { candidateId }, undefined, undefined, {});

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "正式 Grill 應提供 completion tool");
	await completionTool.execute(
		"call-wait-user-completion",
		{
			roundId: "grill-1",
			status: "NEEDS_CONFIRMATION",
			questions: [{ id: "q-wait-user", question: "是否繼續？", options: ["繼續", "停止"] }],
			recommendation: { value: "繼續", reason: "需等待人類決策", confidence: 0.8 },
			evidence: [candidateId],
			requiresUserConfirmation: true,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.deepEqual(
		await harness.toolCallHandler?.({ type: "tool_call", toolCallId: "call-wait-user-read", toolName: "read", input: {} }),
		{ block: true },
	);
});

test("Extension_WhenWaitUserAnswerIsOptionOrFreeText_ShouldReuseFetchedSnapshotEvidenceInNextGrillRound", async (t) => {
	for (const { answer, label } of [
		{ answer: "B", label: "非推薦選項" },
		{ answer: "我想先採用 B，因為它較符合目前風險", label: "自由文字" },
	]) {
		const rootDir = createTempRoot();
		writeWorkspaceFile(
			rootDir,
			"code_base/src/resume-answer-evidence-candidate.ts",
			"// ResumeAnswerEvidenceNeedle is available for the resumed Grill round.",
		);
		t.after(() => {
			rmSync(rootDir, { force: true, recursive: true });
		});

		const harness = await createExtensionHarness({ cwd: rootDir });
		const startResult = await harness.sendInput("請幫我測試 ResumeAnswerEvidenceNeedle resume-answer-evidence-candidate.ts");
		const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
		assert.ok(candidateId, "正式 Grill invocation 應公開 snapshot candidate id");

		const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
		assert.ok(evidenceTool?.execute, "應提供 forge_grill_evidence execute");
		await evidenceTool.execute(`call-${label}-first-evidence`, { candidateId }, undefined, undefined, {});

		const completionTool = harness.registeredTools.get("forge_grill_complete");
		assert.ok(completionTool?.execute, "應提供 forge_grill_complete execute");
		await completionTool.execute(
			`call-${label}-first-completion`,
			{
				roundId: "grill-1",
				status: "NEEDS_CONFIRMATION",
				questions: [{ id: "q1", question: "選擇下一步？", options: ["A", "B"] }],
				recommendation: { value: "A", reason: "需要使用者決定", confidence: 0.8 },
				evidence: [candidateId],
				requiresUserConfirmation: true,
			},
			undefined,
			undefined,
			harness.buildContext(),
		);

		const resumeResult = await harness.sendInput(answer);
		assert.equal((resumeResult as { action?: string }).action, "transform", `${label} 應重送 Grill invocation`);
		const resumeText = (resumeResult as { text?: string }).text ?? "";
		assert.match(resumeText, /<skill name="grilling"/, `${label} 應走正式 Grill ingress`);
		assert.match(resumeText, /roundId\s*[:：]\s*grill-2/, `${label} 應建立下一個 round`);
		assert.ok(resumeText.includes(answer), `${label} 應記錄在下一個 Grill invocation`);
		assert.match(resumeText, new RegExp(`\\b${candidateId}\\b`), `${label} 應沿用 immutable snapshot`);
		assert.match(resumeText, /forge_grill_evidence/, `${label} 應重送 evidence contract`);
		assert.match(resumeText, /forge_grill_complete/, `${label} 應重送 completion contract`);

		await completionTool.execute(
			`call-${label}-resume-completion`,
			{
				roundId: "grill-2",
				status: "NEEDS_CONFIRMATION",
				questions: [{ id: "q2", question: "還需要確認嗎？", options: ["繼續"] }],
				recommendation: { value: "繼續", reason: "下一輪需繼續確認", confidence: 0.8 },
				evidence: [candidateId],
				requiresUserConfirmation: true,
			},
			undefined,
			undefined,
			harness.buildContext(),
		);

		assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/, `${label} 的完成結果應再次進入 WAIT_USER`);
	}
});

test("Extension_WhenContinueDuringActiveGrill_ShouldReplaySameRoundWithoutDecisionOrNewSnapshot", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/continue-replay-evidence-candidate.ts",
		"// ContinueReplayNeedle is the immutable candidate for this active Grill round.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const goal = "請幫我測試 ContinueReplayNeedle continue-replay-evidence-candidate.ts";
	const startResult = await harness.sendInput(goal);
	const startText = (startResult as { text?: string }).text ?? "";
	const candidateId = startText.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.equal((startResult as { action?: string }).action, "transform");
	assert.match(startText, /roundId\s*[:：]\s*grill-1/);
	assert.ok(candidateId, "正式 Grill ingress 應建立 grill-1 的 manifest candidate");

	const followUpCount = harness.observedUserMessageCalls.length;
	await harness.runCommand("forge-runtime", "continue");

	assert.equal(harness.observedUserMessageCalls.length, followUpCount + 1, "continue 應只重送一則 followUp");
	const replay = harness.observedUserMessageCalls.at(-1);
	assert.equal(replay?.options?.deliverAs, "followUp");
	assert.match(replay?.content ?? "", /<skill name="grilling"/);
	assert.match(replay?.content ?? "", new RegExp(escapeRegExp(goal)));
	assert.match(replay?.content ?? "", /roundId\s*[:：]\s*grill-1/);
	assert.match(replay?.content ?? "", new RegExp(`\\b${candidateId}\\b`));
	assert.match(replay?.content ?? "", /forge_grill_evidence/);
	assert.match(replay?.content ?? "", /forge_grill_complete/);
	assert.match(replay?.content ?? "", /completion payload/i);
	assert.doesNotMatch(replay?.content ?? "", /User answered decision/i);
	assert.doesNotMatch(replay?.content ?? "", /roundId\s*[:：]\s*grill-[2-9]/);
	assert.deepEqual((replay?.content ?? "").match(/\bev-[0-9a-f]{64}\b/g), [candidateId]);
});

test("Extension_WhenCompletionSuccessIsFollowedByTerminalProse_ShouldSuppressOnlyThatTurn", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/completion-turn-evidence-candidate.ts",
		"// CompletionTurnEvidenceNeedle is available for this completed Grill turn.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const startResult = await harness.sendInput("請幫我測試 CompletionTurnEvidenceNeedle completion-turn-evidence-candidate.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-completion-turn-evidence", { candidateId }, undefined, undefined, {});

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to expose execute");
	await completionTool.execute(
		"call-completion-turn",
		{
			roundId: "grill-1",
			status: "NEEDS_CONFIRMATION",
			questions: [{ id: "q1", question: "選擇下一步？", options: ["A", "B"] }],
			recommendation: { value: "A", reason: "需要使用者決定", confidence: 0.8 },
			evidence: [candidateId],
			requiresUserConfirmation: true,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.ok(harness.messageEndHandler, "Expected message_end handler to suppress completed Grill prose");
	const terminalProse = "same completed Grill turn prose must not leak";
	const terminalResult = await harness.messageEndHandler(
		{
			message: {
				role: "assistant",
				content: [{ type: "text", text: terminalProse }],
			},
		},
		harness.buildContext(),
	);

	assert.doesNotMatch(harness.observedMessages.join("\n"), /GRILL_RESULT_PARSE_ERROR|GRILL_COMPLETION_REQUIRED/);
	assert.ok(terminalResult && typeof terminalResult === "object" && "message" in terminalResult, "Expected terminal prose to be replaced");
	assert.doesNotMatch(JSON.stringify(terminalResult), new RegExp(escapeRegExp(terminalProse)));
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);

	assert.ok(harness.messageUpdateHandler, "Expected message_update handler to be registered for Grill suppression");
	const nextTurnUpdate = {
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "new turn prose remains visible" },
				{ type: "thinking", thinking: "new turn thinking remains visible" },
			],
		},
	};
	await harness.messageUpdateHandler(nextTurnUpdate);
	assert.equal(nextTurnUpdate.message.content[0]?.text, "new turn prose remains visible");
	assert.equal(nextTurnUpdate.message.content[1]?.thinking, "new turn thinking remains visible");
});

test("Extension_WhenReadyCompletionExitsGrill_ShouldRestorePriorActiveToolsAndEnterDeepKnowledge", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/ready-completion-evidence-candidate.ts",
		"// ReadyCompletionNeedle is available for this Grill deep knowledge transition.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read", "write"] });
	const startResult = await harness.sendInput("請幫我測試 ReadyCompletionNeedle ready-completion-evidence-candidate.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-ready-evidence", { candidateId }, undefined, undefined, {});

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to expose execute");
	await completionTool.execute(
		"call-ready-completion",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "候選已通過相關性 gate", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.match(harness.observedStatuses.at(-1) ?? "", /KNOWLEDGE_UNDERSTANDING/);
	assert.match(harness.observedMessages.join("\n"), /KNOWLEDGE_UNDERSTANDING/);
	assert.deepEqual(harness.getActiveTools(), ["read", "write"]);

	assert.ok(harness.messageUpdateHandler, "Expected message_update handler to be registered for Grill suppression");
	const updateEvent = {
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "ready completion prose must not leak" },
				{ type: "thinking", thinking: "ready completion thinking must not leak" },
			],
		},
	};
	await harness.messageUpdateHandler(updateEvent);
	assert.equal(updateEvent.message.content[0]?.text, "");
	assert.equal(updateEvent.message.content[1]?.thinking, "");
});

test("Extension_WhenCompletionOmissionOccurs_ShouldShowRetryCancelSwitchAndSettle", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir, reenterFollowUps: true });
	assert.ok(harness.messageEndHandler, "Expected message_end handler to be registered for Grill completion enforcement");

	await startFormalGrillRound(rootDir, harness.sendInput);
	const followUpCount = harness.observedUserMessageCalls.length;
	const result = await harness.messageEndHandler(
		{
			message: {
				role: "assistant",
				content: [{ type: "text", text: "我已完成分析，但沒有提交 completion。" }],
			},
		},
		harness.buildContext(),
	);

	const renderedMessages = harness.observedMessages.join("\n");
	assert.match(renderedMessages, /\/forge-runtime retry/);
	assert.match(renderedMessages, /\/forge-runtime cancel/);
	assert.match(renderedMessages, /\/forge-runtime switch <request>/);
	assert.match(harness.observedStatuses.at(-1) ?? "", /GRILL/);
	assert.equal(harness.observedUserMessageCalls.length, followUpCount, "omission recovery 不得 replay 舊 attempt");
	assert.equal((result as { message?: { content?: Array<{ text?: string }> } })?.message?.content?.[0]?.text, "");

	await harness.runCommand("forge-runtime", "retry");

	assert.equal(harness.observedUserMessageCalls.length, followUpCount + 1, "retry 應只新增一次 followUp sendUserMessage");
	const retry = harness.observedUserMessageCalls.at(-1);
	assert.equal(retry?.options?.deliverAs, "followUp");
	assert.equal(harness.reenteredFollowUpEvents.length, 1, "retry 應只重新進入共用 input 路徑一次");
	assert.deepEqual(harness.reenteredFollowUpEvents[0]?.event, { text: retry?.content });
	assert.equal((harness.reenteredFollowUpEvents[0]?.result as { action?: string }).action, "continue", "exact replay 應保留原文並繼續處理");
});

test("Extension_WhenContinueRequestedDuringRecovery_ShouldNotReplayAttempt", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir, reenterFollowUps: true });
	assert.ok(harness.messageEndHandler, "Expected message_end handler for Grill completion recovery");

	await startFormalGrillRound(rootDir, harness.sendInput);
	await harness.messageEndHandler(
		{
			message: {
				role: "assistant",
				content: [{ type: "text", text: "completion omitted" }],
			},
		},
		harness.buildContext(),
	);

	const observedUserMessageCalls = harness.observedUserMessageCalls.length;
	const reenteredFollowUpEvents = harness.reenteredFollowUpEvents.length;
	await harness.runCommand("forge-runtime", "continue");

	assert.equal(harness.observedUserMessageCalls.length, observedUserMessageCalls);
	assert.equal(harness.reenteredFollowUpEvents.length, reenteredFollowUpEvents);
	assert.match(harness.observedStatuses.at(-1) ?? "", /GRILL/);
	assert.match(harness.observedMessages.join("\n"), /RECOVERY_REQUIRED/);
	assert.ok(harness.observedNotifications.length > 0, "continue 應顯示 recovery 拒絕訊息");
	assert.match(harness.observedNotifications.at(-1) ?? "", /recovery/i);
});

function writeWorkspaceFile(rootDir: string, relativePath: string, content: string): string {
	const filePath = join(rootDir, ...relativePath.split("/"));
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content, "utf8");
	return filePath;
}

function createTempRoot(options: { withCodeBase?: boolean; withWiki?: boolean } = {}): string {
	const rootDir = mkdtempSync(join(tmpdir(), "forge-runtime-knowledge-boundary-"));
	mkdirSync(join(rootDir, "docs", "adr"), { recursive: true });
	writeFileSync(join(rootDir, "CONTEXT.md"), `BoundaryToken\n${tempRootEvidence}\n`, "utf8");
	writeFileSync(join(rootDir, "docs", "PLAN-A.md"), `BoundaryToken\n${tempRootEvidence}\n`, "utf8");
	if (options.withWiki ?? true) {
		mkdirSync(join(rootDir, "wiki"), { recursive: true });
		writeFileSync(join(rootDir, "wiki", "boundary.md"), `BoundaryToken\n${tempRootEvidence}\n`, "utf8");
	}
	if (options.withCodeBase ?? true) {
		mkdirSync(join(rootDir, "code_base"), { recursive: true });
	}
	return rootDir;
}

async function createExtensionHarness(options: {
	cwd?: string;
	initialActiveTools?: string[];
	newSession?: (options?: NewSessionOptions) => Promise<{ cancelled: boolean }>;
	reenterReplacementSession?: boolean;
	reenterFollowUps?: boolean;
	withoutFollowUpBridge?: boolean;
	withoutRegisterTool?: boolean;
	withoutGetActiveTools?: boolean;
	withoutEventHook?: boolean;
	withoutSetActiveTools?: boolean;
} = {}) {
	const { default: forgeRuntimeExtension } = await import("../../extensions/forge-runtime.ts");
	const commands = new Map<string, RegisteredCommand>();
	const eventHandlers = new Map<string, RegisteredEventHandler>();
	const registeredTools = new Map<string, RegisteredTool>();
	let activeTools = [...(options.initialActiveTools ?? [])];
	const observedMessages: string[] = [];
	const observedMessagePayloads: Array<{ content?: unknown; display?: unknown; customType?: unknown }> = [];
	const observedStatuses: string[] = [];
	const observedNotifications: string[] = [];
	const observedUserMessages: string[] = [];
	const observedUserMessageCalls: SentUserMessage[] = [];
	const reenteredFollowUpEvents: Array<{ event: { text: string }; result: unknown }> = [];
	const replacementSessionInputs: ReplacementSessionInput[] = [];
	const shouldReenterFollowUps = options.reenterFollowUps === true;
	const shouldReenterReplacementSession = options.reenterReplacementSession === true;

	const fakePi = {
		registerCommand(name: string, options: RegisteredCommand) {
			commands.set(name, options);
		},
		registerTool(tool: RegisteredTool) {
			registeredTools.set(tool.name, tool);
		},
		on(eventName: string, handler: RegisteredEventHandler) {
			eventHandlers.set(eventName, handler);
		},
		getActiveTools() {
			return [...activeTools];
		},
		setActiveTools(toolNames: string[]) {
			activeTools = [...toolNames];
		},
		sendMessage(message: { content?: unknown; display?: unknown; customType?: unknown }) {
			observedMessagePayloads.push(message);
			observedMessages.push(`${String(message.display ?? "")}\n${String(message.content ?? "")}\n${String(message.customType ?? "")}`);
		},
		async sendUserMessage(
			content: string | Array<{ type?: string; text?: string }>,
			options?: { deliverAs?: "steer" | "followUp" },
		) {
			const normalizedContent =
				typeof content === "string"
					? content
					: content
							.map((part) => (typeof part?.text === "string" ? part.text : ""))
							.join("\n");
			observedUserMessages.push(normalizedContent);
			observedUserMessageCalls.push({ content: normalizedContent, options });
			if (shouldReenterFollowUps && options?.deliverAs === "followUp") {
				const inputHandler = eventHandlers.get("input");
				assert.ok(inputHandler, "Expected input handler to be registered for followUp re-entry");
				const result = await inputHandler(
					{ text: normalizedContent, source: "extension", streamingBehavior: "followUp" },
					buildContext() as never,
				);
				reenteredFollowUpEvents.push({ event: { text: normalizedContent }, result });
			}
		},
	};
	if (options.withoutFollowUpBridge) {
		delete (fakePi as { sendUserMessage?: unknown }).sendUserMessage;
	}
	if (options.withoutRegisterTool) {
		delete (fakePi as { registerTool?: unknown }).registerTool;
	}
	if (options.withoutGetActiveTools) {
		delete (fakePi as { getActiveTools?: unknown }).getActiveTools;
	}
	if (options.withoutEventHook) {
		delete (fakePi as { on?: unknown }).on;
	}
	if (options.withoutSetActiveTools) {
		delete (fakePi as { setActiveTools?: unknown }).setActiveTools;
	}

	await forgeRuntimeExtension(fakePi as never);

	const command = commands.get("forge-runtime");
	assert.ok(command, "Expected forge-runtime extension to register a public 'forge-runtime' command");

	async function startReplacementSession(sessionOptions: NewSessionOptions = {}): Promise<{ cancelled: boolean }> {
		const replacementEventHandlers = new Map<string, RegisteredEventHandler>();
		let replacementActiveTools: string[] = [];
		await forgeRuntimeExtension({
			registerCommand() {},
			registerTool() {},
			on(eventName: string, handler: RegisteredEventHandler) {
				replacementEventHandlers.set(eventName, handler);
			},
			getActiveTools() {
				return [...replacementActiveTools];
			},
			setActiveTools(toolNames: string[]) {
				replacementActiveTools = [...toolNames];
			},
		} as never);

		const replacementInputHandler = replacementEventHandlers.get("input");
		assert.ok(replacementInputHandler, "Expected replacement session to register the front-door input handler");
		await sessionOptions.withSession?.({
			async sendUserMessage(content: string) {
				const result = await replacementInputHandler({ text: content }, buildContext() as never);
				replacementSessionInputs.push({ content, result });
			},
		});
		return { cancelled: false };
	}

	function buildContext(overrides: {
		cwd?: string;
		newSession?: (options?: NewSessionOptions) => Promise<{ cancelled: boolean }>;
		ui?: {
			notify?(message: string): void;
			select?(title: string, options: string[]): Promise<string | undefined>;
			custom?(...args: unknown[]): Promise<string | undefined>;
			setStatus?(status: string): void;
		};
	} = {}) {
		return {
			cwd: overrides.cwd ?? options.cwd,
			newSession:
				overrides.newSession ?? options.newSession ?? (shouldReenterReplacementSession ? startReplacementSession : undefined),
			ui: {
				notify: (message: string) => {
					observedNotifications.push(message);
				},
				setStatus: (status: string) => {
					observedStatuses.push(status);
				},
				...overrides.ui,
			},
		};
	}

	return {
		command,
		inputHandler: eventHandlers.get("input"),
		messageEndHandler: eventHandlers.get("message_end"),
		messageUpdateHandler: eventHandlers.get("message_update"),
		toolCallHandler: eventHandlers.get("tool_call"),
		registeredTools,
		getActiveTools() {
			return [...activeTools];
		},
			observedMessages,
			observedMessagePayloads,
		observedNotifications,
		observedStatuses,
		observedUserMessageCalls,
		observedUserMessages,
		reenteredFollowUpEvents,
		replacementSessionInputs,
		buildContext,
		async runCommand(
			commandNameOrArgs: string,
			argsOrOverrides: string | Parameters<typeof buildContext>[0] = {},
			overrides: Parameters<typeof buildContext>[0] = {},
		) {
			const [commandName, args, contextOverrides] =
				typeof argsOrOverrides === "string"
					? [commandNameOrArgs, argsOrOverrides, overrides]
					: ["forge-runtime", commandNameOrArgs, argsOrOverrides];
			const commandToRun = commands.get(commandName);
			assert.ok(commandToRun, `Expected '${commandName}' to be registered`);
			await commandToRun.handler(args, buildContext(contextOverrides) as never);
		},
		async sendInput(text: string, overrides: Parameters<typeof buildContext>[0] = {}) {
			const inputHandler = eventHandlers.get("input");
			assert.ok(inputHandler, "Expected input handler to be registered for front-door routing");
			return await inputHandler({ text }, buildContext(overrides) as never);
		},
		ui: {
			notify(message: string) {
				observedNotifications.push(message);
			},
			setStatus(status: string) {
				observedStatuses.push(status);
			},
		},
	};
}

async function openWorkflow(command: RegisteredCommand): Promise<void> {
	await command.handler(`grill ambiguous ${waitUserPayload}`, {});
	await command.handler("confirm", {});
}

test("Extension_WhenSwitchHasNoNewSession_ShouldKeepWaitUserWorkflowAndBlockNonDomainTools", async () => {
	const harness = await createExtensionHarness({ initialActiveTools: ["read"] });
	await harness.runCommand(`grill ambiguous ${waitUserPayload}`);
	const waitUserStatus = harness.observedStatuses.at(-1);

	await harness.runCommand("switch 改題後的需求");

	assert.equal(harness.observedStatuses.at(-1), waitUserStatus);
	assert.deepEqual(harness.getActiveTools(), ["read"]);
	assert.deepEqual(
		await harness.toolCallHandler?.({ type: "tool_call", toolCallId: "call-1", toolName: "read", input: {} }),
		{ block: true },
	);
});

test("Extension_WhenStreamingMessageEndsWithoutCompletion_ShouldNotSteerOrAutoReplay", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	await startFormalGrillRound(rootDir, harness.sendInput);

	const streamingText = { type: "text", text: "streaming text" };
	const streamingThinking = { type: "thinking", thinking: "streaming thinking" };
	const streamingMessage = {
		message: {
			role: "assistant",
			content: [streamingText, streamingThinking],
		},
	};
	await harness.messageUpdateHandler?.(streamingMessage as never, harness.buildContext() as never);
	assert.equal(streamingText.text, "");
	assert.equal(streamingThinking.thinking, "");

	const userMessageCallCount = harness.observedUserMessageCalls.length;
	const reenteredFollowUpCount = harness.reenteredFollowUpEvents.length;
	await harness.messageEndHandler?.(
		{ message: { role: "assistant", content: [{ type: "text", text: "terminal text" }] } } as never,
		harness.buildContext() as never,
	);

	assert.equal(harness.observedUserMessageCalls.length, userMessageCallCount);
	assert.equal(harness.reenteredFollowUpEvents.length, reenteredFollowUpCount);
	assert.deepEqual(harness.getActiveTools(), ["read"]);
	assert.ok(harness.observedStatuses.at(-1)?.includes("GRILL"));
});

test("Extension_WhenSwitchNewSessionIsCancelled_ShouldKeepActiveWorkflowAndGrillGate", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({
		cwd: rootDir,
		initialActiveTools: ["read"],
		newSession: async () => ({ cancelled: true }),
	});
	await startFormalGrillRound(rootDir, harness.sendInput);
	const activeWorkflowStatus = harness.observedStatuses.at(-1);
	const activeGrillTools = harness.getActiveTools();

	await harness.runCommand("switch 替換需求");

	assert.equal(harness.observedStatuses.at(-1), activeWorkflowStatus);
	assert.deepEqual(harness.getActiveTools(), activeGrillTools);
	assert.deepEqual(
		await harness.toolCallHandler?.({ type: "tool_call", toolCallId: "call-cancelled-switch", toolName: "read", input: {} }),
		{ block: true },
	);
});

test("Extension_WhenWaitUserHasNoFollowUpBridge_ShouldKeepQuestionForConfirmAndReject", async () => {
	const results: Array<{ status: string; message: string; userMessageCount: number }> = [];
	for (const command of ["confirm", "reject 仍需補充風險"]) {
		const harness = await createExtensionHarness({ withoutFollowUpBridge: true });

		await harness.runCommand(`grill ambiguous ${waitUserPayload}`);
		await harness.runCommand(command);

		results.push({
			status: harness.observedStatuses.at(-1) ?? "",
			message: harness.observedMessages.at(-1) ?? "",
			userMessageCount: harness.observedUserMessageCalls.length,
		});
	}

	for (const result of results) {
		assert.match(result.status, /WAIT_USER/);
		assert.match(result.message, /Proceed to deep knowledge retrieval\?/);
		assert.equal(result.userMessageCount, 0);
	}
});

test("Extension_WhenContinueCannotFollowUp_ShouldKeepWaitUserAndBlockNonDomainTools", async () => {
	const harness = await createExtensionHarness({
		initialActiveTools: ["read"],
		withoutFollowUpBridge: true,
	});
	await harness.runCommand(`grill ambiguous ${waitUserPayload}`);

	await assert.doesNotReject(harness.runCommand("continue"));

	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.deepEqual(harness.getActiveTools(), ["read"]);
	assert.deepEqual(
		await harness.toolCallHandler?.({ type: "tool_call", toolCallId: "call-continue", toolName: "read", input: {} }),
		{ block: true },
	);
});

test("Extension_WhenCompletionReadyForDeep_ShouldAutomaticallyEnterDeepKnowledge", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read", "write"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(evidenceTool, "Expected forge_grill_evidence tool to be registered");
	assert.ok(completionTool, "Expected forge_grill_complete tool to be registered");
	const evidenceExecute = evidenceTool.execute;
	assert.ok(evidenceExecute, "Expected forge_grill_evidence to expose execute");
	await evidenceExecute("call-evidence", { candidateId }, undefined, undefined, harness.buildContext());

	const completionExecute = completionTool.execute;
	assert.ok(completionExecute, "Expected forge_grill_complete to expose execute");
	const completion = await completionExecute(
		"call-completion",
		{
			evidence: [candidateId],
			questions: [],
			recommendation: { reason: "證據足以進入 deep knowledge。", value: "proceed" },
			requiresUserConfirmation: false,
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.deepEqual(completion.content, [{ type: "text", text: "Forge Grill completion accepted." }]);
	assert.equal(completion.details.status, "READY_FOR_DEEP");
	assert.ok(harness.observedStatuses.at(-1)?.includes("KNOWLEDGE_UNDERSTANDING"));
	assert.doesNotMatch(harness.observedMessages.join("\n"), /CANDIDATE_RELEVANCE_INSUFFICIENT/);
	assert.deepEqual(harness.getActiveTools(), ["read", "write"]);
});

async function startFormalGrillRound(rootDir: string, sendInput: (text: string) => Promise<unknown>): Promise<string> {
	writeWorkspaceFile(
		rootDir,
		"code_base/src/boundary-token.ts",
		[
			"// BoundaryToken 固定這個 Grill round 的不可變 snapshot。",
			"// 檔名與內容各自提供探索訊號。",
			'export const boundaryToken = "ready";',
		].join("\n"),
	);
	const firstRound = await sendInput("請幫我測試 BoundaryToken boundary-token.ts");
	const firstInvocation = (firstRound as { text?: string }).text ?? "";
	const manifestCandidate = firstInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.match(firstInvocation, /grill-1/);
	assert.ok(manifestCandidate, "預期正式 Grill round 會提供 snapshot candidate id");
	return manifestCandidate;
}

function formalWaitUserCommand(manifestCandidate: string): string {
	return `grill ambiguous ${JSON.stringify({
		question: "Proceed to deep knowledge retrieval?",
		decisionId: "confirm",
		recommendation: "confirm",
		options: ["confirm", "reject"],
		evidenceIds: [manifestCandidate],
		decisionSummary: "Need explicit user confirmation before continuing.",
	})}`;
}

test("Extension_WhenOpenWorkflowGetsNewTopic_ShouldShowContinueCancelSwitchControls", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir });
	const manifestCandidate = await startFormalGrillRound(rootDir, harness.sendInput);

	const result = await harness.sendInput("請幫我改另一個錯誤");

	assert.deepEqual(result, { action: "handled" });
	const warning = harness.observedNotifications.at(-1) ?? "";
	assert.match(warning, /continue/i);
	assert.match(warning, /cancel/i);
	assert.match(warning, /switch/i);
});

test("Extension_WhenCancelCommandUsedInOpenWorkflow_ShouldResetToReceive", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const { command, observedStatuses, sendInput, ui } = await createExtensionHarness({ cwd: rootDir });

	await openWorkflow(command);
	await command.handler("cancel", { ui } as never);

	assert.equal(observedStatuses.at(-1), "Forge RECEIVE [active]");

	const result = await sendInput("請幫我改另一個錯誤");
	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	assert.match((result as { text?: string }).text ?? "", /<skill name="grilling"/);
});

test("Extension_WhenCancelFollowsAssetApprovalPrompt_ShouldNotResumeCancelledRequest", async (t) => {
	const rootDir = createTempRoot({ withWiki: false, withCodeBase: false });
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir });

	assert.deepEqual(await harness.sendInput("請幫我測試已取消的需求"), { action: "handled" });
	await harness.runCommand("cancel");

	assert.deepEqual(await harness.sendInput("同意"), { action: "continue" });
	assert.match(harness.observedStatuses.at(-1) ?? "", /RECEIVE/);
});

test("Extension_WhenGrillIsCancelled_ShouldRestorePreviousActiveTools", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read", "write"] });

	await startFormalGrillRound(rootDir, harness.sendInput);
	assert.deepEqual(harness.getActiveTools(), ["forge_grill_evidence", "forge_grill_complete"]);

	await harness.runCommand("cancel");

	assert.deepEqual(harness.getActiveTools(), ["read", "write"]);
});

test("Extension_WhenGrillIsSwitched_ShouldRestorePreviousActiveTools", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({
		cwd: rootDir,
		initialActiveTools: ["read", "write"],
		reenterReplacementSession: true,
	});

	await startFormalGrillRound(rootDir, harness.sendInput);
	assert.deepEqual(harness.getActiveTools(), ["forge_grill_evidence", "forge_grill_complete"]);

	await harness.runCommand("switch 請幫我壓測方案 B");

	assert.deepEqual(harness.getActiveTools(), ["read", "write"]);
	assert.equal(harness.replacementSessionInputs.length, 1);
	assert.equal(harness.replacementSessionInputs[0]?.content, "請幫我壓測方案 B");
});

test("Extension_WhenSwitchStartsReplacementSession_ShouldCreateSnapshotAndRoundThroughFrontDoor", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/current-workflow.ts",
		"// CurrentWorkflowNeedle keeps the original workflow open.",
	);
	writeWorkspaceFile(
		rootDir,
		"code_base/src/replacement-workflow.ts",
		"// ReplacementWorkflowNeedle must be discovered by the replacement session.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir, reenterReplacementSession: true });
	const originalRequest = "請幫我測試 CurrentWorkflowNeedle current-workflow.ts";
	const replacementRequest = "請幫我測試 ReplacementWorkflowNeedle replacement-workflow.ts";

	const startResult = await harness.sendInput(originalRequest);
	assert.equal((startResult as { action?: string }).action, "transform");

	await harness.runCommand(`switch ${replacementRequest}`);

	assert.equal(harness.replacementSessionInputs.length, 1, "Expected switch to create exactly one replacement session");
	const replacementInput = harness.replacementSessionInputs[0];
	assert.equal(replacementInput?.content, replacementRequest, "Replacement session must receive the raw replacement request");
	assert.doesNotMatch(replacementInput?.content ?? "", /^\/grill-run\b/);

	const replacementTransform = replacementInput?.result as { action?: string; text?: string };
	assert.equal(replacementTransform.action, "transform");
	assert.match(replacementTransform.text ?? "", /目前 Grill roundId: grill-1/);
	assert.match(replacementTransform.text ?? "", /\bev-[0-9a-f]{64}\b/);
	assert.match(replacementTransform.text ?? "", /forge_grill_evidence 只接受 manifest 中的 candidateId/);
	assert.match(replacementTransform.text ?? "", /完成時必須呼叫 forge_grill_complete；completion payload 必須原樣包含此 roundId/);
});

test("Extension_WhenContinueCommandReplaysGrillRound_ShouldSendExistingDecisionInFollowUp", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir, reenterFollowUps: true });
	const manifestCandidate = await startFormalGrillRound(rootDir, harness.sendInput);
	await harness.runCommand(formalWaitUserCommand(manifestCandidate));
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	await harness.sendInput("採用方案 A");

	await harness.runCommand("continue");

	const replay = harness.observedUserMessageCalls.at(-1);
	assert.equal(replay?.options?.deliverAs, "followUp");
	assert.match(replay?.content ?? "", /User answered decision "confirm" with "採用方案 A"\./);
	assert.equal(harness.reenteredFollowUpEvents.length, 1, "預期 continue 會重新進入共用 input 路徑");
	assert.equal((harness.reenteredFollowUpEvents[0]?.result as { action?: string }).action, "continue");
});

test("Extension_WhenGrillNeedsConfirmation_ShouldExposeWaitUser", async () => {
	const { default: forgeRuntimeExtension } = await import("../../extensions/forge-runtime.ts");
	const commands = new Map<string, RegisteredCommand>();
	const observedOutputs: string[] = [];

	const fakePi = {
		registerCommand(name: string, options: RegisteredCommand) {
			commands.set(name, options);
		},
		sendMessage(message: { content?: unknown; display?: unknown; customType?: unknown }) {
			observedOutputs.push(String(message.content ?? message.display ?? message.customType ?? ""));
		},
	};

	await forgeRuntimeExtension(fakePi as never);

	const command = commands.get("forge-runtime");
	assert.ok(command, "Expected forge-runtime extension to register a public 'forge-runtime' command");

	await command.handler(`grill ambiguous ${waitUserPayload}`, {});

	assert.match(observedOutputs.join("\n"), /WAIT_USER/);
});

test("Extension_WhenUserConfirmed_ShouldResumeDeepKnowledge", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir, reenterFollowUps: true });
	const manifestCandidate = await startFormalGrillRound(rootDir, harness.sendInput);
	await harness.runCommand(formalWaitUserCommand(manifestCandidate));
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);

	await harness.runCommand("confirm");

	assert.deepEqual(harness.observedUserMessageCalls, [{ content: "confirm", options: { deliverAs: "followUp" } }]);
	assert.equal(harness.reenteredFollowUpEvents.length, 1, "預期 confirm 會重新進入共用 input 路徑");
	assert.deepEqual(harness.reenteredFollowUpEvents[0]?.event, { text: "confirm" });
	assert.equal((harness.reenteredFollowUpEvents[0]?.result as { action?: string }).action, "transform");
	const nextInvocation = (harness.reenteredFollowUpEvents[0]?.result as { text?: string }).text ?? "";
	assert.match(nextInvocation, /grill-2/);
	assert.match(nextInvocation, new RegExp(escapeRegExp(manifestCandidate)));
	assert.match(nextInvocation, /User answered decision "confirm" with "confirm"\./);
	assert.doesNotMatch(nextInvocation, /DEEP_KNOWLEDGE_RETRIEVAL|KNOWLEDGE_UNDERSTANDING/);
});

test("Extension_WhenUiSelectAvailable_ShouldUseSelectorToResumeWaitUser", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	const harness = await createExtensionHarness({ cwd: rootDir, reenterFollowUps: true });
	const manifestCandidate = await startFormalGrillRound(rootDir, harness.sendInput);

	await harness.runCommand(formalWaitUserCommand(manifestCandidate), {
		ui: {
			notify() {},
			async select(title: string, options: string[]) {
				selectCalls.push({ title, options });
				return options.find((option) => option === "confirm");
			},
		},
	});

	assert.equal(selectCalls.length, 1, "Expected ctx.ui.select to be called once");
	assert.match(selectCalls[0]?.title ?? "", /Proceed to deep knowledge retrieval\?/);
	assert.deepEqual(selectCalls[0]?.options ?? [], ["confirm", "reject", "自行輸入…"]);
	assert.deepEqual(harness.observedUserMessageCalls, [{ content: "confirm", options: { deliverAs: "followUp" } }]);
	assert.equal(harness.reenteredFollowUpEvents.length, 1, "預期 selector 會剛好一次重新進入共用 input 路徑");
	assert.deepEqual(harness.reenteredFollowUpEvents[0]?.event, { text: "confirm" });
	assert.equal((harness.reenteredFollowUpEvents[0]?.result as { action?: string }).action, "transform");
	const nextInvocation = (harness.reenteredFollowUpEvents[0]?.result as { text?: string }).text ?? "";
	assert.match(nextInvocation, /grill-2/);
	assert.match(nextInvocation, new RegExp(escapeRegExp(manifestCandidate)));
	assert.doesNotMatch(nextInvocation, /DEEP_KNOWLEDGE_RETRIEVAL|KNOWLEDGE_UNDERSTANDING/);
});

test("Extension_WhenSelectorCannotFollowUp_ShouldRemainWaitUser", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	const harness = await createExtensionHarness({ cwd: rootDir, withoutFollowUpBridge: true });
	const manifestCandidate = await startFormalGrillRound(rootDir, harness.sendInput);

	await harness.runCommand(formalWaitUserCommand(manifestCandidate), {
		ui: {
			notify() {},
			async select(title: string, options: string[]) {
				selectCalls.push({ title, options });
				return "confirm";
			},
		},
	});

	assert.equal(selectCalls.length, 1, "Expected ctx.ui.select to be called once");
	assert.match(selectCalls[0]?.title ?? "", /Proceed to deep knowledge retrieval\?/);
	assert.deepEqual(selectCalls[0]?.options ?? [], ["confirm", "reject", "自行輸入…"]);
	assert.deepEqual(harness.observedUserMessageCalls, []);
	assert.equal(harness.reenteredFollowUpEvents.length, 0);
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
});

test("Extension_WhenConfirmWithoutWaitUser_ShouldRejectResume", async () => {
	const { default: forgeRuntimeExtension } = await import("../../extensions/forge-runtime.ts");
	const commands = new Map<string, RegisteredCommand>();
	const observedOutputs: string[] = [];

	const fakePi = {
		registerCommand(name: string, options: RegisteredCommand) {
			commands.set(name, options);
		},
		sendMessage(message: { content?: unknown; display?: unknown; customType?: unknown }) {
			observedOutputs.push(String(message.content ?? message.display ?? message.customType ?? ""));
		},
	};

	await forgeRuntimeExtension(fakePi as never);

	const command = commands.get("forge-runtime");
	assert.ok(command, "Expected forge-runtime extension to register a public 'forge-runtime' command");

	await command.handler("confirm", {});

	assert.notEqual(observedOutputs.at(-1), "DEEP_KNOWLEDGE_RETRIEVAL");
	assert.match(observedOutputs.join("\n"), /WAIT_USER|cannot|reject|confirm/i);
});

test("Extension_WhenWaitUser_ShouldPublishPanelAndStatus", async () => {
	const { default: forgeRuntimeExtension } = await import("../../extensions/forge-runtime.ts");
	const commands = new Map<string, RegisteredCommand>();
	const observedOutputs: string[] = [];
	const observedStatuses: string[] = [];

	const fakePi = {
		registerCommand(name: string, options: RegisteredCommand) {
			commands.set(name, options);
		},
		sendMessage(message: { content?: unknown; display?: unknown; customType?: unknown }) {
			observedOutputs.push(`${String(message.display ?? "")}\n${String(message.content ?? "")}\n${String(message.customType ?? "")}`);
		},
	};

	await forgeRuntimeExtension(fakePi as never);

	const command = commands.get("forge-runtime");
	assert.ok(command, "Expected forge-runtime extension to register a public 'forge-runtime' command");

	await command.handler(`grill ambiguous ${waitUserPayload}`, {
		ui: {
			notify() {},
			setStatus(status: string) {
				observedStatuses.push(status);
			},
		},
	} as never);

	assert.match(observedStatuses.join("\n"), /WAIT_USER/, "Expected WAIT_USER status to be published");

	const renderedPanel = observedOutputs.join("\n");
	assert.match(renderedPanel, /WAIT_USER/);
	assert.match(renderedPanel, /recommendation/i);
	assert.match(renderedPanel, /evidence/i);
	assert.match(renderedPanel, /confirm/i);
});

test("Extension_WhenWaitUserPayloadProvided_ShouldRenderPayloadValues", async () => {
	const { default: forgeRuntimeExtension } = await import("../../extensions/forge-runtime.ts");
	const commands = new Map<string, RegisteredCommand>();
	const observedMessagePayloads: Array<{ content?: unknown; display?: unknown; customType?: unknown }> = [];

	const fakePi = {
		registerCommand(name: string, options: RegisteredCommand) {
			commands.set(name, options);
		},
		sendMessage(message: { content?: unknown; display?: unknown; customType?: unknown }) {
			observedMessagePayloads.push(message);
		},
	};

	await forgeRuntimeExtension(fakePi as never);

	const command = commands.get("forge-runtime");
	assert.ok(command, "Expected forge-runtime extension to register a public 'forge-runtime' command");

	await command.handler(`grill ambiguous ${waitUserPayload}`, {});

	const payload = observedMessagePayloads.find((message) => message.display === true);
	assert.ok(payload, "Expected a visible raw panel payload");
	assert.equal(payload.display, true);
	assert.match(String(payload.content), /Proceed to deep knowledge retrieval\?/);
	assert.match(String(payload.content), /confirm/i);
	assert.match(String(payload.content), /EV-4242/);
});

test("Extension_WhenStructuredGrillResultProvided_ShouldRenderWaitUserFromResult", async () => {
	const { default: forgeRuntimeExtension } = await import("../../extensions/forge-runtime.ts");
	const commands = new Map<string, RegisteredCommand>();
	const observedMessages: string[] = [];
	const structuredGrillResult = JSON.stringify({
		status: "NEEDS_CONFIRMATION",
		questions: [
			{
				id: "q-1",
				question: "Should we accept Plan A?",
				options: ["accept", "revise"],
			},
		],
		recommendation: {
			value: "accept",
			reason: "Evidence supports Plan A.",
			confidence: 0.82,
		},
		evidence: ["EV-9000"],
		requiresUserConfirmation: true,
	});

	const fakePi = {
		registerCommand(name: string, options: RegisteredCommand) {
			commands.set(name, options);
		},
		sendMessage(message: { content?: unknown; display?: unknown; customType?: unknown }) {
			observedMessages.push(`${String(message.display ?? "")}\n${String(message.content ?? "")}\n${String(message.customType ?? "")}`);
		},
	};

	await forgeRuntimeExtension(fakePi as never);

	const command = commands.get("forge-runtime");
	assert.ok(command, "Expected forge-runtime extension to register a public 'forge-runtime' command");

	await command.handler(`grill-result ${structuredGrillResult}`, {});

	const renderedMessage = observedMessages.join("\n");
	assert.match(renderedMessage, /WAIT_USER/);
	assert.match(renderedMessage, /Should we accept Plan A\?/);
	assert.match(renderedMessage, /accept/);
	assert.match(renderedMessage, /EV-9000/);
});

test("Extension_WhenStructuredGrillResultIsReadyForDeep_ShouldContinueWithoutWaitUser", async () => {
	const { default: forgeRuntimeExtension } = await import("../../extensions/forge-runtime.ts");
	const commands = new Map<string, RegisteredCommand>();
	const observedMessages: string[] = [];
	const structuredGrillResult = JSON.stringify({
		status: "READY_FOR_DEEP",
		questions: [],
		recommendation: {
			value: "proceed",
			reason: "Signals are aligned enough to continue.",
			confidence: 0.88,
		},
		evidence: ["EV-9002"],
		requiresUserConfirmation: false,
	});

	const fakePi = {
		registerCommand(name: string, options: RegisteredCommand) {
			commands.set(name, options);
		},
		sendMessage(message: { content?: unknown; display?: unknown; customType?: unknown }) {
			observedMessages.push(`${String(message.display ?? "")}\n${String(message.content ?? "")}\n${String(message.customType ?? "")}`);
		},
	};

	await forgeRuntimeExtension(fakePi as never);

	const command = commands.get("forge-runtime");
	assert.ok(command, "Expected forge-runtime extension to register a public 'forge-runtime' command");

	await command.handler(`grill-result ${structuredGrillResult}`, {});

	const renderedMessage = observedMessages.join("\n");
	assert.match(renderedMessage, /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.match(renderedMessage, /KNOWLEDGE_UNDERSTANDING/);
	assert.doesNotMatch(renderedMessage, /WAIT_USER/);
});

test("Extension_WhenRelevanceGateHasNoCandidates_ShouldStopBeforeDeepKnowledge", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const { sendInput, runCommand, observedMessages } = await createExtensionHarness({ cwd: rootDir });

	const transformResult = await sendInput("請幫我壓測方案 A");
	assert.equal((transformResult as { action?: string }).action, "transform");

	await runCommand(`grill-result ${readyForDeepGrillResult}`);

	const renderedMessage = observedMessages.join("\n");
	assert.match(renderedMessage, /WAIT_USER/);
	assert.match(renderedMessage, /候選相關性不足|來源|範圍/);
	assert.doesNotMatch(renderedMessage, /DEEP_KNOWLEDGE_RETRIEVAL/);
});

test("Extension_WhenGrillRunTriggered_ShouldInvokeGrillingSkill", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/grill-run-alias.ts",
		"// GrillRunAliasNeedle makes the alias enter a controlled formal round.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const { default: forgeRuntimeExtension } = await import("../../extensions/forge-runtime.ts");
	const commands = new Map<string, RegisteredCommand>();
	const eventHandlers = new Map<string, RegisteredEventHandler>();
	let activeTools = ["bash"];

	const fakePi = {
		registerCommand(name: string, options: RegisteredCommand) {
			commands.set(name, options);
		},
		registerTool() {},
		getActiveTools() {
			return activeTools;
		},
		setActiveTools(toolNames: string[]) {
			activeTools = toolNames;
		},
		on(eventName: string, handler: RegisteredEventHandler) {
			eventHandlers.set(eventName, handler);
		},
	};

	await forgeRuntimeExtension(fakePi as never);
	assert.equal(commands.has("grill-run"), false, "grill-run should run through input transform, not extension command fast path");
	const inputHandler = eventHandlers.get("input");
	assert.ok(inputHandler, "Expected input handler to be registered for grill flow");

	const result = await inputHandler(
		{ text: "/grill-run 請幫我測試 GrillRunAliasNeedle grill-run-alias.ts" },
		{ cwd: rootDir },
	);

	assert.equal(eventHandlers.has("message_end"), true, "Expected message_end handler to be registered for grill flow");
	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	assert.match((result as { text?: string }).text ?? "", /<skill name="grilling"/);
	const invocation = (result as { text?: string }).text ?? "";
	assert.match(invocation, /任務：請幫我測試 GrillRunAliasNeedle grill-run-alias\.ts/);
	assert.match(invocation, /roundId\s*[:：]\s*grill-1/);
	assert.match(invocation, /\bev-[0-9a-f]{64}\b/);
});

test("Extension_WhenIdleAndEngineeringRequest_ShouldTransformIntoForgeFlow", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput("請幫我壓測方案 A");

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	assert.match((result as { text?: string }).text ?? "", /<skill name="grilling"/);
	assert.match((result as { text?: string }).text ?? "", /任務：請幫我壓測方案 A/);
});

test("Extension_WhenKnowledgeWikiMissing_ShouldStopStartForgeAndAskForConsent", async (t) => {
	const rootDir = createTempRoot({ withWiki: false });
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput(knowledgeBoundaryRequest);

	assert.deepEqual(result, { action: "handled" });
	const warning = harness.observedNotifications.at(-1) ?? "";
	assert.match(warning, /wiki/i);
	assert.match(warning, /缺少|missing/i);
	assert.match(warning, /是否|accept|繼續/i);
});

test("Extension_WhenKnowledgeCodeBaseMissing_ShouldStopStartForgeAndAskForConsent", async (t) => {
	const rootDir = createTempRoot({ withCodeBase: false });
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput(knowledgeBoundaryRequest);

	assert.deepEqual(result, { action: "handled" });
	const warning = harness.observedNotifications.at(-1) ?? "";
	assert.match(warning, /code_base/i);
	assert.match(warning, /缺少|missing/i);
	assert.match(warning, /是否|accept|繼續/i);
});

test("Extension_WhenKnowledgeAssetsExist_ShouldKeepStartForgePathUsingInjectedRoot", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput(knowledgeBoundaryRequest);

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	assert.match((result as { text?: string }).text ?? "", /<skill name="grilling"/);
	assert.match((result as { text?: string }).text ?? "", new RegExp(tempRootEvidence));
});

test("Extension_WhenGrillInvocationIsBuilt_ShouldExposeRuntimeIssuedRoundIdAndCompletionContract", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/invocation-contract-candidate.ts",
		"// InvocationContractNeedle is the candidate used by the Grill completion contract.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput("請幫我測試 InvocationContractNeedle invocation-contract-candidate.ts");

	assert.equal((result as { action?: string }).action, "transform");
	const text = (result as { text?: string }).text ?? "";
	assert.match(text, /roundId\s*[:：]\s*grill-1/);
	assert.match(text, /forge_grill_evidence/);
	assert.match(text, /forge_grill_complete/);
	assert.match(text, /completion payload/i);
	assert.match(text, /roundId.*原樣|原樣.*roundId/s);
	assert.match(text, /\bev-[0-9a-f]{64}\b/);
});

test("CodeBase_WhenSeedsMatchFiles_ShouldReturnCandidates", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/search-panel.ts",
		[
			"// Search panel renders WidgetNeedle results for operators.",
			"// It highlights the top code base candidates for review.",
			'export const widgetNeedlePanel = "ready";',
		].join("\n"),
	);
	writeWorkspaceFile(
		rootDir,
		"code_base/src/search-adapter.ts",
		[
			"// Operator adapter normalizes WidgetNeedle queries.",
			"// It keeps the lookup narrow before deeper retrieval.",
			"export function adaptWidgetNeedle() {}",
		].join("\n"),
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput("請幫我測試 WidgetNeedle search-panel.ts search-adapter.ts");

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	const text = (result as { text?: string }).text ?? "";
	assert.match(text, /search-panel\.ts/i);
	assert.match(text, /Search panel renders WidgetNeedle results for operators\./i);
	assert.match(text, /search-adapter\.ts/i);
	assert.match(text, /Operator adapter normalizes WidgetNeedle queries\./i);
});

test("CodeBase_WhenCandidateHasMultipleIndependentSignals_ShouldExplainWhyRelevant", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/widget-relevance-panel.ts",
		[
			"// WidgetNeedle support lives here for the operator search flow.",
			"// This panel also documents why the candidate is relevant.",
			'export const widgetRelevancePanel = "ready";',
		].join("\n"),
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput("請幫我測試 WidgetNeedle widget-relevance-panel.ts");

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	const text = (result as { text?: string }).text ?? "";
	assert.match(text, /widget-relevance-panel\.ts/i);
	assert.match(text, /Why Relevant|Signals Matched/i);
});

test("CodeBase_WhenStrongestCandidateExists_ShouldRenderSinglePatternCard", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/strongest-widget-pattern.ts",
		[
			"// WidgetNeedle search flow entry point for operators.",
			"// This candidate explains why the pattern is relevant to the request.",
			"// It is the strongest match for a single pattern card render.",
			'export const strongestWidgetPattern = "ready";',
		].join("\n"),
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput("請幫我測試 WidgetNeedle strongest-widget-pattern.ts");

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	const text = (result as { text?: string }).text ?? "";
	assert.equal(text.match(/Pattern Card/gi)?.length ?? 0, 1);
	assert.match(text, /Pattern Card/i);
	assert.match(text, /Pattern Name/i);
	assert.match(text, /Why Relevant/i);
	assert.match(text, /Key File/i);
	assert.match(text, /strongest-widget-pattern\.ts/i);
});

test("CodeBase_WhenOnlySingleWeakPathSignalHits_ShouldNotEmitDeepDiveCandidate", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/widget-only-name.ts",
		[
			"// Unrelated maintenance note.",
			"// No supporting content signal should make this a deep-dive candidate.",
			"export const unrelatedMaintenance = true;",
		].join("\n"),
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput("請幫我測試 widget-only-name.ts");

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	const text = (result as { text?: string }).text ?? "";
	assert.doesNotMatch(text, /code_base\/src\/widget-only-name\.ts/i);
	assert.doesNotMatch(text, /deep-dive candidate/i);
});

test("CodeBase_WhenStrongCandidatesExist_ShouldNotMixInWeakSingleSignalMatch", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/search-widget-panel.ts",
		[
			"// Search panel renders WidgetNeedle results for operators.",
			"// It is the main candidate for the search workflow.",
			'export const searchWidgetPanel = "ready";',
		].join("\n"),
	);
	writeWorkspaceFile(
		rootDir,
		"code_base/src/search-widget-adapter.ts",
		[
			"// Search adapter normalizes WidgetNeedle queries for operators.",
			"// It keeps the candidate set narrow before deeper retrieval.",
			"export function adaptSearchWidget() {}",
		].join("\n"),
	);
	writeWorkspaceFile(
		rootDir,
		"code_base/src/widget-stray.ts",
		[
			"// Billing cron fallback.",
			"// This should stay out of the search candidate summary.",
			"export const billingCronFallback = true;",
		].join("\n"),
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput(
		"請幫我測試 WidgetNeedle widget search-widget-panel.ts search-widget-adapter.ts",
	);

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	const text = (result as { text?: string }).text ?? "";
	assert.match(text, /search-widget-panel\.ts/i);
	assert.match(text, /search-widget-adapter\.ts/i);
	assert.doesNotMatch(text, /widget-stray\.ts/i);
	assert.doesNotMatch(text, /Billing cron fallback\./i);
});

test("CodeBase_WhenNoFilesMatch_ShouldKeepWikiOnlySummary", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/unrelated-cache.ts",
		[
			"// Cache warmup for another subsystem.",
			"// This file should not appear for BoundaryToken discovery.",
			"export const unrelatedCache = true;",
		].join("\n"),
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput(knowledgeBoundaryRequest);

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	const text = (result as { text?: string }).text ?? "";
	assert.match(text, new RegExp(tempRootEvidence));
	assert.doesNotMatch(text, /unrelated-cache\.ts/i);
	assert.doesNotMatch(text, /Cache warmup for another subsystem\./i);
});

test("Conflict_WhenSameRelativePathDiffers_ShouldStop", async (t) => {
	const rootDir = createTempRoot();
	const relativePath = "src/conflict-target.ts";
	const targetSourcePath = writeWorkspaceFile(rootDir, relativePath, 'export const answer = "target";\n');
	const codeBasePath = writeWorkspaceFile(rootDir, `code_base/${relativePath}`, 'export const answer = "code-base";\n');
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput(`請幫我修 ${relativePath} 的錯誤`);

	assert.deepEqual(result, { action: "handled" });
	const warning = harness.observedNotifications.at(-1) ?? "";
	assert.match(warning, /衝突|conflict/i);
	assert.match(warning, /src[\\/]conflict-target\.ts/i);
	assert.match(warning, new RegExp(escapeRegExp(targetSourcePath)));
	assert.match(warning, new RegExp(escapeRegExp(codeBasePath)));
});

test("CodeBase_WhenConflictExists_ShouldStillStopFirst", async (t) => {
	const rootDir = createTempRoot();
	const relativePath = "src/conflict-first.ts";
	writeWorkspaceFile(rootDir, relativePath, 'export const state = "target";\n');
	writeWorkspaceFile(rootDir, `code_base/${relativePath}`, 'export const state = "code-base";\n');
	writeWorkspaceFile(
		rootDir,
		"code_base/src/widget-needle.ts",
		[
			"// WidgetNeedle candidate that should stay hidden behind the conflict gate.",
			"// If this shows up, LIGHT_DISCOVERY ran too early.",
			"export const widgetNeedle = true;",
		].join("\n"),
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput("請幫我修 src/conflict-first.ts WidgetNeedle 的錯誤");

	assert.deepEqual(result, { action: "handled" });
	const warning = harness.observedNotifications.at(-1) ?? "";
	assert.match(warning, /衝突|conflict/i);
	assert.match(warning, /src[\\/]conflict-first\.ts/i);
	assert.doesNotMatch(warning, /widget-needle\.ts/i);
	assert.doesNotMatch(warning, /LIGHT_DISCOVERY ran too early\./i);
});

test("Conflict_WhenRelativePathMatchesAndContentSame_ShouldContinue", async (t) => {
	const rootDir = createTempRoot();
	const relativePath = "src/shared-target.ts";
	const content = 'export const shared = "same";\n';
	writeWorkspaceFile(rootDir, relativePath, content);
	writeWorkspaceFile(rootDir, `code_base/${relativePath}`, content);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput(`請幫我測試 ${relativePath}`);

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	assert.match((result as { text?: string }).text ?? "", /<skill name="grilling"/);
	assert.equal(harness.observedNotifications.length, 0);
});

test("Conflict_WhenDifferentPathsDiffer_ShouldIgnore", async (t) => {
	const rootDir = createTempRoot();
	const relativePath = "src/real-target.ts";
	writeWorkspaceFile(rootDir, relativePath, 'export const target = "live";\n');
	writeWorkspaceFile(rootDir, "code_base/docs/real-target.ts", 'export const target = "code-base";\n');
	writeWorkspaceFile(rootDir, "code_base/src/other-target.ts", 'export const target = "other";\n');
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput(`請幫我修 ${relativePath} 的錯誤`);

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	assert.match((result as { text?: string }).text ?? "", /<skill name="grilling"/);
	assert.equal(harness.observedNotifications.length, 0);
});

test("TargetMismatch_WhenStrongestCandidateHasNoMatchingTargetPath_ShouldRenderTargetGapAndContinue", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/strong-gap-widget.ts",
		[
			"// StrongGapNeedle search flow entry point for operators.",
			"// This is the strongest candidate and has no matching target path.",
			'export const strongGapWidget = "code-base";',
		].join("\n"),
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput("請幫我測試 StrongGapNeedle strong-gap-widget.ts");

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	const text = (result as { text?: string }).text ?? "";
	assert.match(text, /Target Gap/i);
	assert.match(text, /strong-gap-widget\.ts/i);
});

test("TargetMismatch_WhenStrongestCandidateMatchesTargetPathButContentDiffers_ShouldStopWithTargetConflict", async (t) => {
	const rootDir = createTempRoot();
	const relativePath = "src/strong-conflict-widget.ts";
	writeWorkspaceFile(rootDir, relativePath, 'export const strongConflictWidget = "target";\n');
	writeWorkspaceFile(
		rootDir,
		`code_base/${relativePath}`,
		[
			"// StrongConflictNeedle search flow entry point for operators.",
			"// This is the strongest candidate and should stop on target mismatch.",
			'export const strongConflictWidget = "code-base";',
		].join("\n"),
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput(`請幫我測試 StrongConflictNeedle ${relativePath}`);

	assert.deepEqual(result, { action: "handled" });
	const warning = harness.observedNotifications.at(-1) ?? "";
	assert.match(warning, /Target Conflict/i);
	assert.match(warning, /src[\\/]strong-conflict-widget\.ts/i);
});

test("TargetMismatch_WhenStrongestCandidateIsGap_ShouldNotBeBlockedByWeakerConflict", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/priority-gap-widget.ts",
		[
			"// PriorityGapNeedle flow owns the primary operator search path.",
			"// This is the strongest candidate and should be reported as a target gap.",
			"// Additional matching signals keep it ahead of weaker candidates.",
			'export const priorityGapWidget = "code-base";',
		].join("\n"),
	);
	writeWorkspaceFile(rootDir, "src/weaker-conflict-widget.ts", 'export const weakerConflictWidget = "target";\n');
	writeWorkspaceFile(
		rootDir,
		"code_base/src/weaker-conflict-widget.ts",
		[
			"// WeakConflictNeedle is a secondary candidate only.",
			'export const weakerConflictWidget = "code-base";',
		].join("\n"),
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput(
		"請幫我測試 PriorityGapNeedle priority-gap-widget.ts weaker-conflict-widget.ts",
	);

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	const text = (result as { text?: string }).text ?? "";
	assert.match(text, /Target Gap/i);
	assert.match(text, /priority-gap-widget\.ts/i);
	assert.doesNotMatch(text, /Target Conflict/i);
	assert.equal(harness.observedNotifications.length, 0);
});

test("Extension_WhenIdleAndChitChat_ShouldContinue", async () => {
	const { default: forgeRuntimeExtension } = await import("../../extensions/forge-runtime.ts");
	const eventHandlers = new Map<string, (message: unknown) => Promise<unknown> | unknown>();

	const fakePi = {
		registerCommand() {},
		on(eventName: string, handler: (message: unknown) => Promise<unknown> | unknown) {
			eventHandlers.set(eventName, handler);
		},
	};

	await forgeRuntimeExtension(fakePi as never);
	const inputHandler = eventHandlers.get("input");
	assert.ok(inputHandler, "Expected input handler to be registered for front-door routing");

	const result = await inputHandler({ text: "今天天氣如何？" });

	assert.deepEqual(result, { action: "continue" });
});

test("Extension_WhenCustomWaitUserFactoryRuns_ShouldRenderAndSubmitTrimmedAnswer", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir });
	const manifestCandidate = await startFormalGrillRound(rootDir, harness.sendInput);
	let customCalls = 0;

	await harness.runCommand(formalWaitUserCommand(manifestCandidate), {
		ui: {
			async select() {
				return "自行輸入…";
			},
			async custom(...args: unknown[]) {
				customCalls += 1;
				const factory = args[0] as (...args: unknown[]) => Promise<{
					render(width: number): void;
					handleInput(input: string): void;
				}>;
				const fakeTui = { requestRender() {}, terminal: { rows: 24 } };
				const hostTheme = { fg(_token: unknown, text: string) { return text; } };
				const keybindings = {};
				let doneValue = "";
				const done = (value: string) => {
					doneValue = value;
				};
				const editor = await Reflect.apply(factory, undefined, [fakeTui, hostTheme, keybindings, done]);
				editor.render(80);
				editor.handleInput("  自訂回答  ");
				editor.handleInput("\r");
				return doneValue;
			},
		},
	});

	assert.equal(harness.observedUserMessageCalls.at(-1)?.content, "自訂回答");
	assert.equal(customCalls, 1);
});

test("Extension_WhenCustomWaitUserFactoryReceivesBlankThenEscape_ShouldReturnToSelectorWithoutDecision", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir });
	const manifestCandidate = await startFormalGrillRound(rootDir, harness.sendInput);
	let selectCalls = 0;
	let customCalls = 0;

	await harness.runCommand(formalWaitUserCommand(manifestCandidate), {
		ui: {
			async select() {
			selectCalls += 1;
			if (selectCalls === 2) {
				assert.equal(harness.observedUserMessageCalls.length, 0);
			}
				return selectCalls === 1 ? "自行輸入…" : "confirm";
			},
			async custom(...args: unknown[]) {
				customCalls += 1;
				const factory = args[0] as (...args: unknown[]) => Promise<{
					render(width: number): void;
					handleInput(input: string): void;
				}>;
				const fakeTui = { requestRender() {}, terminal: { rows: 24 } };
				const hostTheme = { fg(_token: unknown, text: string) { return text; } };
				const keybindings = {};
				let doneCalls = 0;
				let doneValue: unknown;
				const done = (value: unknown) => {
					doneCalls += 1;
					doneValue = value;
				};
				const editor = await Reflect.apply(factory, undefined, [fakeTui, hostTheme, keybindings, done]);
				editor.render(80);
				editor.handleInput("   ");
				editor.handleInput("\r");
				assert.equal(doneCalls, 0);
				editor.handleInput("\x1b");
				assert.equal(doneCalls, 1);
				assert.equal(doneValue, undefined);
				return doneValue;
			},
		},
	});

	assert.equal(selectCalls, 2);
	assert.equal(customCalls, 1);
	assert.equal(harness.observedUserMessageCalls.length, 1);
	assert.equal(harness.observedUserMessageCalls[0]?.content, "confirm");
});

test("Extension_WhenWaitUserOptionCannotResume_ShouldKeepWaitUserAndCloseSelector", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir, withoutFollowUpBridge: true });
	const manifestCandidate = await startFormalGrillRound(rootDir, harness.sendInput);
	let selectorCalls = 0;

	await assert.doesNotReject(
		harness.runCommand(formalWaitUserCommand(manifestCandidate), {
			ui: {
				async select() {
					selectorCalls += 1;
					if (selectorCalls === 1) return "confirm";
					throw new Error("selector reopened");
				},
			},
		}),
	);

	assert.equal(selectorCalls, 1);
	assert.equal(harness.observedUserMessageCalls.length, 0);
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.match(harness.observedMessages.at(-1) ?? "", /Proceed to deep knowledge retrieval\?/);
});

test("Extension_WhenWaitUserAndShortConfirmation_ShouldResumeExistingWorkflow", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir });
	const manifestCandidate = await startFormalGrillRound(rootDir, harness.sendInput);
	await harness.runCommand(formalWaitUserCommand(manifestCandidate));
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);

	const result = await harness.sendInput("好");

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	const nextInvocation = (result as { text?: string }).text ?? "";
	assert.match(nextInvocation, /grill-2/);
	assert.match(nextInvocation, new RegExp(escapeRegExp(manifestCandidate)));
	assert.match(nextInvocation, /User answered decision "confirm" with "confirm"\./);
	assert.notEqual(nextInvocation, "/forge-runtime confirm");
});

test("Extension_WhenRecreatedWaitUserDecisionWasAlreadyAnswered_ShouldKeepWaitUserWithoutReplayOrNewRound", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir });
	const manifestCandidate = await startFormalGrillRound(rootDir, harness.sendInput);

	await harness.runCommand(formalWaitUserCommand(manifestCandidate));
	const firstAnswer = await harness.sendInput("confirm");
	assert.equal((firstAnswer as { action?: string }).action, "transform");
	assert.match((firstAnswer as { text?: string }).text ?? "", /roundId\s*[:：]\s*grill-2/);

	await harness.runCommand(formalWaitUserCommand(manifestCandidate));
	const safeWaitUserStatus = harness.observedStatuses.at(-1);
	const followUpCount = harness.observedUserMessageCalls.length;
	const duplicateAnswer = await harness.sendInput("confirm");

	assert.deepEqual(duplicateAnswer, { action: "handled" });
	assert.equal(harness.observedUserMessageCalls.length, followUpCount, "重複回答不得送出 followUp");
	assert.equal(harness.observedStatuses.at(-1), safeWaitUserStatus, "重複回答必須維持原 WAIT_USER safe state");

	await harness.runCommand("continue");
	const replay = harness.observedUserMessageCalls.at(-1);
	assert.equal(replay?.options?.deliverAs, "followUp");
	assert.match(replay?.content ?? "", /roundId\s*[:：]\s*grill-2/);
	assert.doesNotMatch(replay?.content ?? "", /roundId\s*[:：]\s*grill-[3-9]/);
});

test("Extension_WhenWaitUserAnswerComesFromSelectorOrCommand_ShouldFollowUpThroughSharedInputAndStartNextRound", async (t) => {
	for (const row of [
		{ source: "selector", answer: "B", command: undefined },
		{ source: "confirm", answer: "A", command: "confirm" },
		{ source: "reject", answer: "reject", command: "reject" },
	]) {
		const rootDir = createTempRoot();
		writeWorkspaceFile(
			rootDir,
			"code_base/src/search-panel.ts",
			[
				"// Search panel renders WidgetNeedle results for operators.",
				"// It highlights the top code base candidates for review.",
				'export const widgetNeedlePanel = "ready";',
			].join("\n"),
		);
		writeWorkspaceFile(
			rootDir,
			"code_base/src/search-adapter.ts",
			[
				"// Search adapter links WidgetNeedle requests to the panel.",
				"// It gives the code base candidate another independent signal.",
				'export const widgetNeedleAdapter = "ready";',
			].join("\n"),
		);
		t.after(() => {
			rmSync(rootDir, { force: true, recursive: true });
		});

		const harness = await createExtensionHarness({ cwd: rootDir, reenterFollowUps: true } as { cwd: string });
		const firstRound = await harness.sendInput("請幫我測試 WidgetNeedle search-panel.ts search-adapter.ts");
		const firstInvocation = (firstRound as { text?: string }).text ?? "";
		const manifestCandidate = firstInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
		assert.match(firstInvocation, /grill-1/);
		assert.ok(manifestCandidate, "Expected the natural ingress Grill invocation to expose a manifest candidate");

		const waitUser = `grill ambiguous ${JSON.stringify({
			question: "Which answer should start the next Grill round?",
			recommendation: "A",
			options: ["A", "B"],
			evidenceIds: [manifestCandidate],
			decisionSummary: "Need the user answer before the next Grill round.",
		})}`;
		await harness.runCommand(
			waitUser,
			row.source === "selector"
				? {
						ui: {
							async select() {
								return row.answer;
							},
						},
					}
				: {},
		);
		if (row.command) {
			await harness.runCommand(row.command);
		}

		assert.deepEqual(harness.observedUserMessageCalls, [
			{ content: row.answer, options: { deliverAs: "followUp" } },
		]);

		const reenteredFollowUpEvents = (
			harness as typeof harness & {
				reenteredFollowUpEvents?: Array<{
					event: { text: string };
					result: { action?: string; text?: string };
				}>;
			}
		).reenteredFollowUpEvents;
		assert.equal(reenteredFollowUpEvents?.length, 1, "Expected exactly one followUp to re-enter the shared input path");
		assert.deepEqual(reenteredFollowUpEvents?.[0]?.event, { text: row.answer });
		assert.equal(reenteredFollowUpEvents?.[0]?.result.action, "transform");

		const nextInvocation = reenteredFollowUpEvents?.[0]?.result.text ?? "";
		assert.match(nextInvocation, /grill-2/);
		assert.match(nextInvocation, new RegExp(escapeRegExp(manifestCandidate)));
		assert.match(nextInvocation, /forge_grill_evidence 只接受 manifest 中的 candidateId/);
		assert.match(nextInvocation, /完成時必須呼叫 forge_grill_complete；completion payload 必須原樣包含此 roundId/);
		assert.match(
			nextInvocation,
			new RegExp(escapeRegExp(`User answered decision "unknown" with ${JSON.stringify(row.answer)}.`)),
		);
		assert.equal(harness.observedStatuses.filter((status) => status.includes("LIGHT_DISCOVERY")).length, 1);
		assert.match(harness.observedStatuses.at(-1) ?? "", /GRILL/);
	}
});

test("Extension_WhenUserApprovesMissingKnowledgeAssets_ShouldResumePendingRequest", async (t) => {
	const rootDir = createTempRoot({ withCodeBase: false });
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	await harness.sendInput(knowledgeBoundaryRequest);

	const result = await harness.sendInput("好");

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	assert.match((result as { text?: string }).text ?? "", /<skill name="grilling"/);
	assert.match((result as { text?: string }).text ?? "", /任務：請幫我測試 BoundaryToken/);
});

test("Extension_WhenGrillResultDebugCommandReceivesStructuredResult_ShouldPublishWaitUser", async () => {
	const structuredGrillResult = JSON.stringify({
		status: "NEEDS_CONFIRMATION",
		questions: [
			{
				id: "q-3",
				question: "是否接受方案 A？",
				options: ["accept", "revise"],
			},
		],
		recommendation: {
			value: "accept",
			reason: "現有證據支持方案 A。",
			confidence: 0.91,
		},
		evidence: ["EV-7777"],
		requiresUserConfirmation: true,
	});

	const { observedMessages, runCommand } = await createExtensionHarness();
	await runCommand(`grill-result ${structuredGrillResult}`);

	const renderedMessage = observedMessages.join("\n");
	assert.match(renderedMessage, /WAIT_USER/);
	assert.match(renderedMessage, /是否接受方案 A？/);
	assert.match(renderedMessage, /accept/);
	assert.match(renderedMessage, /EV-7777/);
});

test("Extension_WhenForgeInputTransformsPrompt_ShouldKeepOriginalUserTranscript", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const { messageEndHandler, sendInput } = await createExtensionHarness({ cwd: rootDir });
	assert.ok(messageEndHandler, "Expected message_end handler to be registered for grill flow");

	const originalText = "請幫我壓測方案 A";
	const transformResult = await sendInput(originalText);
	assert.equal((transformResult as { action?: string }).action, "transform");

	const transformedPrompt = (transformResult as { text?: string }).text ?? "";
	assert.match(transformedPrompt, /forge_grill_evidence/);
	assert.match(transformedPrompt, /forge_grill_complete/);
	assert.match(transformedPrompt, /不得輸出 assistant prose/);
	assert.doesNotMatch(transformedPrompt, /請只輸出一個最阻塞的確認問題/);

	const result = await messageEndHandler({
		message: {
			role: "user",
			content: [{ type: "text", text: transformedPrompt }],
		},
	});

	assert.equal(typeof result, "object");
	assert.ok(result && "message" in (result as object), "Expected transformed user message to be rewritten");
	const rewrittenText = (
		(result as {
			message: {
				content?: Array<{ type?: string; text?: string }>;
			};
		}).message.content?.[0]?.text ?? ""
	);
	assert.equal(rewrittenText, originalText);
	assert.doesNotMatch(rewrittenText, /請只輸出一個最阻塞的確認問題/);
});

test("Extension_WhenStructuredGrillResultStreams_ShouldSuppressAssistantTextDuringMessageUpdate", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const { sendInput, messageUpdateHandler } = await createExtensionHarness({ cwd: rootDir });
	assert.ok(messageUpdateHandler, "Expected message_update handler to be registered for grill flow");

	await startFormalGrillRound(rootDir, sendInput);

	const event = {
		message: {
			role: "assistant",
			content: [{ type: "text", text: switchGrillResult }],
		},
	};

	await messageUpdateHandler(event);

	assert.doesNotMatch(JSON.stringify(event.message), /NEEDS_CONFIRMATION|Should we switch to Plan B\?|EV-SWITCH/);
	assert.equal(event.message.content[0]?.text, "");
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
