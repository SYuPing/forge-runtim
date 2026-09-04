import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";

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
		isError?: boolean;
		terminate?: boolean;
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

type RuntimeIssuedIdentity = {
	attemptId: string;
	sourceRoundId: string;
	phase: "DEEP_KNOWLEDGE_RETRIEVAL" | "KNOWLEDGE_UNDERSTANDING";
};

const waitUserPayload = JSON.stringify({
	question: "Proceed to deep knowledge retrieval?",
	recommendation: "confirm",
	options: ["confirm", "reject"],
	evidenceIds: ["EV-4242"],
	roundId: "grill-1",
	decisionId: "debug-confirmation",
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
const emptyDiscoveryExploratoryConsentQuestion = "目前沒有可用的知識文件，是否同意以人類前提進行探索性開發？";
const emptyDiscoveryExploratoryConsentId = "forge-empty-snapshot-exploratory-consent";

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

test("Extension_WhenProjectCwdIsMissing_ShouldFailClosedWithoutStartingWorkflow", async () => {
	const harness = await createExtensionHarness({ initialActiveTools: ["read"] });

	const result = await harness.sendInput("請幫我建立這個專案的規範");

	assert.deepEqual(result, { action: "handled" });
	assert.ok(
		harness.observedNotifications.some((message) => /project root|cwd|專案根目錄|工作目錄/i.test(message)),
		"缺少 project root/cwd 時必須明確通知",
	);
	assert.deepEqual(harness.getActiveTools(), ["read"]);
	assert.equal(
		harness.observedStatuses.some((status) => /GRILL|DEEP|CONTEXT|ADR/i.test(status)),
		false,
		"缺少 project root/cwd 時不得進入工作流",
	);
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

test("Integration_WhenActiveToolsCapabilityDisappearsBeforeReadyForDeep_ShouldFailClosed", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-capability-loss-evidence", { candidateId }, undefined, undefined, harness.buildContext());

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to expose execute");
	harness.disableSetActiveTools();
	const completionResult = await completionTool.execute(
		"call-capability-loss-completion",
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

	assert.equal(completionResult.details.status, "rejected");
	assert.match(harness.observedStatuses.at(-1) ?? "", /GRILL/);
	assert.doesNotMatch(harness.observedMessages.join("\n"), /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.deepEqual(harness.getActiveTools().sort(), ["forge_grill_complete", "forge_grill_evidence"]);
	assert.ok(harness.observedNotifications.some((message) => /安全|拒絕|限制/.test(message)));
});

test("Integration_WhenActiveToolsCapabilityDisappearsBeforeStaleDeepRetrieval_ShouldRejectStaleOutcome", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	const evidenceExecute = evidenceTool?.execute;
	assert.ok(evidenceExecute, "Expected forge_grill_evidence to expose execute");
	await evidenceExecute("call-stale-capability-evidence", { candidateId }, undefined, undefined, harness.buildContext());

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	const completionExecute = completionTool?.execute;
	assert.ok(completionExecute, "Expected forge_grill_complete to expose execute");
	await completionExecute(
		"call-stale-capability-completion",
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

	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	const retrievalExecute = retrievalTool?.execute;
	assert.ok(retrievalExecute, "Expected forge_deep_retrieval_complete to expose execute");
	const beforeStatus = harness.observedStatuses.at(-1);
	const beforeTools = harness.getActiveTools();
	harness.disableSetActiveTools();
	for (const outcome of [{ kind: "completed" as const }, { kind: "needs_discovery" as const }]) {
		const result = await retrievalExecute(
			"call-stale-capability-outcome",
			{
				attemptId: "deep-stale",
				sourceRoundId: "grill-1",
				phase: "DEEP_KNOWLEDGE_RETRIEVAL",
				outcome,
			},
			undefined,
			undefined,
			harness.buildContext(),
		);
		assert.equal(result.details.status, "stale");
		assert.equal(result.terminate, true);
		assert.equal(harness.observedStatuses.at(-1), beforeStatus);
		assert.deepEqual(harness.getActiveTools(), beforeTools);
	}
});

test("Extension_WhenRelevanceGateFails_ShouldDisplayScopeQuestionAndEnterWaitUser", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"wiki/relevanceonlyneedle.md",
		"RelevanceOnlyNeedle is documentary evidence, without a code_base candidate for deep knowledge.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	let selectorTitle = "";
	let selectorOptions: string[] = [];
	const startResult = await harness.sendInput("請幫我測試 RelevanceOnlyNeedle");
	assert.equal((startResult as { action?: string }).action, "transform");
	assert.doesNotMatch((startResult as { text?: string }).text ?? "", /RelevanceOnlyNeedle is documentary evidence/);
	const candidateId = extractManifestCandidate(startResult);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-relevance-evidence", { candidateId }, undefined, undefined, harness.buildContext());
	await harness.runCommand(
		`grill-result ${JSON.stringify({
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "先嘗試進入 deep。", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
			roundId: "grill-1",
		})}`,
		{ ui: { async select(title, options) { selectorTitle = title; selectorOptions = options; return undefined; } } },
	);
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.doesNotMatch(harness.observedMessages.join("\n"), /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.deepEqual(
		await harness.toolCallHandler?.({ type: "tool_call", toolCallId: "call-relevance-read", toolName: "read", input: {} }),
		{ block: true },
	);
	assert.match(selectorTitle, /候選相關性不足|relevance gate/i);
	assert.ok(selectorOptions.length > 0);
});

test("Extension_WhenRelevanceWaitUserReceivesConfirm_ShouldKeepClarificationPending", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"wiki/relevanceconfirmneedle.md",
		"RelevanceConfirmNeedle is documentary evidence, without a code_base candidate for deep knowledge.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const startResult = await harness.sendInput("請幫我測試 RelevanceConfirmNeedle");
	assert.equal((startResult as { action?: string }).action, "transform");
	const candidateId = extractManifestCandidate(startResult);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute(
		"call-relevance-confirm-evidence",
		{ candidateId },
		undefined,
		undefined,
		harness.buildContext(),
	);
	await harness.runCommand(
		`grill-result ${JSON.stringify({
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "先嘗試進入 deep。", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
			roundId: "grill-1",
		})}`,
	);

	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	const userMessageCount = harness.observedUserMessageCalls.length;
	const statusCountBeforeConfirm = harness.observedStatuses.length;

	await harness.runCommand("confirm");

	assert.equal(harness.observedUserMessageCalls.length, userMessageCount, "相關性澄清不得自動送出 recommendation");
	assert.equal(harness.observedStatuses.at(-1)?.includes("WAIT_USER"), true, "confirm 後必須維持 WAIT_USER");
	assert.equal(
		harness.observedStatuses.slice(statusCountBeforeConfirm).some((status) => status.includes("DEEP_KNOWLEDGE_RETRIEVAL")),
		false,
		"相關性澄清不得進入 Deep",
	);
	assert.equal(
		harness.observedStatuses.slice(statusCountBeforeConfirm).some((status) => /GRILL/.test(status)),
		false,
		"相關性澄清不得建立新的 Grill round",
	);
	assert.equal(harness.observedNotifications.at(-1), "目前等待相關性澄清，請補充可信來源或縮小需求範圍。");
});

test("Extension_WhenNormalConfirmationIdCollidesWithRoundId_ShouldStillFollowUpOnConfirm", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	await harness.runCommand(
		`grill ambiguous ${JSON.stringify({
			question: "是否採用一般方案？",
			decisionId: "grill-1",
			roundId: "grill-1",
			recommendation: "採用",
			options: ["採用", "拒絕"],
			evidenceIds: [candidateId],
			decisionSummary: "等待一般確認。",
		})}`,
	);

	await harness.runCommand("confirm");

	assert.equal(harness.observedUserMessageCalls.length, 1, "一般確認仍應送出 followUp");
	assert.doesNotMatch(harness.observedNotifications.at(-1) ?? "", /相關性澄清/);
});

test("Extension_WhenGrillAmbiguousDecisionIdIsMissing_ShouldRejectAtTrustBoundary", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	await startFormalGrillRound(rootDir, harness.sendInput);

	for (const decisionId of [undefined, "   "]) {
		const payload = {
			question: "是否採用一般方案？",
			roundId: "grill-1",
			...(decisionId === undefined ? {} : { decisionId }),
			recommendation: "採用",
			options: ["採用", "拒絕"],
			evidenceIds: [],
			decisionSummary: "等待一般確認。",
		};
		await assert.rejects(() => harness.runCommand(`grill ambiguous ${JSON.stringify(payload)}`), /WAIT_USER payload 必須包含 decisionId。/);
	}
});

test("Extension_WhenRawGrillAmbiguousKindClaimsRelevance_ShouldKeepNormalConfirmation", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);

	await harness.runCommand(
		`grill ambiguous ${JSON.stringify({
			kind: "relevance_clarification",
			question: "是否採用一般方案？",
			decisionId: "raw-kind-normal-confirmation",
			roundId: "grill-1",
			recommendation: "採用",
			options: ["採用", "拒絕"],
			evidenceIds: [candidateId],
			decisionSummary: "等待一般確認。",
		})}`,
	);

	await harness.runCommand("confirm");

	assert.equal(harness.observedUserMessageCalls.length, 1, "raw kind 不得改變普通 Grill follow-up");
	assert.doesNotMatch(harness.observedNotifications.at(-1) ?? "", /相關性澄清/);
});

test("Extension_WhenGrillAmbiguousRoundWasNotIssuedByRuntime_ShouldReject", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);

	await assert.rejects(
		harness.runCommand(
			`grill ambiguous ${JSON.stringify({
				question: "是否採用一般方案？",
				decisionId: "unissued-round-decision",
				roundId: "grill-999",
				recommendation: "採用",
				options: ["採用", "拒絕"],
				evidenceIds: [candidateId],
				decisionSummary: "拒絕未由 runtime 發出的 round。",
			})}`,
		),
		/roundId|active round|issued/i,
	);
});

test("Extension_WhenNormalConfirmationIdCollidesWithRoundId_ShouldRejectReadyForDeepReplay", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute(
		"call-normal-confirmation-replay-evidence",
		{ candidateId },
		undefined,
		undefined,
		harness.buildContext(),
	);
	await harness.runCommand(
		`grill ambiguous ${JSON.stringify({
			question: "是否採用一般方案？",
			decisionId: "grill-1",
			roundId: "grill-1",
			recommendation: "採用",
			options: ["採用", "拒絕"],
			evidenceIds: [candidateId],
			decisionSummary: "等待一般確認。",
		})}`,
	);

	await harness.runCommand(
		`grill-result ${JSON.stringify({
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "不得跳過一般確認。", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
			roundId: "grill-1",
		})}`,
	);

	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.doesNotMatch(harness.observedMessages.join("\n"), /DEEP_KNOWLEDGE_RETRIEVAL/);
});

test("Extension_WhenRelevanceFailureIsReenteredAfterUiReturns_ShouldRepublishTheSameWaitUserPanel", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"wiki/relevancereentryneedle.md",
		"RelevanceReentryNeedle is documentary evidence, without a code_base candidate for deep knowledge.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const startResult = await harness.sendInput("請幫我測試 RelevanceReentryNeedle");
	assert.equal((startResult as { action?: string }).action, "transform");
	const candidateId = extractManifestCandidate(startResult);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-relevance-reentry-evidence", { candidateId }, undefined, undefined, harness.buildContext());

	const readyForDeepResult = JSON.stringify({
		status: "READY_FOR_DEEP",
		questions: [],
		recommendation: { value: "proceed", reason: "先嘗試進入 deep。", confidence: 0.9 },
		evidence: [candidateId],
		requiresUserConfirmation: false,
		roundId: "grill-1",
	});
	await harness.runCommand(`grill-result ${readyForDeepResult}`);
	await assert.doesNotReject(() => harness.runCommand(`grill-result ${readyForDeepResult}`));

	const relevanceWaitUserStatuses = harness.observedStatusCalls.filter((call) => call.text?.includes("WAIT_USER"));
	assert.equal(relevanceWaitUserStatuses.length, 2, "UI 返回後同一 pending decisionId 的 relevance WAIT_USER 狀態可再次發布");
});

test("Extension_WhenRelevanceWaitUserReceivesClarification_ShouldRediscoverAndStartNextGrillSnapshot", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"wiki/relevanceclarificationneedle.md",
		"RelevanceClarificationNeedle is documentary evidence, without a code_base candidate for deep knowledge.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const goal = "請幫我測試 RelevanceClarificationNeedle";
	const harness = await createExtensionHarness({ cwd: rootDir });
	const firstRound = await harness.sendInput(goal);
	assert.equal((firstRound as { action?: string }).action, "transform");
	const candidateId = extractManifestCandidate(firstRound);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-relevance-clarification-evidence", { candidateId }, undefined, undefined, harness.buildContext());
	await harness.runCommand(
		`grill-result ${JSON.stringify({
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "先嘗試進入 deep。", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
			roundId: "grill-1",
		})}`,
	);
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);

	writeWorkspaceFile(
		rootDir,
		"code_base/src/relevance-clarification-candidate.ts",
		"// RelevanceClarificationNeedle plus ClarificationSupplement now supplies a relevant code candidate.\n",
	);
	const statusCountBeforeClarification = harness.observedStatuses.length;
	const clarification = "補充可信來源 ClarificationSupplement relevance-clarification-candidate.ts";
	const nextRound = await harness.sendInput(clarification);
	const nextInvocation = (nextRound as { text?: string }).text ?? "";

	assert.equal((nextRound as { action?: string }).action, "transform");
	assert.ok(
		harness.observedStatuses.slice(statusCountBeforeClarification).some((status) => status.includes("LIGHT_DISCOVERY")),
		"relevance clarification 應先重新進入 LIGHT_DISCOVERY",
	);
	assert.match(nextInvocation, /roundId\s*[:：]\s*grill-2/);
	assert.match(nextInvocation, new RegExp(escapeRegExp(goal)));
	assert.match(nextInvocation, /ClarificationSupplement/);
	assert.match(nextInvocation, /relevance-clarification-candidate\.ts/);
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

	assert.deepEqual(await harness.sendInput("同意"), { action: "handled" });
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

test("Extension_WhenNaturalIngressBuildsGrillInvocation_ShouldPassRawMessageThroughDiscovery", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/forge-runtime.ts", "const rawMessageCandidate = true;\n");
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const userMessage = "請處理 `src/forge-runtime.ts` PROJ-123 PROJ-123 中英MixedToken 中英MixedToken alpha beta gamma delta epsilon zeta eta theta";
	const result = await harness.sendInput(userMessage);
	const invocation = (result as { text?: string }).text ?? "";
	assert.match(invocation, new RegExp(escapeRegExp(userMessage)));
	assert.match(invocation, /code_base\/src\/forge-runtime\.ts/);
	assert.doesNotMatch(invocation, /rawMessageCandidate/);
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

test("Extension_WhenCompletionNeedsConfirmation_ShouldTerminateToolTurnAndEnterWaitUser", async (t) => {
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
	const completionResult = await completionTool.execute(
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
	assert.equal(completionResult.terminate, true);
	assert.equal(harness.observedStatusCalls.at(-1)?.key, "forge-runtime");
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.deepEqual(harness.getActiveTools(), ["forge_grill_evidence", "forge_grill_complete"]);

});

test("Extension_WhenPanelIsEmitted_ShouldUseVisibleContentContract", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	await startFormalGrillRound(rootDir, harness.sendInput);
	await harness.runCommand(`grill ambiguous ${waitUserPayload}`);

	const statusCall = harness.observedStatusCalls.at(-1);
	assert.equal(statusCall?.key, "forge-runtime");
	assert.equal(statusCall?.text, "Forge WAIT_USER [waiting-user]");
	assert.equal(
		harness.observedMessagePayloads.some((payload) => payload.customType === "forge-stage"),
		false,
		"WAIT_USER 不得送出 provider-facing forge-stage 訊息",
	);
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
	assert.match(nextInvocation, /使用者已回答決策 "q-answer-next-round"："confirm"。/);
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
		{ answer: "  我想先採用 B，因為它較符合目前風險  ", label: "自由文字" },
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
		assert.ok(resumeText.includes(answer.trim()), `${label} 應記錄 trim 後答案在下一個 Grill invocation`);
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
	assert.doesNotMatch(replay?.content ?? "", /使用者已回答決策/);
	assert.doesNotMatch(replay?.content ?? "", /roundId\s*[:：]\s*grill-[2-9]/);
	assert.deepEqual((replay?.content ?? "").match(/\bev-[0-9a-f]{64}\b/g), [candidateId]);
});

test("Extension_WhenCompletionSucceeds_ShouldTerminateAtToolBoundary", async (t) => {
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
	const completionResult = await completionTool.execute(
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

	assert.equal(completionResult.terminate, true);
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
});

test("Extension_WhenReadyCompletionExitsGrill_ShouldTerminateToolTurnAndEnterDeepKnowledge", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/ready-completion-evidence-candidate.ts",
		"// ReadyCompletionNeedle is available for this Grill deep knowledge transition.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read", "write"], reenterFollowUps: true });
	const startResult = await harness.sendInput("請幫我測試 ReadyCompletionNeedle ready-completion-evidence-candidate.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-ready-evidence", { candidateId }, undefined, undefined, {});

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to expose execute");
	const completionResult = await completionTool.execute(
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
	assert.equal(completionResult.terminate, true);

	assert.match(harness.observedStatuses.at(-1) ?? "", /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.doesNotMatch(harness.observedMessages.join("\n"), /KNOWLEDGE_UNDERSTANDING/);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);

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

test("Integration_WhenDeepSearchUsesAllowedSources_ShouldReturnAtMostThreeEvidence", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"wiki/deep-search-allowed.md",
		"DeepSearchAllowedNeedle is allowed wiki evidence for Deep Retrieval.",
	);
	writeWorkspaceFile(
		rootDir,
		"code_base/src/deep-search-seed.ts",
		"// DeepSearchAllowedNeedle supplies the Grill snapshot seed.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DeepSearchAllowedNeedle deep-search-seed.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-deep-search-grill-evidence", { candidateId }, undefined, undefined, {});

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to expose execute");
	await completionTool.execute(
		"call-deep-search-grill-completion",
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
		{},
	);

	const deepSearchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(deepSearchTool?.execute, "Expected forge_deep_search to be registered after entering Deep Retrieval");
	const deepSearchValidator = Compile(deepSearchTool.parameters as TSchema);
	const deepSearchArgs = {
		attemptId: "deep-1",
		sourceRoundId: "grill-1",
		phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		query: "DeepSearchAllowedNeedle",
	};
	assert.ok(
		deepSearchValidator.Check({ ...deepSearchArgs, source: "wiki" }),
		"forge_deep_search schema must accept wiki source",
	);
	assert.ok(
		deepSearchValidator.Check({ ...deepSearchArgs, source: "code_base" }),
		"forge_deep_search schema must accept code_base source",
	);
	assert.ok(
		deepSearchValidator.Check({ ...deepSearchArgs, source: "target", targetSource: "docs/target.md" }),
		"forge_deep_search schema must accept target source with targetSource",
	);
	const searchResult = await deepSearchTool.execute(
		"call-deep-search",
		{ ...deepSearchArgs, source: "wiki" },
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(searchResult.details.status, "accepted");
	const evidence = searchResult.details.evidence;
	assert.ok(Array.isArray(evidence), "Deep search should return evidence in details");
	assert.ok(evidence.length > 0, "Deep search should return at least one evidence item");
	assert.ok(evidence.length <= 3, "Deep search should return at most three evidence items");
});

test("Integration_WhenDeepSearchRoundExceedsTwoMiB_ShouldRejectWithoutMutation", async (t) => {
	const rootDir = createTempRoot();
	const inheritedContent = "// DeepBudgetGroupOne is the immutable Grill snapshot seed for the byte budget test.\n";
	const maxEvidenceBytes = 256 * 1024;
	const roundByteLimit = 2 * 1024 * 1024;
	const inheritedBytes = Buffer.byteLength(inheritedContent, "utf8");
	const supplementalSizes = [
		maxEvidenceBytes,
		maxEvidenceBytes,
		maxEvidenceBytes,
		maxEvidenceBytes,
		maxEvidenceBytes,
		maxEvidenceBytes,
		maxEvidenceBytes,
		roundByteLimit - inheritedBytes - maxEvidenceBytes * 7,
	];
	assert.equal(inheritedBytes + supplementalSizes.reduce((total, size) => total + size, 0), roundByteLimit);
	assert.ok(supplementalSizes.every((size) => size > 0 && size <= maxEvidenceBytes));
	const exactEvidenceContent = (marker: string, bytes: number): string => {
		const markerBytes = Buffer.byteLength(marker, "utf8");
		return `${marker}\n${"X".repeat(bytes - markerBytes - 1)}`;
	};
	for (const evidenceFile of [
		["DeepBudgetGroupOne", "budget-1.md", supplementalSizes[0]],
		["DeepBudgetGroupOne", "budget-2.md", supplementalSizes[1]],
		["DeepBudgetGroupOne", "budget-3.md", supplementalSizes[2]],
		["DeepBudgetGroupTwo", "budget-4.md", supplementalSizes[3]],
		["DeepBudgetGroupTwo", "budget-5.md", supplementalSizes[4]],
		["DeepBudgetGroupTwo", "budget-6.md", supplementalSizes[5]],
		["DeepBudgetGroupThree", "budget-7.md", supplementalSizes[6]],
		["DeepBudgetGroupThree", "budget-8.md", supplementalSizes[7]],
		["DeepBudgetGroupFour", "budget-9.md", 128],
	] as const) {
		const [group, file, bytes] = evidenceFile;
		const content = exactEvidenceContent(`${group} ${file}`, bytes);
		assert.equal(Buffer.byteLength(content, "utf8"), bytes);
		writeWorkspaceFile(rootDir, `wiki/${file}`, content);
	}
	writeWorkspaceFile(
		rootDir,
		"code_base/src/deep-budget-seed.ts",
		inheritedContent,
	);
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"], reenterFollowUps: true });
	const startResult = await harness.sendInput("請幫我測試 DeepBudgetGroupOne deep-budget-seed.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to be registered");
	await evidenceTool.execute("call-deep-budget-grill-evidence", { candidateId }, undefined, undefined, harness.buildContext());

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to be registered");
	await completionTool.execute(
		"call-deep-budget-grill-complete",
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
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);

	const deepSearchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(deepSearchTool?.execute, "Expected forge_deep_search to be registered after entering Deep Retrieval");
	const deepSearchExecute = deepSearchTool.execute;
	assert.ok(deepSearchExecute);
	const search = async (callId: string, query: string) => {
		const result = await deepSearchExecute(
			callId,
			{
				attemptId: "deep-1",
				sourceRoundId: "grill-1",
				phase: "DEEP_KNOWLEDGE_RETRIEVAL",
				query,
				source: "wiki",
			},
			undefined,
			undefined,
			harness.buildContext(),
		);
		assert.equal(result.details.status, "accepted");
		const evidence = result.details.evidence;
		assert.ok(Array.isArray(evidence));
		for (const item of evidence as Array<{ content: string }>) {
			assert.ok(Buffer.byteLength(item.content, "utf8") > 0);
			assert.ok(Buffer.byteLength(item.content, "utf8") <= maxEvidenceBytes);
		}
		return evidence as Array<{ evidenceId: string; content: string }>;
	};

	const lockedEvidence = [
		...(await search("call-deep-budget-search-1", "DeepBudgetGroupOne")),
		...(await search("call-deep-budget-search-2", "DeepBudgetGroupTwo")),
		...(await search("call-deep-budget-search-3", "DeepBudgetGroupThree")),
	];
	assert.equal(lockedEvidence.length, 8);
	assert.equal(
		inheritedBytes + lockedEvidence.reduce((total, item) => total + Buffer.byteLength(item.content, "utf8"), 0),
		roundByteLimit,
	);
	assert.equal(harness.observedStatuses.at(-1)?.includes("DEEP_KNOWLEDGE_RETRIEVAL"), true);
	const statusCount = harness.observedStatuses.length;
	const messageCount = harness.observedMessages.length;
	const activeTools = harness.getActiveTools();

	const rejectedResult = await deepSearchTool.execute(
		"call-deep-budget-search-4",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			query: "DeepBudgetGroupFour",
			source: "wiki",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(rejectedResult.details.status, "rejected");
	assert.equal(rejectedResult.details.reason, "evidence_round_too_large");
	assert.deepEqual(rejectedResult.details.evidence, []);
	assert.equal(harness.observedStatuses.length, statusCount);
	assert.equal(harness.observedMessages.length, messageCount);
	assert.deepEqual(harness.getActiveTools(), activeTools);

	const retrievalCompleteTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalCompleteTool?.execute, "Expected forge_deep_retrieval_complete to be registered");
	const retrievalResult = await retrievalCompleteTool.execute(
		"call-deep-budget-retrieval-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(retrievalResult.details.status, "accepted");
	assert.deepEqual(retrievalResult.details.lockedEvidenceIds, [candidateId, ...lockedEvidence.map((item) => item.evidenceId)]);
	assert.equal((retrievalResult.details.lockedEvidenceIds as string[]).length, 9);
});

test("Integration_WhenGrillEvidenceExceeds256KiB_ShouldRejectWithoutMutation", async (t) => {
	const rootDir = createTempRoot({ withWiki: false });
	const maxEvidenceBytes = 256 * 1024;
	const exactEvidenceContent = (marker: string, bytes: number): string => {
		const content = `${marker}${"X".repeat(bytes - marker.length)}`;
		assert.equal(Buffer.byteLength(content, "utf8"), bytes);
		return content;
	};
	writeWorkspaceFile(
		rootDir,
		"code_base/src/grill-limit-ok.ts",
		exactEvidenceContent("GrillEvidenceLimitNeedle grill-limit-ok.ts ", maxEvidenceBytes),
	);
	writeWorkspaceFile(
		rootDir,
		"wiki/grill-limit-over.md",
		exactEvidenceContent("GrillEvidenceLimitNeedle grill-limit-over.ts ", maxEvidenceBytes + 1),
	);
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"], reenterFollowUps: true });
	const startResult = await harness.sendInput(
		"請幫我測試 GrillEvidenceLimitNeedle grill-limit-ok.ts grill-limit-over.md",
	);
	const invocation = (startResult as { text?: string }).text ?? "";
	const candidateIds = [...new Set([...invocation.matchAll(/\bev-[0-9a-f]{64}\b/g)].map((match) => match[0]))];
	assert.ok(candidateIds.length >= 2, "Expected both Grill evidence candidates in the immutable snapshot");
	const candidateIdFor = (relativePath: string): string => {
		const manifestLine = invocation.split(/\r?\n/).find((line) => line.includes(relativePath));
		const candidateId = manifestLine?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
		assert.ok(candidateId, `Expected manifest candidate for ${relativePath}`);
		return candidateId;
	};
	const acceptedCandidateId = candidateIdFor("grill-limit-ok.ts");
	const oversizedCandidateId = candidateIdFor("grill-limit-over.md");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to be registered");
	const accepted = await evidenceTool.execute(
		"call-grill-limit-accepted",
		{ candidateId: acceptedCandidateId },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(accepted.details.candidateId, acceptedCandidateId);
	assert.equal(Buffer.byteLength(accepted.content[0]?.text ?? "", "utf8"), maxEvidenceBytes);

	const statusCountBeforeOversized = harness.observedStatuses.length;
	const messageCountBeforeOversized = harness.observedMessages.length;
	const activeToolsBeforeOversized = harness.getActiveTools();
	const oversized = await evidenceTool.execute(
		"call-grill-limit-oversized",
		{ candidateId: oversizedCandidateId },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(oversized.details.status, "rejected");
	assert.equal(oversized.details.reason, "evidence_too_large");
	assert.deepEqual(oversized.details.evidence, []);
	assert.equal(harness.observedStatuses.length, statusCountBeforeOversized);
	assert.equal(harness.observedMessages.length, messageCountBeforeOversized);
	assert.deepEqual(harness.getActiveTools(), activeToolsBeforeOversized);

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to be registered");
	await completionTool.execute(
		"call-grill-limit-complete",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "合法證據已通過 byte limit", confidence: 0.9 },
			evidence: [acceptedCandidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);

	const retrievalCompleteTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalCompleteTool?.execute, "Expected forge_deep_retrieval_complete to be registered");
	const retrievalResult = await retrievalCompleteTool.execute(
		"call-grill-limit-retrieval-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(retrievalResult.details.status, "accepted");
	assert.deepEqual(retrievalResult.details.lockedEvidenceIds, [acceptedCandidateId]);
	assert.equal((retrievalResult.details.lockedEvidenceIds as string[]).includes(oversizedCandidateId), false);
});

test("Integration_WhenTargetSourceIsAmbiguous_ShouldNeedDecision", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/target-a.ts",
		"// TargetAmbiguousNeedle code-base candidate A.\nexport const targetA = \"code-base\";\n",
	);
	writeWorkspaceFile(
		rootDir,
		"code_base/src/target-b.ts",
		"// TargetAmbiguousNeedle code-base candidate B.\nexport const targetB = \"code-base\";\n",
	);
	writeWorkspaceFile(
		rootDir,
		"src/target-a.ts",
		"// TargetAmbiguousNeedle target source A.\nexport const targetA = \"target\";\n",
	);
	writeWorkspaceFile(
		rootDir,
		"src/target-b.ts",
		"// TargetAmbiguousNeedle target source B.\nexport const targetB = \"target\";\n",
	);
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput(
		"請幫我測試 TargetAmbiguousNeedle src/target-a.ts src/target-b.ts",
	);
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-target-ambiguity-grill-evidence", { candidateId }, undefined, undefined, harness.buildContext());

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to expose execute");
	await completionTool.execute(
		"call-target-ambiguity-grill-completion",
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

	const deepSearchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(deepSearchTool?.execute, "Expected forge_deep_search to be registered after entering Deep Retrieval");
	const searchResult = await deepSearchTool.execute(
		"call-target-ambiguity-search",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			query: "TargetAmbiguousNeedle",
			source: "target",
			targetSource: "src/missing-target.ts",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(searchResult.details.status, "needs_decision");
	assert.deepEqual(searchResult.details.options, ["src/target-a.ts", "src/target-b.ts"]);
	assert.deepEqual(searchResult.details.evidenceIds, [candidateId]);
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.match(harness.observedStatuses.join("\n"), /WAIT_USER/);
	assert.deepEqual(harness.getActiveTools(), ["read"]);
	assert.equal(harness.getActiveTools().some((toolName) => toolName.startsWith("forge_deep_")), false);
});

test("Extension_DeepSearchTargetWithoutTargetSource_ShouldRejectBeforeBudgetAndKeepAttempt", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"src/target.ts",
		"// TargetSourceRequiredNeedle is the only allowed target source.\nexport const target = true;\n",
	);
	writeWorkspaceFile(
		rootDir,
		"code_base/src/target.ts",
		"// TargetSourceRequiredNeedle provides the formal Grill seed.\n",
	);
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const deepSearchDefinition = harness.registeredTools.get("forge_deep_search");
	assert.ok(deepSearchDefinition?.parameters, "Expected forge_deep_search to expose its public schema");
	const deepSearchSchema = Compile(deepSearchDefinition.parameters as TSchema);
	const identityAndQuery = {
		attemptId: "deep-1",
		sourceRoundId: "grill-1",
		phase: "DEEP_KNOWLEDGE_RETRIEVAL" as const,
		query: "TargetSourceRequiredNeedle",
	};
	assert.equal(
		deepSearchSchema.Check({ ...identityAndQuery, source: "target" }),
		false,
		"target source must require a non-empty targetSource",
	);
	assert.equal(
		deepSearchSchema.Check({ ...identityAndQuery, source: "target", targetSource: "src/target.ts" }),
		true,
		"target source with a non-empty targetSource must be valid",
	);
	for (const source of ["wiki", "code_base"] as const) {
		assert.equal(
			deepSearchSchema.Check({ ...identityAndQuery, source }),
			true,
			`${source} must not require targetSource`,
		);
	}
	const startResult = await harness.sendInput(
		"請幫我測試 TargetSourceRequiredNeedle target-source-seed.ts src/target.ts",
	);
	const invocation = (startResult as { text?: string }).text ?? "";
	const candidateId = invocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	const targetCandidateId = invocation
		.split(/\r?\n/)
		.find((line) => line.includes("[target]") && line.includes("(target/src/target.ts)"))
		?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");
	assert.ok(targetCandidateId, "Expected the target manifest to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to be registered");
	await evidenceTool.execute("call-target-source-required-grill-evidence", { candidateId: targetCandidateId }, undefined, undefined, harness.buildContext());

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to be registered");
	await completionTool.execute(
		"call-target-source-required-grill-completion",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "候選已通過相關性 gate", confidence: 0.9 },
			evidence: [targetCandidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	const deepSearchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(deepSearchTool?.execute, "Expected forge_deep_search to be registered after entering Deep Retrieval");
	const invalidResult = await deepSearchTool.execute(
		"call-target-source-required-missing-source",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			query: "TargetSourceRequiredNeedle",
			source: "target",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(invalidResult.details.status, "invalid");
	assert.equal(invalidResult.details.retryable, true);
	assert.equal(invalidResult.details.reason, "target_source_required");

	const retryResult = await deepSearchTool.execute(
		"call-target-source-required-retry",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			query: "TargetSourceRequiredNeedle",
			source: "target",
			targetSource: "src/target.ts",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(retryResult.details.status, "accepted");
	assert.deepEqual(retryResult.details.evidence, []);
	assert.deepEqual(retryResult.details.reusedEvidenceIds, [targetCandidateId]);
});

test("Extension_DeepCompleteCompletedSchema_ShouldRequireKnowledgeSummaryAndRejectEvidenceIds", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const deepCompleteTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(deepCompleteTool?.parameters, "Expected forge_deep_complete to expose its public schema");
	const validator = Compile(deepCompleteTool.parameters as TSchema);
	const completedInput = {
		attemptId: "deep-1",
		sourceRoundId: "grill-1",
		phase: "KNOWLEDGE_UNDERSTANDING" as const,
		outcome: {
			kind: "completed" as const,
			decisions: [],
			findings: [],
			limitations: [],
		},
	};

	assert.equal(validator.Check(completedInput), false, "completed outcome must require knowledgeSummary");
	assert.equal(
		validator.Check({
			...completedInput,
			outcome: { ...completedInput.outcome, knowledgeSummary: "已驗證的知識摘要" },
		}),
		true,
		"completed outcome must accept a knowledgeSummary",
	);
	assert.equal(
		validator.Check({
			...completedInput,
			outcome: {
				...completedInput.outcome,
				knowledgeSummary: "已驗證的知識摘要",
				evidenceIds: [],
			},
		}),
		false,
		"completed outcome must reject model-authored evidenceIds",
	);
});

async function prepareDeepRetrieval(
	rootDir: string,
	name: string,
	marker: string,
	withWiki = false,
	originalGoal?: string,
) {
	writeWorkspaceFile(rootDir, `code_base/src/${name}.ts`, `// ${marker} code base evidence.\n`);
	if (withWiki) writeWorkspaceFile(rootDir, `wiki/${name}.md`, `${marker} wiki evidence.\n`);
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput(originalGoal ?? `請幫我測試 ${marker} ${name}.ts`);
	const invocation = (startResult as { text?: string }).text ?? "";
	const candidateId = invocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute(`call-${name}-evidence`, { candidateId }, undefined, undefined, harness.buildContext());
	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute);
	await completionTool.execute(`call-${name}-complete`, {
		roundId: "grill-1", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	const searchTool = harness.registeredTools.get("forge_deep_search")?.execute;
	assert.ok(searchTool);
	return {
		harness,
		messageEndHandler: harness.messageEndHandler,
		invocation,
		candidateId,
		searchTool,
		identity: { attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL" as const },
	};
}

test("Extension_DeepSearchEmptyTargetManifest_ReturnsRetryableInvalidWithoutWaitUser", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, invocation, searchTool, identity } = await prepareDeepRetrieval(
		rootDir,
		"empty-target-manifest",
		"EmptyTargetManifestNeedle",
	);
	assert.doesNotMatch(invocation, /\[target\]/, "snapshot target manifest must be empty");
	const beforeStatus = harness.observedStatuses.at(-1);
	const emptyTargetSearch = {
		...identity,
		query: "EmptyTargetManifestNeedle",
		source: "target",
		targetSource: "src/not-in-manifest.ts",
	};
	const invalidResult = await searchTool(
		"call-empty-target-manifest-search",
		emptyTargetSearch,
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(invalidResult.details.status, "invalid");
	assert.equal(invalidResult.details.retryable, true);
	assert.equal(invalidResult.details.reason, "target_manifest_empty");
	for (let index = 1; index <= 9; index += 1) {
		const repeatedInvalid = await searchTool(
			`call-empty-target-manifest-budget-${index}`,
			emptyTargetSearch,
			undefined,
			undefined,
			harness.buildContext(),
		);
		assert.equal(repeatedInvalid.details.status, "invalid", `第 ${index} 次重試不得耗盡 search budget`);
		assert.equal(repeatedInvalid.details.reason, "target_manifest_empty");
	}
	assert.equal(harness.observedStatuses.at(-1), beforeStatus);
	assert.doesNotMatch(harness.observedStatuses.join("\n"), /WAIT_USER/);

	const retryResult = await searchTool(
		"call-empty-target-manifest-retry",
		{
			...identity,
			query: "EmptyTargetManifestNeedle",
			source: "code_base",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(retryResult.details.status, "accepted");
});

test("Extension_DeepSearchAfterEmptyTargetManifest_UsesExplicitWikiOnSameAttempt", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, searchTool, identity } = await prepareDeepRetrieval(
		rootDir,
		"empty-target-wiki-retry",
		"EmptyTargetWikiRetryNeedle",
		true,
	);
	const invalid = await searchTool("call-empty-target-wiki-retry-target", {
		...identity, query: "EmptyTargetWikiRetryNeedle", source: "target", targetSource: "src/not-in-manifest.ts",
	}, undefined, undefined, harness.buildContext());
	assert.equal(invalid.details.status, "invalid");
	assert.equal(invalid.details.retryable, true);

	const accepted = await searchTool("call-empty-target-wiki-retry-wiki", {
		...identity, query: "EmptyTargetWikiRetryNeedle", source: "wiki",
	}, undefined, undefined, harness.buildContext());
	assert.equal(accepted.details.status, "accepted");
	assert.equal(accepted.details.attemptId, "deep-1");
	assert.equal(accepted.details.phase, "DEEP_KNOWLEDGE_RETRIEVAL");
	assert.doesNotMatch(harness.observedStatuses.join("\n"), /WAIT_USER/);
});

test("Extension_DeepCompleteDuplicateDecision_ReturnsRetryableInvalidWithoutStateAdvance", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(rootDir, "duplicate-decision");
	const beforeStatus = harness.observedStatuses.at(-1);
	const beforeTools = harness.getActiveTools();
	const unknownEvidence = await understandingTool("call-unknown-evidence-decision", {
		...identity,
		outcome: {
			kind: "completed",
			knowledgeSummary: "測試知識摘要",
			decisions: [{ decisionId: "decision-unknown-evidence", statement: "未知證據決策", evidenceIds: ["ev-unknown"] }],
			findings: [], limitations: [],
		},
	}, undefined, undefined, harness.buildContext());
	assert.equal(unknownEvidence.details.status, "invalid");
	assert.equal(unknownEvidence.details.retryable, undefined);

	const duplicate = await understandingTool("call-duplicate-decision", {
		...identity,
		outcome: {
			kind: "completed",
			knowledgeSummary: "測試知識摘要",
			decisions: [
				{ decisionId: "decision-duplicate", statement: "原始決策", evidenceIds: [candidateId] },
				{ decisionId: "decision-duplicate", statement: "覆寫決策", evidenceIds: [candidateId] },
			],
			findings: [], limitations: [],
		},
	}, undefined, undefined, harness.buildContext());
	assert.equal(duplicate.details.status, "invalid");
	assert.equal(duplicate.details.retryable, true);
	assert.deepEqual(harness.getActiveTools(), beforeTools);
	assert.equal(harness.observedStatuses.at(-1), beforeStatus);
	assert.doesNotMatch(harness.observedStatuses.join("\n"), /CONTEXT_BUILD/);
	assert.equal((duplicate.details.evidencePackage as { decisions: Array<{ statement: string }> }).decisions[0]?.statement, "原始決策");
});

test("Extension_WhenDeepCompleteProvidesOnlyFormalSpecReference_ShouldRejectBeforeContextBuild", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(
		rootDir,
		"formal-spec-reference-only",
	);
	const result = await understandingTool(
		"call-formal-spec-reference-only",
		{
			...identity,
			outcome: {
				kind: "completed",
				knowledgeSummary: "僅提供正式規格參照的測試摘要",
				decisions: [],
				findings: [],
				limitations: [],
				formalSpecReference: {
					target: "test-product-api",
					version: "v1",
					locator: "https://example.test/spec#endpoint",
					evidenceId: candidateId,
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(result.details.status, "invalid");
	assert.deepEqual(result.details.errors, [
		"Evidence metadata 組合不完整：verificationLevel 與 specGap 必須成對；formalSpecReference 僅能搭配 spec_verified。",
	]);
	assert.doesNotMatch([...harness.observedStatuses, ...harness.observedMessages].join("\n"), /CONTEXT_BUILD/);
});

test("Extension_DeepCompleteCorrectedDecision_ReusesAttemptAndEntersContextBuild", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(rootDir, "corrected-decision");
	const duplicate = {
		...identity,
		outcome: {
			kind: "completed" as const,
			knowledgeSummary: "測試知識摘要",
			decisions: [
				{ decisionId: "decision-corrected-duplicate", statement: "原始決策", evidenceIds: [candidateId] },
				{ decisionId: "decision-corrected-duplicate", statement: "重複決策", evidenceIds: [candidateId] },
			],
			findings: [], limitations: [],
		},
	};
	const invalid = await understandingTool("call-corrected-decision-invalid", duplicate, undefined, undefined, harness.buildContext());
	assert.equal(invalid.details.status, "invalid");

	const corrected = await understandingTool("call-corrected-decision-valid", {
		...identity,
		outcome: {
			kind: "completed",
			knowledgeSummary: "測試知識摘要",
			decisions: [{ decisionId: "decision-corrected-unique", statement: "修正後唯一決策", evidenceIds: [candidateId] }],
			findings: [], limitations: [],
		},
	}, undefined, undefined, harness.buildContext());
	assert.equal(corrected.details.status, "accepted");
	assert.deepEqual(
		(corrected.details.evidencePackage as { decisions: Array<{ decisionId: string }> }).decisions.map(
			(decision) => decision.decisionId,
		),
		["decision-corrected-unique"],
	);
	assert.match(harness.observedStatuses.at(-1) ?? "", /CONTEXT_BUILD/);
});

test("Extension_DeepRecoverySequence_ReachesContextBuildWithoutWaitUserLoop", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, searchTool, identity } = await prepareDeepRetrieval(
		rootDir,
		"recovery-sequence",
		"RecoverySequenceNeedle",
		true,
	);
	const targetInvalid = await searchTool("call-recovery-sequence-target", { ...identity, query: "RecoverySequenceNeedle", source: "target", targetSource: "src/missing.ts" }, undefined, undefined, harness.buildContext());
	assert.equal(targetInvalid.details.status, "invalid");
	const wikiAccepted = await searchTool("call-recovery-sequence-wiki", { ...identity, query: "RecoverySequenceNeedle", source: "wiki" }, undefined, undefined, harness.buildContext());
	assert.equal(wikiAccepted.details.status, "accepted");
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	const retrieval = await retrievalTool.execute("call-recovery-sequence-retrieval", { ...identity, outcome: { kind: "completed" } }, undefined, undefined, harness.buildContext());
	assert.equal(retrieval.details.status, "accepted");
	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingTool?.execute);
	const understandingIdentity = { attemptId: "deep-1", sourceRoundId: "grill-1", phase: "KNOWLEDGE_UNDERSTANDING" as const };
	const duplicate = await understandingTool.execute("call-recovery-sequence-duplicate", { ...understandingIdentity, outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions: [{ decisionId: "recovery-duplicate", statement: "A", evidenceIds: [candidateId] }, { decisionId: "recovery-duplicate", statement: "B", evidenceIds: [candidateId] }], findings: [], limitations: [] } }, undefined, undefined, harness.buildContext());
	assert.equal(duplicate.details.status, "invalid");
	const corrected = await understandingTool.execute("call-recovery-sequence-corrected", { ...understandingIdentity, outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions: [{ decisionId: "recovery-unique", statement: "修正後決策", evidenceIds: [candidateId] }], findings: [], limitations: [] } }, undefined, undefined, harness.buildContext());
	assert.equal(corrected.details.status, "accepted");
	assert.match(harness.observedStatuses.at(-1) ?? "", /CONTEXT_BUILD/);
	assert.doesNotMatch(harness.observedStatuses.join("\n"), /WAIT_USER/);
});

async function prepareKnowledgeUnderstanding(rootDir: string, name: string) {
	const marker = `KnowledgeUnderstanding${name}Needle`;
	const { harness, candidateId, identity: retrievalIdentity } = await prepareDeepRetrieval(rootDir, name, marker);
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute(`call-${name}-retrieval`, { ...retrievalIdentity, outcome: { kind: "completed" } }, undefined, undefined, harness.buildContext());
	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	const understandingExecute = understandingTool?.execute;
	assert.ok(understandingExecute);
	return {
		harness,
		candidateId,
		understandingTool: understandingExecute,
		identity: { attemptId: "deep-1", sourceRoundId: "grill-1", phase: "KNOWLEDGE_UNDERSTANDING" as const },
	};
}

test("Extension_DeepCompleteCompletedOutcome_ShouldReturnSummaryAndDerivedEvidenceIds", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(rootDir, "summary-evidence-ids");
	const understandingDefinition = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingDefinition?.parameters, "應公開 forge_deep_complete schema");
	const completedSchema = ((understandingDefinition.parameters as {
		properties: { outcome: { anyOf: Array<{ properties?: Record<string, { const?: string; description?: string }> }> } };
	}).properties.outcome.anyOf.find((branch) => branch.properties?.kind?.const === "completed"));
	assert.match(
		completedSchema?.properties?.knowledgeSummary?.description ?? "",
		/(?=.*僅供人類閱讀)(?=.*非權威)/,
		"knowledgeSummary schema 必須同時標示僅供人類閱讀且非權威",
	);
	const result = await understandingTool(
		"call-summary-evidence-ids",
		{
			...identity,
			outcome: {
				kind: "completed",
				knowledgeSummary: "已驗證的知識摘要",
				decisions: [],
				findings: [],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(result.details.status, "accepted");
	const evidencePackage = result.details.evidencePackage as {
		knowledgeSummary: string;
		evidenceIds: string[];
	};
	assert.equal(evidencePackage.knowledgeSummary, "已驗證的知識摘要");
	assert.deepEqual(evidencePackage.evidenceIds, [candidateId]);
});

test("Extension_WhenDeepCompleteProvidesExploratorySpecGap_ShouldPropagateToEvidencePackage", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(
		rootDir,
		"exploratory-spec-gap",
	);
	const specGap = {
		target: "exploratory-product-api",
		reason: "目前不存在正式知識文件。",
		missingEvidence: ["正式 API 規格"],
		impact: "相容性尚未確認。",
	};
	const understandingDefinition = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingDefinition?.parameters, "Expected public forge_deep_complete parameters");
	const understandingSchema = Compile(understandingDefinition.parameters as TSchema);
	const legalUnderstandingPayload = {
		...identity,
		outcome: {
			kind: "completed" as const,
			knowledgeSummary: "探索性產品開發摘要",
			decisions: [],
			findings: [{ statement: "候選支持目前判斷。", evidenceIds: [candidateId] }],
			limitations: [],
			verificationLevel: "exploratory" as const,
			specGap,
		},
	};
	assert.equal(understandingSchema.Check(legalUnderstandingPayload), true);
	assert.equal(
		understandingSchema.Check({
			...legalUnderstandingPayload,
			outcome: { ...legalUnderstandingPayload.outcome, unknownNested: true },
		}),
		false,
	);

	const result = await understandingTool(
		"call-exploratory-spec-gap",
		legalUnderstandingPayload,
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(result.details.status, "accepted");
	assert.match([...harness.observedStatuses, ...harness.observedMessages].join("\n"), /CONTEXT_BUILD/);
	const evidencePackage = result.details.evidencePackage as {
		verificationLevel?: string;
		specGap?: typeof specGap;
	};
	assert.equal(evidencePackage.verificationLevel, "exploratory");
	assert.deepEqual(evidencePackage.specGap, specGap);
});

test("Extension_WhenEmptySnapshotConsentAndDeepCompleteOmitMetadata_ShouldAddExploratorySpecGap", async (t) => {
	const rootDir = createTempRoot();
	rmSync(join(rootDir, "wiki", "boundary.md"));
	writeWorkspaceFile(rootDir, "code_base/src/unrelated.ts", "export const unrelated = true;\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const roundRequest = "請幫我開始一個全新產品，不存在既有知識文件";
	await harness.sendInput(roundRequest);

	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute(
		"call-empty-discovery-spec-gap",
		{
			roundId: "grill-1",
			status: "NEEDS_CONFIRMATION",
			questions: [{
				id: "model-question-id-not-consent",
				question: "模型原始問題：不應沿用這個問題",
				options: ["模型選項 A", "模型選項 B"],
			}],
			recommendation: { value: "同意", reason: "找不到既有知識文件。", confidence: 0.8 },
			evidence: [],
			requiresUserConfirmation: true,
		},
		undefined,
		undefined,
		harness.buildContext({ ui: { select: async () => undefined } }),
	);

	await harness.sendInput("同意");
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);

	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute(
		"call-empty-discovery-spec-gap-retrieval",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingTool?.execute);
	const result = await understandingTool.execute(
		"call-empty-discovery-spec-gap-understanding",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: {
				kind: "completed",
				knowledgeSummary: "探索性產品開發摘要",
				decisions: [],
				findings: [],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(result.details.status, "accepted");
	const evidencePackage = result.details.evidencePackage as {
		verificationLevel?: string;
		specGap?: {
			target: string;
			reason: string;
			missingEvidence: string[];
			impact: string;
		};
	};
	assert.equal(evidencePackage.verificationLevel, "exploratory");
	assert.deepEqual(evidencePackage.specGap, {
		target: roundRequest,
		reason: "本輪沒有可用的知識文件，僅依使用者明確提供的前提進行探索性開發。",
		missingEvidence: ["與本輪目標相關的知識文件或正式規格"],
		impact: "不得據此宣稱 API、協定、安全、法規或相容性；後續需補充可核對證據。",
	});
});

test("Extension_DeepSearchWikiAndCodeBase_ShouldRemainUnaffected", async (t) => {
	for (const source of ["wiki", "code_base"] as const) {
		const rootDir = createTempRoot();
		t.after(() => rmSync(rootDir, { force: true, recursive: true }));
		const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
		const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
		const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
		assert.ok(evidenceTool?.execute);
		await evidenceTool.execute(`call-${source}-regression-evidence`, { candidateId }, undefined, undefined, harness.buildContext());

		const completionTool = harness.registeredTools.get("forge_grill_complete");
		assert.ok(completionTool?.execute);
		await completionTool.execute(
			`call-${source}-regression-completion`,
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

		const searchTool = harness.registeredTools.get("forge_deep_search");
		assert.ok(searchTool?.execute);
		const result = await searchTool.execute(
			`call-${source}-regression-search`,
			{
				attemptId: "deep-1",
				sourceRoundId: "grill-1",
				phase: "DEEP_KNOWLEDGE_RETRIEVAL",
				query: "BoundaryToken",
				source,
			},
			undefined,
			undefined,
			harness.buildContext(),
		);

		assert.equal(result.details.status, "accepted");
	}
});

test("Extension_DeepSearchPureBatch_ShouldFollowUpOnceAfterAllSearchesSettle", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, searchTool, identity, messageEndHandler } = await prepareDeepRetrieval(
		rootDir,
		"pure-search-batch-follow-up",
		"PureSearchBatchFollowUpNeedle",
		true,
	);
	assert.ok(messageEndHandler, "Expected the public message_end handler to be registered");
	const followUpCount = () =>
		harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length;
	const baselineFollowUpCount = followUpCount();

	await messageEndHandler(
		{
			message: {
				role: "assistant",
				content: [
					{ type: "toolCall", id: "call-pure-search-wiki", name: "forge_deep_search" },
					{ type: "toolCall", id: "call-pure-search-code", name: "forge_deep_search" },
				],
			},
		} as never,
		harness.buildContext() as never,
	);

	const wikiResult = await searchTool(
		"call-pure-search-wiki",
		{ ...identity, query: "PureSearchBatchFollowUpNeedle", source: "wiki" },
		undefined,
		undefined,
		harness.buildContext(),
	);
	const codeResult = await searchTool(
		"call-pure-search-code",
		{ ...identity, query: "PureSearchBatchFollowUpNeedle", source: "code_base" },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(wikiResult.details.status, "accepted");
	assert.equal(codeResult.details.status, "accepted");

	await messageEndHandler(
		{ message: { role: "toolResult", toolCallId: "call-pure-search-wiki" } } as never,
		harness.buildContext() as never,
	);
	assert.equal(followUpCount(), baselineFollowUpCount, "第一筆搜尋完成時，第二筆尚未完成，不得先追問");

	await messageEndHandler(
		{ message: { role: "toolResult", toolCallId: "call-pure-search-code" } } as never,
		harness.buildContext() as never,
	);
	assert.equal(followUpCount(), baselineFollowUpCount + 1, "同一批搜尋全部完成後只能追問一次");
	assert.match(harness.observedUserMessageCalls.at(-1)?.content ?? "", /deep-1/);
	assert.equal(followUpCount(), baselineFollowUpCount + 1, "重複 settle 不得再次追問");
});

test("Extension_DeepSearchRejectedOrFailedPureBatch_ShouldSettleAndFollowUpOnce", async (t) => {
	for (const outcome of ["rejected", "failed"] as const) {
		const rootDir = createTempRoot();
		t.after(() => rmSync(rootDir, { force: true, recursive: true }));
		const { harness, searchTool, identity, messageEndHandler } = await prepareDeepRetrieval(
			rootDir,
			`pure-search-${outcome}`,
			`PureSearch${outcome}Needle`,
		);
		assert.ok(messageEndHandler, "Expected the public message_end handler to be registered");
		const followUpCount = () =>
			harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length;
		const baselineFollowUpCount = followUpCount();

		await messageEndHandler(
			{
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: `call-pure-search-${outcome}`, name: "forge_deep_search" }],
				},
			} as never,
			harness.buildContext() as never,
		);

		const result = outcome === "rejected"
			? await searchTool(
					`call-pure-search-${outcome}`,
					{
						...identity,
						query: `PureSearch${outcome}Needle`,
						source: "target",
						targetSource: "src/not-in-manifest.ts",
					},
					undefined,
					undefined,
					harness.buildContext(),
				)
			: { details: { status: "failed" } };
		assert.notEqual(result.details.status, "accepted");

		await messageEndHandler(
			{
				message: {
					role: "toolResult",
					toolCallId: `call-pure-search-${outcome}`,
					isError: outcome === "failed",
					details: result.details,
				},
			} as never,
			harness.buildContext() as never,
		);
		assert.equal(followUpCount(), baselineFollowUpCount + 1, `${outcome} 搜尋 settle 後應只追問一次`);
	}
});

test("Extension_DeepSearchStaleSibling_ShouldTerminate", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "src/stale-sibling.ts", "// DeepStaleSiblingNeedle target source.\n");
	writeWorkspaceFile(rootDir, "code_base/src/stale-sibling.ts", "// DeepStaleSiblingNeedle Grill snapshot.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DeepStaleSiblingNeedle stale-sibling.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-stale-sibling-evidence", { candidateId }, undefined, undefined, harness.buildContext());

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to expose execute");
	await completionTool.execute(
		"call-stale-sibling-completion",
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

	const deepSearchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(deepSearchTool?.execute, "Expected forge_deep_search to expose execute after entering Deep Retrieval");
	const staleResult = await deepSearchTool.execute(
		"call-stale-sibling-search",
		{
			attemptId: "deep-stale",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			query: "DeepStaleSiblingNeedle",
			source: "target",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(staleResult.details.status, "stale");
	assert.equal(staleResult.terminate, true);
});

test("Extension_DeepSearchTargetSourceUnmatched_ShouldEnterWaitUser", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"src/target.ts",
		"// TargetSourceUnmatchedNeedle is the only allowed target source.\nexport const target = true;\n",
	);
	writeWorkspaceFile(
		rootDir,
		"code_base/src/target.ts",
		"// TargetSourceUnmatchedNeedle provides the formal Grill seed.\n",
	);
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput(
		"請幫我測試 TargetSourceUnmatchedNeedle target-source-seed.ts src/target.ts",
	);
	const invocation = (startResult as { text?: string }).text ?? "";
	const targetCandidateId = invocation
		.split(/\r?\n/)
		.find((line) => line.includes("[target]") && line.includes("(target/src/target.ts)"))
		?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(targetCandidateId, "Expected the target manifest to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute(
		"call-target-source-unmatched-grill-evidence",
		{ candidateId: targetCandidateId },
		undefined,
		undefined,
		harness.buildContext(),
	);

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to expose execute");
	await completionTool.execute(
		"call-target-source-unmatched-grill-completion",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "候選已通過相關性 gate", confidence: 0.9 },
			evidence: [targetCandidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	const deepSearchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(deepSearchTool?.execute, "Expected forge_deep_search to be registered after entering Deep Retrieval");
	const searchResult = await deepSearchTool.execute(
		"call-target-source-unmatched-search",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			query: "TargetSourceUnmatchedNeedle",
			source: "target",
			targetSource: "src/missing-target.ts",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(searchResult.details.status, "needs_decision");
	assert.deepEqual(searchResult.details.options, ["src/target.ts"]);
	assert.deepEqual(searchResult.details.evidenceIds, [targetCandidateId]);
	assert.equal(searchResult.terminate, true);
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
});

test("Integration_WhenDeepSearchReusesGrillEvidence_ShouldAvoidDuplicateRead", async (t) => {
	const rootDir = createTempRoot();
	const candidateContent = "// DeepReuseNeedle is the same immutable evidence in Grill and Deep Retrieval.\n";
	writeWorkspaceFile(rootDir, "code_base/src/deep-reuse.ts", candidateContent);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DeepReuseNeedle deep-reuse.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	const grillEvidence = await evidenceTool.execute(
		"call-deep-reuse-grill-evidence",
		{ candidateId },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(grillEvidence.content[0]?.text, candidateContent);

	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute, "Expected forge_grill_complete to expose execute");
	await grillCompleteTool.execute(
		"call-deep-reuse-grill-completion",
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

	const deepSearchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(deepSearchTool?.execute, "Expected forge_deep_search to be registered after entering Deep Retrieval");
	const searchResult = await deepSearchTool.execute(
		"call-deep-reuse-search",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			query: "DeepReuseNeedle",
			source: "code_base",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(searchResult.details.status, "accepted");
	assert.deepEqual(searchResult.details.reusedEvidenceIds, [candidateId]);
	assert.deepEqual(searchResult.details.evidence, []);

	const retrievalCompleteTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalCompleteTool?.execute, "Expected forge_deep_retrieval_complete to be registered");
	const retrievalResult = await retrievalCompleteTool.execute(
		"call-deep-reuse-retrieval-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(retrievalResult.details.status, "accepted");
	assert.deepEqual(retrievalResult.details.lockedEvidenceIds, [candidateId]);
});

test("Integration_WhenRetrievalCompleteLocksEvidence_ShouldDisableSearch", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"wiki/deep-retrieval-lock.md",
		"DeepRetrievalLockNeedle is supplemental evidence for Retrieval lock.",
	);
	writeWorkspaceFile(
		rootDir,
		"code_base/src/deep-retrieval-lock.ts",
		"// DeepRetrievalLockNeedle is the fetched Grill candidate.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DeepRetrievalLockNeedle deep-retrieval-lock.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-retrieval-lock-grill-evidence", { candidateId }, undefined, undefined, {});

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute, "Expected forge_grill_complete to expose execute");
	await completionTool.execute(
		"call-retrieval-lock-grill-completion",
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
		{},
	);

	const deepSearchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(deepSearchTool?.execute, "Expected forge_deep_search to be registered after entering Deep Retrieval");
	const searchResult = await deepSearchTool.execute(
		"call-retrieval-lock-search",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			query: "DeepRetrievalLockNeedle",
			source: "wiki",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(searchResult.details.status, "accepted");
	const supplementalEvidenceId = (searchResult.details.evidence as Array<{ evidenceId: string }> | undefined)?.[0]?.evidenceId;
	assert.ok(supplementalEvidenceId, "Expected Deep Search to return supplemental evidence");

	const retrievalCompleteTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalCompleteTool?.execute, "Expected forge_deep_retrieval_complete to be registered");
	const retrievalResult = await retrievalCompleteTool.execute(
		"call-retrieval-lock-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(retrievalResult.details.status, "accepted");
	assert.deepEqual(retrievalResult.details.lockedEvidenceIds, [candidateId, supplementalEvidenceId]);
	assert.equal(retrievalResult.details.phase, "KNOWLEDGE_UNDERSTANDING");
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_complete"]);
	assert.ok(!harness.getActiveTools().includes("forge_deep_search"));
});

test("Integration_WhenDeepAttemptIsStale_ShouldRejectCompletion", async (t) => {
	const rootDir = createTempRoot();
	const candidateContent = "// DeepStaleCompletionNeedle is the fetched Grill candidate.\n";
	writeWorkspaceFile(rootDir, "code_base/src/deep-stale-completion.ts", candidateContent);
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DeepStaleCompletionNeedle deep-stale-completion.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to be registered");
	await evidenceTool.execute("call-stale-completion-grill-evidence", { candidateId }, undefined, undefined, {});

	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute, "Expected forge_grill_complete to be registered");
	await grillCompleteTool.execute(
		"call-stale-completion-grill-complete",
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
		{},
	);

	const retrievalCompleteTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalCompleteTool?.execute, "Expected forge_deep_retrieval_complete to be registered");
	const retrievalInput = {
		attemptId: "deep-1",
		sourceRoundId: "grill-1",
		phase: "DEEP_KNOWLEDGE_RETRIEVAL" as const,
		outcome: { kind: "completed" as const },
	};
	const firstResult = await retrievalCompleteTool.execute(
		"call-stale-completion-first",
		retrievalInput,
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(firstResult.details.status, "accepted");
	const lockedEvidenceIds = firstResult.details.lockedEvidenceIds;
	assert.deepEqual(lockedEvidenceIds, [candidateId]);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_complete"]);
	const statusCount = harness.observedStatuses.length;
	const messageCount = harness.observedMessages.length;

	const staleResult = await retrievalCompleteTool.execute(
		"call-stale-completion-second",
		retrievalInput,
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(staleResult.details.status, "stale");
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_complete"]);
	assert.equal(harness.observedStatuses.length, statusCount);
	assert.equal(harness.observedMessages.length, messageCount);

	const deepCompleteTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(deepCompleteTool?.execute, "Expected forge_deep_complete to be registered");
	const completeResult = await deepCompleteTool.execute(
		"call-stale-completion-understanding",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: {
				kind: "completed",
				knowledgeSummary: "測試知識摘要",
				decisions: [],
				findings: [{ statement: "候選支持目前判斷。", evidenceIds: [candidateId] }],
				limitations: [{ statement: "目前沒有阻擋限制。", blocking: false }],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(completeResult.details.status, "accepted");
	const evidencePackage = completeResult.details.evidencePackage as { evidence: Array<{ evidenceId: string }> };
	assert.deepEqual(
		evidencePackage.evidence.map((evidence) => evidence.evidenceId),
		lockedEvidenceIds,
	);
});

test("Integration_WhenStaleRetrievalNeedsDecisionReferencesUnknownEvidence_ShouldRejectWithoutMutation", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/stale-retrieval-decision.ts", "// StaleRetrievalDecisionNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 StaleRetrievalDecisionNeedle stale-retrieval-decision.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-stale-retrieval-evidence", { candidateId }, undefined, undefined, {});
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute(
		"call-stale-retrieval-grill-complete",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		{},
	);

	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute(
		"call-stale-retrieval-lock",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	const beforeStatus = harness.observedStatuses.at(-1);
	const statusCount = harness.observedStatuses.length;
	const messageCount = harness.observedMessages.length;
	const activeTools = harness.getActiveTools();
	const staleResult = await retrievalTool.execute(
		"call-stale-retrieval-decision",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: {
				kind: "needs_decision",
				decisionId: "stale-retrieval-decision",
				question: "是否繼續？",
				options: ["繼續"],
				recommendation: "繼續",
				evidenceIds: ["ev-unknown-retrieval"],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(staleResult.details.status, "stale");
	assert.equal(harness.observedStatuses.at(-1), beforeStatus);
	assert.equal(harness.observedStatuses.length, statusCount);
	assert.equal(harness.observedMessages.length, messageCount);
	assert.deepEqual(harness.getActiveTools(), activeTools);
});

test("Integration_WhenStaleUnderstandingNeedsDecisionReferencesUnknownEvidence_ShouldRejectWithoutMutation", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/stale-understanding-decision.ts", "// StaleUnderstandingDecisionNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 StaleUnderstandingDecisionNeedle stale-understanding-decision.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-stale-understanding-evidence", { candidateId }, undefined, undefined, {});
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute(
		"call-stale-understanding-grill-complete",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		{},
	);

	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute(
		"call-stale-understanding-retrieval",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	const deepCompleteTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(deepCompleteTool?.execute);
	await deepCompleteTool.execute(
		"call-stale-understanding-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: {
				kind: "completed",
				knowledgeSummary: "測試知識摘要",
				decisions: [],
				findings: [{ statement: "ok", evidenceIds: [candidateId] }],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	const beforeStatus = harness.observedStatuses.at(-1);
	const statusCount = harness.observedStatuses.length;
	const messageCount = harness.observedMessages.length;
	const activeTools = harness.getActiveTools();
	const staleResult = await deepCompleteTool.execute(
		"call-stale-understanding-decision",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: {
				kind: "needs_decision",
				decisionId: "stale-understanding-decision",
				question: "是否接受？",
				options: ["接受"],
				recommendation: "接受",
				evidenceIds: ["ev-unknown-understanding"],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(staleResult.details.status, "stale");
	assert.equal(harness.observedStatuses.at(-1), beforeStatus);
	assert.equal(harness.observedStatuses.length, statusCount);
	assert.equal(harness.observedMessages.length, messageCount);
	assert.deepEqual(harness.getActiveTools(), activeTools);
});

test("Integration_WhenUnderstandingUsesLockedEvidence_ShouldProducePackage", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"wiki/deep-understanding-package.md",
		"DeepUnderstandingPackageNeedle is supplemental evidence for Understanding.",
	);
	writeWorkspaceFile(
		rootDir,
		"code_base/src/deep-understanding-package.ts",
		"// DeepUnderstandingPackageNeedle is the fetched Grill candidate.",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DeepUnderstandingPackageNeedle deep-understanding-package.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-understanding-package-grill-evidence", { candidateId }, undefined, undefined, {});

	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute, "Expected forge_grill_complete to expose execute");
	await grillCompleteTool.execute(
		"call-understanding-package-grill-completion",
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
		{},
	);

	const deepSearchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(deepSearchTool?.execute, "Expected forge_deep_search to be registered after entering Deep Retrieval");
	const searchResult = await deepSearchTool.execute(
		"call-understanding-package-search",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			query: "DeepUnderstandingPackageNeedle",
			source: "wiki",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(searchResult.details.status, "accepted");
	const supplementalEvidenceId = (searchResult.details.evidence as Array<{ evidenceId: string }> | undefined)?.[0]?.evidenceId;
	assert.ok(supplementalEvidenceId, "Expected Deep Search to return supplemental evidence");

	const retrievalCompleteTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalCompleteTool?.execute, "Expected forge_deep_retrieval_complete to be registered");
	await retrievalCompleteTool.execute(
		"call-understanding-package-retrieval-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	const deepCompleteTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(deepCompleteTool?.execute, "Expected forge_deep_complete to be registered after Retrieval completion");
	const outcomeSchema = (
		(deepCompleteTool.parameters as { properties?: Record<string, unknown> } | undefined)?.properties?.outcome as
			| { anyOf?: Array<{ properties?: Record<string, unknown> }> }
			| undefined
	);
	const completedOutcomeSchema = outcomeSchema?.anyOf?.find(
		(variant) => (variant.properties?.kind as { const?: unknown } | undefined)?.const === "completed",
	);
	assert.ok(completedOutcomeSchema?.properties, "Expected forge_deep_complete to expose a completed outcome schema");
	assert.equal(completedOutcomeSchema.properties.evidence, undefined, "Understanding outcome must not accept evidence");

	const decisions = [{ decisionId: "decision-1", statement: "候選支持目前判斷。", evidenceIds: [candidateId] }];
	const findings = [{ statement: "補充資料與候選一致。", evidenceIds: [supplementalEvidenceId] }];
	const limitations = [{ statement: "目前沒有阻擋限制。", blocking: false }];
	const completeResult = await deepCompleteTool.execute(
		"call-understanding-package-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions, findings, limitations },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(completeResult.details.status, "accepted");
	const evidencePackage = completeResult.details.evidencePackage as {
		evidence: Array<{ evidenceId: string; origin: string }>;
		decisions: unknown[];
		findings: unknown[];
		limitations: unknown[];
	};
	assert.deepEqual(
		evidencePackage.evidence.map((evidence) => ({ evidenceId: evidence.evidenceId, origin: evidence.origin })),
		[
			{ evidenceId: candidateId, origin: "grill" },
			{ evidenceId: supplementalEvidenceId, origin: "deep_retrieval" },
		],
	);
	assert.deepEqual(evidencePackage.decisions, decisions);
	assert.deepEqual(evidencePackage.findings, findings);
	assert.deepEqual(evidencePackage.limitations, limitations);
});

test("Integration_WhenPackageIsValid_ShouldTransferToContextBuild", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(
		rootDir,
		"code_base/src/context-build-transfer.ts",
		"// ContextBuildTransferNeedle is the fetched Grill candidate for context build.",
	);
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read", "write"] });
	const startResult = await harness.sendInput("請幫我測試 ContextBuildTransferNeedle context-build-transfer.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "Expected the public Grill invocation to expose a snapshot candidate id");

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-context-build-evidence", { candidateId }, undefined, undefined, harness.buildContext());

	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute, "Expected forge_grill_complete to expose execute");
	await grillCompleteTool.execute(
		"call-context-build-grill-complete",
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

	const retrievalCompleteTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalCompleteTool?.execute, "Expected forge_deep_retrieval_complete to expose execute");
	await retrievalCompleteTool.execute(
		"call-context-build-retrieval-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	const deepCompleteTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(deepCompleteTool?.execute, "Expected forge_deep_complete to expose execute");
	const completeResult = await deepCompleteTool.execute(
		"call-context-build-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: {
				kind: "completed",
				knowledgeSummary: "測試知識摘要",
				decisions: [],
				findings: [{ statement: "候選支持目前判斷。", evidenceIds: [candidateId] }],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(completeResult.details.status, "accepted");
	assert.match(
		[...harness.observedStatuses, ...harness.observedMessages].join("\n"),
		/CONTEXT_BUILD/,
	);
	assert.deepEqual(harness.getActiveTools(), ["forge_context_complete"]);
});

test("AgentSettled_WhenContextBuildIsPending_ShouldInvokeBundledSkillOnce", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(
		rootDir,
		"context-build-settled",
	);
	const completeResult = await understandingTool(
		"call-context-build-settled-complete",
		{
			...identity,
			outcome: {
				kind: "completed",
				knowledgeSummary: "CONTEXT_BUILD_KNOWLEDGE_SUMMARY_SENTINEL",
				decisions: [],
				findings: [{ statement: "合法的 Context Build 證據。", evidenceIds: [candidateId] }],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(completeResult.details.status, "accepted");

	const contextCompleteTool = harness.registeredTools.get("forge_context_complete");
	assert.ok(contextCompleteTool?.execute, "Expected forge_context_complete to be registered");
	assert.deepEqual(harness.getActiveTools(), ["forge_context_complete"]);

	const baseline = harness.observedUserMessageCalls.length;
	assert.ok(harness.agentSettledHandler, "Expected agent_settled handler for pending Context Build");
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));

	const messages = harness.observedUserMessageCalls.slice(baseline);
	assert.equal(messages.length, 1, "Context Build pending invocation 只能送出一次");
	const content = messages[0]?.content ?? "";
	assert.match(content, /<skill name="context-build"/);
	assert.match(content, /完成工具：forge_context_complete/);
	assert.match(content, /"attemptId"\s*:\s*"context-1"/);
	assert.match(content, /"sourceRoundId"\s*:\s*"grill-1"/);
	assert.match(content, new RegExp(`\\b${candidateId}\\b`));
	assert.doesNotMatch(content, /CONTEXT_BUILD_KNOWLEDGE_SUMMARY_SENTINEL/);
	assert.doesNotMatch(content, /ContextBuildcontext-build-settledNeedle code base evidence/);
});

test("Extension_WhenContextBuildCompletionIsStale_ShouldRetryCurrentInvocationOnce", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(
		rootDir,
		"context-build-stale-retry",
	);
	const deepResult = await understandingTool(
		"call-context-build-stale-retry-deep",
		{
			...identity,
			outcome: {
				kind: "completed",
				knowledgeSummary: "Context stale retry knowledge summary",
				decisions: [],
				findings: [{ statement: "可追溯的 Context 證據。", evidenceIds: [candidateId] }],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(deepResult.details.status, "accepted");

	assert.ok(harness.agentSettledHandler);
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const contextOneMessage = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	assert.match(contextOneMessage, /"attemptId"\s*:\s*"context-1"/);
	const contextCompleteTool = harness.registeredTools.get("forge_context_complete");
	assert.ok(contextCompleteTool?.execute, "Expected forge_context_complete to be registered");

	const ambiguity = (decisionId: string) => ({
		kind: "ambiguous" as const,
		ambiguity: {
			decisionId,
			question: "採用哪一個 Context 範圍？",
			options: ["方案 A", "方案 B"],
			recommendation: "方案 A",
			evidenceIds: [candidateId],
		},
	});
	await contextCompleteTool.execute(
		"call-context-build-stale-retry-ambiguity-one",
		{ attemptId: "context-1", sourceRoundId: "grill-1", outcome: ambiguity("context-stale-one") },
		undefined,
		undefined,
		harness.buildContext({ ui: { select: async () => undefined } }),
	);
	const contextTwoResult = (await harness.sendInput("方案 B")) as { action?: string; text?: string };
	assert.equal(contextTwoResult.action, "transform");
	const contextTwoMessage = contextTwoResult.text ?? "";
	assert.match(contextTwoMessage, /"attemptId"\s*:\s*"context-2"/);

	await contextCompleteTool.execute(
		"call-context-build-stale-retry-ambiguity-two",
		{ attemptId: "context-2", sourceRoundId: "grill-1", outcome: ambiguity("context-stale-two") },
		undefined,
		undefined,
		harness.buildContext({ ui: { select: async () => undefined } }),
	);
	const contextThreeResult = (await harness.sendInput("方案 B")) as { action?: string; text?: string };
	assert.equal(contextThreeResult.action, "transform");
	assert.match(contextThreeResult.text ?? "", /"attemptId"\s*:\s*"context-3"/);
	const beforeStale = harness.observedUserMessageCalls.length;

	const staleResult = await contextCompleteTool.execute(
		"call-context-build-stale-retry-old",
		{
			attemptId: "context-2",
			sourceRoundId: "grill-1",
			outcome: { kind: "completed", candidate: { glossary: [{ term: "範圍", definition: "目前的產品範圍。", evidenceIds: [candidateId] }] } },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(staleResult.details.status, "stale");
	assert.equal(staleResult.terminate, true);
	assert.equal(harness.observedUserMessageCalls.length, beforeStale, "過期結果處理不得在 handler 內立即送出訊息");
	assert.match(harness.observedStatuses.at(-1) ?? "", /CONTEXT_BUILD/);
	assert.deepEqual(harness.getActiveTools(), ["forge_context_complete"]);

	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const replayed = harness.observedUserMessageCalls.slice(beforeStale);
	assert.equal(replayed.length, 1, "過期 Context 結果後只能重播一次最新 invocation");
	assert.match(replayed[0]?.content ?? "", /完成工具：forge_context_complete/);
	assert.match(replayed[0]?.content ?? "", /"attemptId"\s*:\s*"context-3"/);
	assert.match(replayed[0]?.content ?? "", /"sourceRoundId"\s*:\s*"grill-1"/);
});

test("Extension_WhenContextBuildStaleRetryIsExhausted_ShouldReplayOnlyOnContinue", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(
		rootDir,
		"context-build-stale-retry-exhausted",
	);
	const deepResult = await understandingTool(
		"call-context-build-stale-retry-exhausted-deep",
		{
			...identity,
			outcome: {
				kind: "completed",
				knowledgeSummary: "Context stale retry exhaustion summary",
				decisions: [],
				findings: [{ statement: "可追溯的 Context 證據。", evidenceIds: [candidateId] }],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(deepResult.details.status, "accepted");
	assert.ok(harness.agentSettledHandler);
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const contextOneMessage = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	assert.match(contextOneMessage, /"attemptId"\s*:\s*"context-1"/);

	const contextCompleteTool = harness.registeredTools.get("forge_context_complete");
	assert.ok(contextCompleteTool?.execute, "Expected forge_context_complete to be registered");
	await contextCompleteTool.execute(
		"call-context-build-stale-retry-exhausted-ambiguity-one",
		{
			attemptId: "context-1",
			sourceRoundId: "grill-1",
			outcome: {
				kind: "ambiguous",
				ambiguity: {
					decisionId: "context-stale-exhausted-one",
					question: "採用哪一個 Context 範圍？",
					options: ["方案 A", "方案 B"],
					recommendation: "方案 A",
					evidenceIds: [candidateId],
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext({ ui: { select: async () => undefined } }),
	);
	const contextTwoResult = (await harness.sendInput("方案 B")) as { action?: string; text?: string };
	assert.equal(contextTwoResult.action, "transform");
	assert.match(contextTwoResult.text ?? "", /"attemptId"\s*:\s*"context-2"/);

	await contextCompleteTool.execute(
		"call-context-build-stale-retry-exhausted-ambiguity-two",
		{
			attemptId: "context-2",
			sourceRoundId: "grill-1",
			outcome: {
				kind: "ambiguous",
				ambiguity: {
					decisionId: "context-stale-exhausted-two",
					question: "採用哪一個 Context 範圍？",
					options: ["方案 A", "方案 B"],
					recommendation: "方案 A",
					evidenceIds: [candidateId],
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext({ ui: { select: async () => undefined } }),
	);
	const contextThreeResult = (await harness.sendInput("方案 B")) as { action?: string; text?: string };
	assert.equal(contextThreeResult.action, "transform");
	assert.match(contextThreeResult.text ?? "", /"attemptId"\s*:\s*"context-3"/);

	const stalePayload = {
		attemptId: "context-2",
		sourceRoundId: "grill-1",
		outcome: {
			kind: "completed" as const,
			candidate: {
				glossary: [{ term: "範圍", definition: "目前的產品範圍。", evidenceIds: [candidateId] }],
			},
		},
	};
	const beforeFirstStale = harness.observedUserMessageCalls.length;
	const firstStale = await contextCompleteTool.execute(
		"call-context-build-stale-retry-exhausted-old-one",
		stalePayload,
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(firstStale.details.status, "stale");
	assert.equal(firstStale.terminate, true);
	assert.equal(harness.observedUserMessageCalls.length, beforeFirstStale);

	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const afterFirstReplay = harness.observedUserMessageCalls.length;
	assert.equal(afterFirstReplay - beforeFirstStale, 1);
	assert.match(harness.observedUserMessageCalls.at(-1)?.content ?? "", /"attemptId"\s*:\s*"context-3"/);

	const secondStale = await contextCompleteTool.execute(
		"call-context-build-stale-retry-exhausted-old-two",
		stalePayload,
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(secondStale.details.status, "stale");
	assert.equal(secondStale.terminate, true);
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	assert.equal(harness.observedUserMessageCalls.length, afterFirstReplay);

	await harness.runCommand("continue");
	const continued = harness.observedUserMessageCalls.slice(afterFirstReplay);
	assert.equal(continued.length, 1, "耗盡自動重試後，continue 應只重播目前 invocation 一次");
	assert.match(continued[0]?.content ?? "", /forge_context_complete/);
	assert.match(continued[0]?.content ?? "", /"sourceRoundId"\s*:\s*"grill-1"/);
	assert.match(continued[0]?.content ?? "", /"attemptId"\s*:\s*"context-3"/);
	assert.doesNotMatch(continued[0]?.content ?? "", /"attemptId"\s*:\s*"context-2"/);
});

test("ContextAndAdrBuild_ShouldSuppressAssistantProseAndBlockWrongStageTool", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(
		rootDir,
		"build-boundary",
	);
	const deepResult = await understandingTool(
		"call-build-boundary-deep",
		{
			...identity,
			outcome: {
				kind: "completed",
				knowledgeSummary: "Build boundary summary",
				decisions: [],
				findings: [{ statement: "可追溯的建模證據。", evidenceIds: [candidateId] }],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(deepResult.details.status, "accepted");

	const contextMessage = {
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "Context Build prose must not leak" },
				{ type: "thinking", thinking: "Context Build thinking must not leak" },
			],
		},
	};
	assert.ok(harness.messageUpdateHandler);
	await harness.messageUpdateHandler(contextMessage);
	assert.equal(contextMessage.message.content[0]?.text, "");
	assert.equal(contextMessage.message.content[1]?.thinking, "");
	assert.ok(harness.toolCallHandler);
	assert.deepEqual(
		await harness.toolCallHandler({
			type: "tool_call",
			toolCallId: "call-build-boundary-wrong-adr",
			toolName: "forge_adr_complete",
			input: {},
		}),
		{ block: true },
	);

	const contextCompleteTool = harness.registeredTools.get("forge_context_complete");
	assert.ok(contextCompleteTool?.execute);
	const contextResult = await contextCompleteTool.execute(
		"call-build-boundary-context",
		{
			attemptId: "context-1",
			sourceRoundId: "grill-1",
			outcome: {
				kind: "completed",
				candidate: {
					glossary: [{ term: "流程邊界", definition: "Context 與 ADR 的階段界線。", evidenceIds: [candidateId] }],
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(contextResult.details.status, "accepted");

	const adrMessage = {
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "ADR Build prose must not leak" },
				{ type: "thinking", thinking: "ADR Build thinking must not leak" },
			],
		},
	};
	await harness.messageUpdateHandler(adrMessage);
	assert.equal(adrMessage.message.content[0]?.text, "");
	assert.equal(adrMessage.message.content[1]?.thinking, "");
	assert.deepEqual(
		await harness.toolCallHandler({
			type: "tool_call",
			toolCallId: "call-build-boundary-wrong-context",
			toolName: "forge_context_complete",
			input: {},
		}),
		{ block: true },
	);
});

test("ContextAmbiguity_WhenUserAnswers_ShouldQueueFreshContextAttemptWithDecision", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(
		rootDir,
		"context-ambiguity-resume",
	);
	const deepResult = await understandingTool(
		"call-context-ambiguity-resume-deep",
		{
			...identity,
			outcome: {
				kind: "completed",
				knowledgeSummary: "CONTEXT_AMBIGUITY_KNOWLEDGE_SUMMARY_SENTINEL",
				decisions: [],
				findings: [{ statement: "可追溯的 Context 證據。", evidenceIds: [candidateId] }],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(deepResult.details.status, "accepted");

	assert.ok(harness.agentSettledHandler, "Expected agent_settled handler for pending Context Build");
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const contextMessage = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const oldAttemptId = contextMessage.match(/"attemptId"\s*:\s*"([^"]+)"/)?.[1];
	const sourceRoundId = contextMessage.match(/"sourceRoundId"\s*:\s*"([^"]+)"/)?.[1];
	assert.ok(oldAttemptId, "Context invocation must expose the original attemptId");
	assert.ok(sourceRoundId, "Context invocation must expose sourceRoundId");

	const contextCompleteTool = harness.registeredTools.get("forge_context_complete");
	assert.ok(contextCompleteTool?.execute, "Expected forge_context_complete to be registered");
	const baseline = harness.observedUserMessageCalls.length;
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	const ambiguityResult = await contextCompleteTool.execute(
		"call-context-ambiguity-resume-context",
		{
			attemptId: oldAttemptId,
			sourceRoundId,
			outcome: {
				kind: "ambiguous",
				ambiguity: {
					decisionId: "context-boundary",
					question: "採用哪一個產品範圍？",
					options: ["方案 A", "方案 B"],
					recommendation: "方案 A",
					evidenceIds: [candidateId],
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext({
			ui: {
				select: async (title, options) => {
					selectCalls.push({ title, options: [...options] });
					return "方案 B";
				},
			},
		}),
	);
	assert.equal(ambiguityResult.details.status, "ambiguous");
	assert.match(harness.observedStatuses.join("\n"), /WAIT_USER/);
	assert.equal(selectCalls.length, 1);
	assert.equal(selectCalls[0]?.title, "採用哪一個產品範圍？");
	assert.ok(selectCalls[0]?.options.includes("方案 A"));
	assert.ok(selectCalls[0]?.options.includes("方案 B"));
	assert.ok(selectCalls[0]?.options.some((option) => option.includes("自行輸入")));

	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));

	const resumedMessages = harness.observedUserMessageCalls.slice(baseline);
	assert.equal(resumedMessages.length, 1, "Context ambiguity 回答後只能送出一次新 invocation");
	const resumedContent = resumedMessages[0]?.content ?? "";
	const newAttemptId = resumedContent.match(/"attemptId"\s*:\s*"([^"]+)"/)?.[1];
	assert.ok(newAttemptId, "Resumed Context invocation must expose a new attemptId");
	assert.notEqual(newAttemptId, oldAttemptId, "Resumed Context invocation must use a fresh attempt");
	assert.match(resumedContent, new RegExp(`"sourceRoundId"\\s*:\\s*"${sourceRoundId}"`));
	assert.match(resumedContent, /humanDecisions/);
	assert.match(resumedContent, /context-boundary/);
	assert.match(resumedContent, /方案 B/);
	assert.match(resumedContent, new RegExp(`\\b${candidateId}\\b`));
	assert.doesNotMatch(resumedContent, /CONTEXT_AMBIGUITY_KNOWLEDGE_SUMMARY_SENTINEL/);
	assert.doesNotMatch(resumedContent, /KnowledgeUnderstandingcontext-ambiguity-resumeNeedle code base evidence/);
});

test("ContextAmbiguity_WhenUserTypesAnswer_ShouldTransformFreshContextInvocation", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(
		rootDir,
		"context-ambiguity-text-answer",
	);
	const deepResult = await understandingTool(
		"call-context-ambiguity-text-answer-deep",
		{
			...identity,
			outcome: {
				kind: "completed",
				knowledgeSummary: "CONTEXT_TEXT_ANSWER_KNOWLEDGE_SUMMARY_SENTINEL",
				decisions: [],
				findings: [{ statement: "可追溯的 Context 證據。", evidenceIds: [candidateId] }],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(deepResult.details.status, "accepted");

	assert.ok(harness.agentSettledHandler);
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const contextMessage = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const oldAttemptId = contextMessage.match(/"attemptId"\s*:\s*"([^"]+)"/)?.[1];
	const sourceRoundId = contextMessage.match(/"sourceRoundId"\s*:\s*"([^"]+)"/)?.[1];
	assert.ok(oldAttemptId);
	assert.ok(sourceRoundId);

	const contextCompleteTool = harness.registeredTools.get("forge_context_complete");
	assert.ok(contextCompleteTool?.execute);
	const ambiguityResult = await contextCompleteTool.execute(
		"call-context-ambiguity-text-answer-context",
		{
			attemptId: oldAttemptId,
			sourceRoundId,
			outcome: {
				kind: "ambiguous",
				ambiguity: {
					decisionId: "context-text-boundary",
					question: "採用哪一個產品範圍？",
					options: ["方案 A", "方案 B"],
					recommendation: "方案 A",
					evidenceIds: [candidateId],
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(ambiguityResult.details.status, "ambiguous");
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);

	const result = await harness.sendInput("方案 B");
	assert.equal((result as { action?: string }).action, "transform");
	const text = (result as { text?: string }).text ?? "";
	const newAttemptId = text.match(/"attemptId"\s*:\s*"([^"]+)"/)?.[1];
	assert.ok(newAttemptId);
	assert.notEqual(newAttemptId, oldAttemptId);
	assert.match(text, new RegExp(`"sourceRoundId"\\s*:\\s*"${sourceRoundId}"`));
	assert.match(text, /humanDecisions/);
	assert.match(text, /context-text-boundary/);
	assert.match(text, /方案 B/);
	assert.match(text, new RegExp(`\\b${candidateId}\\b`));
	assert.doesNotMatch(text, /CONTEXT_TEXT_ANSWER_KNOWLEDGE_SUMMARY_SENTINEL/);
});

test("ContextComplete_WhenCandidateIsValid_ShouldEnterAdrBuildAndInvokeBundledSkillOnce", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(
		rootDir,
		"context-complete-adr-build",
	);
	const completeResult = await understandingTool(
		"call-context-complete-adr-build-deep",
		{
			...identity,
			outcome: {
				kind: "completed",
				knowledgeSummary: "ADR_BUILD_KNOWLEDGE_SUMMARY_SENTINEL",
				decisions: [],
				findings: [{ statement: "合法的 Context Build 證據。", evidenceIds: [candidateId] }],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(completeResult.details.status, "accepted");

	const baseline = harness.observedUserMessageCalls.length;
	assert.ok(harness.agentSettledHandler, "Expected agent_settled handler for pending Context Build");
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const contextMessage = harness.observedUserMessageCalls.slice(baseline)[0]?.content ?? "";
	assert.match(contextMessage, /<skill name="context-build"/);
	const attemptId = contextMessage.match(/"attemptId"\s*:\s*"([^"]+)"/)?.[1];
	const sourceRoundId = contextMessage.match(/"sourceRoundId"\s*:\s*"([^"]+)"/)?.[1];
	assert.ok(attemptId, "Context invocation must expose attemptId");
	assert.ok(sourceRoundId, "Context invocation must expose sourceRoundId");

	const contextCompleteTool = harness.registeredTools.get("forge_context_complete");
	assert.ok(contextCompleteTool?.execute, "Expected forge_context_complete to be registered");
	const contextResult = await contextCompleteTool.execute(
		"call-context-complete-adr-build-context",
		{
			attemptId,
			sourceRoundId,
			outcome: {
				kind: "completed",
				candidate: {
					glossary: [{ term: "產品範圍", definition: "使用者確認的新產品需求邊界。", evidenceIds: [candidateId] }],
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(contextResult.details.status, "accepted");
	assert.deepEqual(harness.getActiveTools(), ["forge_adr_complete"]);

	const adrBaseline = harness.observedUserMessageCalls.length;
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));

	const messages = harness.observedUserMessageCalls.slice(adrBaseline);
	assert.equal(messages.length, 1, "ADR Build pending invocation 只能送出一次");
	const content = messages[0]?.content ?? "";
	assert.match(content, /<skill name="context-build"/);
	assert.match(content, /完成工具：forge_adr_complete/);
	assert.match(content, /"attemptId"\s*:\s*"adr-1"/);
	assert.match(content, /"sourceRoundId"\s*:\s*"grill-1"/);
	assert.match(content, /產品範圍/);
	assert.match(content, /使用者確認的新產品需求邊界/);
	assert.match(content, new RegExp(`\\b${candidateId}\\b`));
	assert.doesNotMatch(content, /ADR_BUILD_KNOWLEDGE_SUMMARY_SENTINEL/);
	assert.doesNotMatch(content, /ContextCompletecontext-complete-adr-buildNeedle code base evidence/);
});

test("AdrComplete_WhenCandidateIsValid_ShouldAtomicallyWriteDocumentsAndEnterToSpec", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(
		rootDir,
		"adr-complete-documents",
	);
	const deepResult = await understandingTool(
		"call-adr-complete-documents-deep",
		{
			...identity,
			outcome: {
				kind: "completed",
				knowledgeSummary: "ADR_COMPLETE_KNOWLEDGE_SUMMARY_SENTINEL",
				decisions: [],
				findings: [{ statement: "可追溯的 ADR 證據。", evidenceIds: [candidateId] }],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(deepResult.details.status, "accepted");

	assert.ok(harness.agentSettledHandler, "Expected agent_settled handler for pending Context Build");
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const contextMessage = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const contextAttemptId = contextMessage.match(/"attemptId"\s*:\s*"([^"]+)"/)?.[1];
	const contextSourceRoundId = contextMessage.match(/"sourceRoundId"\s*:\s*"([^"]+)"/)?.[1];
	assert.ok(contextAttemptId, "Context invocation must expose attemptId");
	assert.ok(contextSourceRoundId, "Context invocation must expose sourceRoundId");

	const contextCompleteTool = harness.registeredTools.get("forge_context_complete");
	assert.ok(contextCompleteTool?.execute, "Expected forge_context_complete to be registered");
	const contextResult = await contextCompleteTool.execute(
		"call-adr-complete-documents-context",
		{
			attemptId: contextAttemptId,
			sourceRoundId: contextSourceRoundId,
			outcome: {
				kind: "completed",
				candidate: {
					glossary: [{ term: "產品範圍", definition: "使用者確認的新產品需求邊界。", evidenceIds: [candidateId] }],
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(contextResult.details.status, "accepted");
	assert.deepEqual(harness.getActiveTools(), ["forge_adr_complete"]);

	const adrBaseline = harness.observedUserMessageCalls.length;
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const adrMessage = harness.observedUserMessageCalls.slice(adrBaseline)[0]?.content ?? "";
	const adrAttemptId = adrMessage.match(/"attemptId"\s*:\s*"([^"]+)"/)?.[1];
	const adrSourceRoundId = adrMessage.match(/"sourceRoundId"\s*:\s*"([^"]+)"/)?.[1];
	assert.ok(adrAttemptId, "ADR invocation must expose attemptId");
	assert.ok(adrSourceRoundId, "ADR invocation must expose sourceRoundId");

	const adrCompleteTool = harness.registeredTools.get("forge_adr_complete");
	assert.ok(adrCompleteTool?.execute, "Expected forge_adr_complete to be registered");
	const adrResult = await adrCompleteTool.execute(
		"call-adr-complete-documents-adr",
		{
			attemptId: adrAttemptId,
			sourceRoundId: adrSourceRoundId,
			outcome: {
				kind: "completed",
				candidate: {
					records: [
						{
							decision: "採用使用者確認的產品範圍作為本輪規格邊界。",
							rationale: "目前唯一可追溯證據來自使用者確認的 Grill 前提。",
							consequences: ["後續實作不得超出已確認的產品範圍。"],
							citations: [candidateId],
						},
					],
					handoff: {
						summary: "已完成 Context 與 ADR 設計決策。",
						nextSessionFocus: "依 ADR 開始產品規格實作。",
						references: ["Documents/CONTEXT.md", "Documents/ADR.md"],
						suggestedSkills: ["/execute-designed-plan"],
					},
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(adrResult.details.status, "accepted");
	assert.deepEqual(harness.getActiveTools(), ["read"]);
	assert.match(harness.observedStatuses.at(-1) ?? "", /TO_SPEC/);

	const documentsDir = join(rootDir, "Documents");
	assert.deepEqual(readdirSync(documentsDir).sort(), ["ADR.md", "CONTEXT.md", "handoff.md"]);
	for (const fileName of ["CONTEXT.md", "ADR.md", "handoff.md"]) {
		const content = readFileSync(join(documentsDir, fileName), "utf8");
		assert.match(content, /forge-runtime:/);
		assert.doesNotMatch(content, /ADR_COMPLETE_KNOWLEDGE_SUMMARY_SENTINEL/);
		assert.doesNotMatch(content, /KnowledgeUnderstandingadr-complete-documentsNeedle code base evidence/);
	}
	for (const fileName of ["CONTEXT.md", "ADR.md"]) {
		assert.match(readFileSync(join(documentsDir, fileName), "utf8"), new RegExp(candidateId));
	}
	const handoffContent = readFileSync(join(documentsDir, "handoff.md"), "utf8");
	assert.match(handoffContent, /Documents\/CONTEXT\.md/);
	assert.match(handoffContent, /Documents\/ADR\.md/);
	assert.match(handoffContent, /已完成 Context 與 ADR 設計決策/);
	assert.match(handoffContent, /依 ADR 開始產品規格實作/);
});

test("AdrAmbiguity_WhenUserAnswers_ShouldQueueFreshAttemptAndPersistDecision", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(
		rootDir,
		"adr-ambiguity-resume",
	);
	const deepResult = await understandingTool(
		"call-adr-ambiguity-resume-deep",
		{
			...identity,
			outcome: {
				kind: "completed",
				knowledgeSummary: "ADR_AMBIGUITY_KNOWLEDGE_SUMMARY_SENTINEL",
				decisions: [],
				findings: [{ statement: "可追溯的 ADR 證據。", evidenceIds: [candidateId] }],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(deepResult.details.status, "accepted");

	assert.ok(harness.agentSettledHandler);
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const contextMessage = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const contextAttemptId = contextMessage.match(/"attemptId"\s*:\s*"([^"]+)"/)?.[1];
	const contextSourceRoundId = contextMessage.match(/"sourceRoundId"\s*:\s*"([^"]+)"/)?.[1];
	assert.ok(contextAttemptId);
	assert.ok(contextSourceRoundId);

	const contextCompleteTool = harness.registeredTools.get("forge_context_complete");
	assert.ok(contextCompleteTool?.execute);
	const contextResult = await contextCompleteTool.execute(
		"call-adr-ambiguity-resume-context",
		{
			attemptId: contextAttemptId,
			sourceRoundId: contextSourceRoundId,
			outcome: {
				kind: "completed",
				candidate: {
					glossary: [{ term: "產品範圍", definition: "使用者確認的需求邊界。", evidenceIds: [candidateId] }],
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(contextResult.details.status, "accepted");

	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const adrMessage = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const oldAdrAttemptId = adrMessage.match(/"attemptId"\s*:\s*"([^"]+)"/)?.[1];
	const adrSourceRoundId = adrMessage.match(/"sourceRoundId"\s*:\s*"([^"]+)"/)?.[1];
	assert.ok(oldAdrAttemptId);
	assert.equal(adrSourceRoundId, contextSourceRoundId);

	const adrCompleteTool = harness.registeredTools.get("forge_adr_complete");
	assert.ok(adrCompleteTool?.execute);
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	const ambiguityResult = await adrCompleteTool.execute(
		"call-adr-ambiguity-resume-adr",
		{
			attemptId: oldAdrAttemptId,
			sourceRoundId: adrSourceRoundId,
			outcome: {
				kind: "ambiguous",
				ambiguity: {
					decisionId: "adr-boundary",
					question: "採用哪一個產品方案？",
					options: ["方案 A", "方案 B"],
					recommendation: "方案 A",
					evidenceIds: [candidateId],
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext({
			ui: {
				select: async (title, options) => {
					selectCalls.push({ title, options: [...options] });
					return "方案 B";
				},
			},
		}),
	);
	assert.equal(ambiguityResult.details.status, "ambiguous");
	assert.match(harness.observedStatuses.join("\n"), /WAIT_USER/);
	assert.equal(selectCalls.length, 1);
	assert.equal(selectCalls[0]?.title, "採用哪一個產品方案？");
	assert.ok(selectCalls[0]?.options.includes("方案 B"));

	const baseline = harness.observedUserMessageCalls.length;
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const resumedMessages = harness.observedUserMessageCalls.slice(baseline);
	assert.equal(resumedMessages.length, 1);
	const resumedContent = resumedMessages[0]?.content ?? "";
	const newAdrAttemptId = resumedContent.match(/"attemptId"\s*:\s*"([^"]+)"/)?.[1];
	assert.ok(newAdrAttemptId);
	assert.notEqual(newAdrAttemptId, oldAdrAttemptId);
	assert.match(resumedContent, /"sourceRoundId"\s*:\s*"grill-1"/);
	assert.match(resumedContent, /humanDecisions/);
	assert.match(resumedContent, /adr-boundary/);
	assert.match(resumedContent, /方案 B/);
	assert.match(resumedContent, new RegExp(`\\b${candidateId}\\b`));
	assert.doesNotMatch(resumedContent, /ADR_AMBIGUITY_KNOWLEDGE_SUMMARY_SENTINEL/);

	const finalResult = await adrCompleteTool.execute(
		"call-adr-ambiguity-resume-final",
		{
			attemptId: newAdrAttemptId,
			sourceRoundId: "grill-1",
			outcome: {
				kind: "completed",
				candidate: {
					records: [
						{
							decision: "採用使用者確認的產品方案。",
							rationale: "使用者已在 ADR 邊界決策中選擇方案 B。",
							consequences: ["後續規格依方案 B 展開。"],
							citations: [candidateId],
						},
					],
					handoff: {
						summary: "ADR 邊界已由使用者確認。",
						nextSessionFocus: "依方案 B 開始規格實作。",
						references: ["Documents/CONTEXT.md", "Documents/ADR.md"],
						suggestedSkills: ["/execute-designed-plan"],
					},
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(finalResult.details.status, "accepted");
	const contextContent = readFileSync(join(rootDir, "Documents", "CONTEXT.md"), "utf8");
	assert.match(contextContent, /adr-boundary/);
	assert.match(contextContent, /方案 B/);
	assert.match(contextContent, new RegExp(`\\b${candidateId}\\b`));
	assert.doesNotMatch(contextContent, /ADR_AMBIGUITY_KNOWLEDGE_SUMMARY_SENTINEL/);
});

test("AdrComplete_WhenDocumentsChangedAfterContextStart_ShouldFailClosedWithoutOverwrite", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, candidateId, understandingTool, identity } = await prepareKnowledgeUnderstanding(
		rootDir,
		"adr-documents-conflict",
	);
	const deepResult = await understandingTool(
		"call-adr-documents-conflict-deep",
		{
			...identity,
			outcome: {
				kind: "completed",
				knowledgeSummary: "ADR_DOCUMENTS_CONFLICT_KNOWLEDGE_SUMMARY_SENTINEL",
				decisions: [],
				findings: [{ statement: "可追溯的 ADR 證據。", evidenceIds: [candidateId] }],
				limitations: [],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(deepResult.details.status, "accepted");

	assert.ok(harness.agentSettledHandler, "Expected agent_settled handler for pending Context Build");
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const contextMessage = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const contextAttemptId = contextMessage.match(/"attemptId"\s*:\s*"([^"]+)"/)?.[1];
	const contextSourceRoundId = contextMessage.match(/"sourceRoundId"\s*:\s*"([^"]+)"/)?.[1];
	assert.ok(contextAttemptId, "Context invocation must expose attemptId");
	assert.ok(contextSourceRoundId, "Context invocation must expose sourceRoundId");

	const contextCompleteTool = harness.registeredTools.get("forge_context_complete");
	assert.ok(contextCompleteTool?.execute, "Expected forge_context_complete to be registered");
	const contextResult = await contextCompleteTool.execute(
		"call-adr-documents-conflict-context",
		{
			attemptId: contextAttemptId,
			sourceRoundId: contextSourceRoundId,
			outcome: {
				kind: "completed",
				candidate: {
					glossary: [{ term: "產品範圍", definition: "使用者確認的新產品需求邊界。", evidenceIds: [candidateId] }],
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(contextResult.details.status, "accepted");
	assert.deepEqual(harness.getActiveTools(), ["forge_adr_complete"]);

	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const adrMessage = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const adrAttemptId = adrMessage.match(/"attemptId"\s*:\s*"([^"]+)"/)?.[1];
	const adrSourceRoundId = adrMessage.match(/"sourceRoundId"\s*:\s*"([^"]+)"/)?.[1];
	assert.ok(adrAttemptId, "ADR invocation must expose attemptId");
	assert.ok(adrSourceRoundId, "ADR invocation must expose sourceRoundId");

	const documentsDir = join(rootDir, "Documents");
	mkdirSync(documentsDir, { recursive: true });
	const externalContext = "外部流程已先寫入的 CONTEXT 內容。\n";
	writeFileSync(join(documentsDir, "CONTEXT.md"), externalContext, "utf8");

	const adrCompleteTool = harness.registeredTools.get("forge_adr_complete");
	assert.ok(adrCompleteTool?.execute, "Expected forge_adr_complete to be registered");
	const adrResult = await adrCompleteTool.execute(
		"call-adr-documents-conflict-adr",
		{
			attemptId: adrAttemptId,
			sourceRoundId: adrSourceRoundId,
			outcome: {
				kind: "completed",
				candidate: {
					records: [
						{
							decision: "採用使用者確認的產品範圍作為本輪規格邊界。",
							rationale: "目前唯一可追溯證據來自使用者確認的 Grill 前提。",
							consequences: ["後續實作不得超出已確認的產品範圍。"],
							citations: [candidateId],
						},
					],
					handoff: {
						summary: "已完成 Context 與 ADR 設計決策。",
						nextSessionFocus: "依 ADR 開始產品規格實作。",
						references: ["Documents/CONTEXT.md", "Documents/ADR.md"],
						suggestedSkills: ["/execute-designed-plan"],
					},
				},
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(adrResult.details.status, "conflict");
	assert.equal(readFileSync(join(documentsDir, "CONTEXT.md"), "utf8"), externalContext);
	assert.equal(readdirSync(documentsDir).includes("ADR.md"), false);
	assert.equal(readdirSync(documentsDir).includes("handoff.md"), false);
	assert.deepEqual(harness.getActiveTools(), ["forge_adr_complete"]);
	assert.match(harness.observedStatuses.at(-1) ?? "", /ADR_BUILD/);
	assert.doesNotMatch(harness.observedStatuses.join("\n"), /TO_SPEC/);
});

test("Extension_WhenEmptyDiscoveryHasHumanConfirmation_ShouldEnterDeepWithoutSecondGrillRound", async (t) => {
	const rootDir = createTempRoot();
	rmSync(join(rootDir, "wiki", "boundary.md"));
	writeWorkspaceFile(rootDir, "code_base/src/unrelated.ts", "export const unrelated = true;\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });

	const firstRound = await harness.sendInput("請幫我開始一個全新產品，不存在既有知識文件");
	assert.match((firstRound as { text?: string }).text ?? "", /grill-1/);
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute, "Expected forge_grill_complete to expose execute");
	let consentTitle = "";
	let consentOptions: string[] = [];
	await grillCompleteTool.execute(
		"call-empty-discovery-confirmation",
		{
			roundId: "grill-1",
			status: "NEEDS_CONFIRMATION",
			questions: [{
				id: "model-question-id-not-consent",
				question: "模型原始問題：不應沿用這個問題",
				options: ["模型選項 A", "模型選項 B"],
			}],
			recommendation: { value: "同意", reason: "找不到既有知識文件。", confidence: 0.8 },
			evidence: [],
			requiresUserConfirmation: true,
		},
		undefined,
		undefined,
		harness.buildContext({
			ui: {
				select: async (title, options) => {
					consentTitle = title;
					consentOptions = options;
					return undefined;
				},
			},
		}),
	);
	assert.equal(consentTitle, emptyDiscoveryExploratoryConsentQuestion);
	assert.deepEqual(consentOptions, ["同意", "不同意", "自行輸入…"]);

	const answerResult = await harness.sendInput("同意");

	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);
	assert.match(harness.observedStatuses.at(-1) ?? "", /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.doesNotMatch((answerResult as { text?: string }).text ?? "", /roundId\s*[:=]\s*grill-2/);
});

test("Extension_WhenEmptyDiscoveryAnswerIsNotExplicitApproval_ShouldRemainWaiting", async (t) => {
	const rootDir = createTempRoot();
	rmSync(join(rootDir, "wiki", "boundary.md"));
	writeWorkspaceFile(rootDir, "code_base/src/unrelated.ts", "export const unrelated = true;\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });

	await harness.sendInput("請幫我開始一個全新產品，不存在既有知識文件");
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	let consentTitle = "";
	let consentOptions: string[] = [];
	await grillCompleteTool.execute("call-empty-discovery-rejection", {
		roundId: "grill-1",
		status: "NEEDS_CONFIRMATION",
		questions: [{
			id: "model-question-id-not-consent",
			question: "模型原始問題：不應沿用這個問題",
			options: ["模型選項 A", "模型選項 B"],
		}],
		recommendation: { value: "同意", reason: "找不到既有知識文件。", confidence: 0.8 },
		evidence: [],
		requiresUserConfirmation: true,
	}, undefined, undefined, harness.buildContext({
		ui: {
			select: async (title, options) => {
				consentTitle = title;
				consentOptions = options;
				return undefined;
			},
		},
	}));
	assert.equal(consentTitle, emptyDiscoveryExploratoryConsentQuestion);
	assert.deepEqual(consentOptions, ["同意", "不同意", "自行輸入…"]);

	const rejectedAnswer = "拒絕探索性開發-unique-public-seam";
	const answerResult = await harness.sendInput(rejectedAnswer);
	assert.deepEqual(answerResult, { action: "handled" });
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER|GRILL/);
	assert.deepEqual(harness.getActiveTools().sort(), ["forge_grill_complete", "forge_grill_evidence"]);
	assert.equal(harness.observedUserMessageCalls.some(({ content }) => content.includes(rejectedAnswer)), false);

	const approvedResult = await harness.sendInput("同意");
	assert.match((approvedResult as { text?: string }).text ?? "", /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.doesNotMatch((approvedResult as { text?: string }).text ?? "", new RegExp(rejectedAnswer));
	assert.match(harness.observedStatuses.at(-1) ?? "", /DEEP_KNOWLEDGE_RETRIEVAL/);
});

test("DeepCompletion_WhenOnlyGrillHumanPremiseExists_ShouldEnterContextBuild", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read", "write"] });
	await harness.sendInput("請幫我整理一個沒有既有資料的新產品規範");

	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute, "Expected forge_grill_complete to expose execute");
	await grillCompleteTool.execute("call-human-premise-grill-confirmation", {
		roundId: "grill-1",
		status: "NEEDS_CONFIRMATION",
		questions: [{
			id: emptyDiscoveryExploratoryConsentId,
			question: emptyDiscoveryExploratoryConsentQuestion,
			options: ["同意", "不同意"],
		}],
		recommendation: { value: "確認", reason: "新產品尚無外部資料。", confidence: 0.8 },
		evidence: [],
		requiresUserConfirmation: true,
	}, undefined, undefined, harness.buildContext());
	await harness.sendInput("同意");
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);

	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute, "Expected forge_deep_retrieval_complete to expose execute");
	const retrievalResult = await retrievalTool.execute("call-human-premise-retrieval-complete", {
		attemptId: "deep-1",
		sourceRoundId: "grill-1",
		phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "completed" },
	}, undefined, undefined, harness.buildContext());
	assert.equal(retrievalResult.details.status, "accepted", JSON.stringify(retrievalResult.details));

	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingTool?.execute, "Expected forge_deep_complete to expose execute");
	const completeResult = await understandingTool.execute("call-human-premise-understanding", {
		attemptId: "deep-1",
		sourceRoundId: "grill-1",
		phase: "KNOWLEDGE_UNDERSTANDING",
		outcome: {
			kind: "completed",
			knowledgeSummary: "以使用者確認前提建立規範。",
			decisions: [],
			findings: [],
			limitations: [],
		},
	}, undefined, undefined, harness.buildContext());

	assert.equal(completeResult.details.status, "accepted");
	assert.match(harness.observedStatuses.join("\n"), /CONTEXT_BUILD/);
	const evidencePackage = completeResult.details.evidencePackage as {
		evidence: Array<{ origin: string; metadata: Record<string, unknown> }>;
	};
	const premise = evidencePackage.evidence.find((evidence) => evidence.origin === "human_premise");
	assert.ok(premise, "Expected human premise evidence");
	assert.equal(premise.metadata.roundId, "grill-1");
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
	intentRoute?: "passthrough" | "start_forge";
} = {}) {
	const { default: forgeRuntimeExtension } = await import("../../extensions/forge-runtime.ts");
	const commands = new Map<string, RegisteredCommand>();
	const eventHandlers = new Map<string, RegisteredEventHandler>();
	const registeredTools = new Map<string, RegisteredTool>();
	let activeTools = [...(options.initialActiveTools ?? [])];
	const observedMessages: string[] = [];
	const observedMessagePayloads: Array<{
		content?: unknown;
		display?: unknown;
		customType?: unknown;
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" | "displayOnly" };
	}> = [];
	const observedStatuses: string[] = [];
	const observedStatusCalls: Array<{ key: string; text: string | undefined }> = [];
	const observedNotifications: string[] = [];
	const observedUserMessages: string[] = [];
	const observedUserMessageCalls: SentUserMessage[] = [];
	const observedModelRequests: string[] = [];
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
		async sendMessage(
			message: { content?: unknown; display?: unknown; customType?: unknown },
			sendOptions?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" | "displayOnly" },
		) {
			observedMessagePayloads.push({ ...message, options: sendOptions });
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
			setStatus?(key: string, text: string | undefined): void;
		};
	} = {}) {
		return {
			cwd: overrides.cwd ?? options.cwd,
			model: {},
			modelRegistry: {
				complete: async (_model: object, request: { messages: Array<{ content: Array<{ text: string }> }> }) => {
					observedModelRequests.push(request.messages[0]?.content[0]?.text ?? "");
					return { content: [{ type: "text", text: JSON.stringify({ route: options.intentRoute ?? "start_forge" }) }] };
				},
			},
			newSession:
				overrides.newSession ?? options.newSession ?? (shouldReenterReplacementSession ? startReplacementSession : undefined),
			ui: {
				notify: (message: string) => {
					observedNotifications.push(message);
				},
				setStatus: (key: string, text: string | undefined) => {
					observedStatusCalls.push({ key, text });
					if (text !== undefined) observedStatuses.push(text);
				},
				...overrides.ui,
			},
		};
	}

	return {
		command,
			inputHandler: eventHandlers.get("input"),
			messageEndHandler: eventHandlers.get("message_end"),
			messageStartHandler: eventHandlers.get("message_start"),
			toolExecutionEndHandler: eventHandlers.get("tool_execution_end"),
			toolResultHandler: eventHandlers.get("tool_result"),
			agentSettledHandler: eventHandlers.get("agent_settled"),
			messageUpdateHandler: eventHandlers.get("message_update"),
		toolCallHandler: eventHandlers.get("tool_call"),
		registeredTools,
		getActiveTools() {
			return [...activeTools];
		},
		disableSetActiveTools() {
			delete (fakePi as { setActiveTools?: unknown }).setActiveTools;
		},
			observedMessages,
			observedMessagePayloads,
		observedNotifications,
		observedStatuses,
		observedStatusCalls,
		observedUserMessageCalls,
		observedUserMessages,
		observedModelRequests,
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
			setStatus(key: string, text: string | undefined) {
				observedStatusCalls.push({ key, text });
				if (text !== undefined) observedStatuses.push(text);
			},
		},
	};
}

type ExtensionHarness = Awaited<ReturnType<typeof createExtensionHarness>>;

async function settlePendingDeepPrompt(harness: ExtensionHarness): Promise<string> {
	const baseline = harness.observedUserMessageCalls.length;
	assert.ok(harness.agentSettledHandler, "Expected agent_settled handler for pending Deep prompt");
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const prompts = harness.observedUserMessageCalls.slice(baseline);
	assert.equal(prompts.length, 1);
	assert.equal(prompts[0]?.options?.deliverAs, undefined);
	return prompts[0]?.content ?? "";
}

test("GrillCheckpoint_WhenLimitIsReached_ShouldNotQueueFollowUp", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/grill-checkpoint.ts", "// GrillCheckpointNeedle evidence.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, intentRoute: "start_forge" });
	const grillComplete = harness.registeredTools.get("forge_grill_complete");
	const grillEvidence = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(grillComplete, "Expected forge_grill_complete tool");
	assert.ok(grillEvidence, "Expected forge_grill_evidence tool");
	const grillCompleteExecute = grillComplete.execute;
	assert.ok(grillCompleteExecute);
	const grillEvidenceExecute = grillEvidence.execute;
	assert.ok(grillEvidenceExecute);

	const initialResult = await harness.sendInput("請幫我釐清 GrillCheckpointNeedle grill-checkpoint.ts");
	const initialInvocation = (initialResult as { text?: string }).text ?? "";
	assert.equal((initialResult as { action?: string }).action, "transform");
	assert.ok(initialInvocation, "Expected initial Grill invocation");
	assert.match(initialInvocation, /grill-1/);
	let invocation = initialInvocation;
	const firstRoundId = /目前 Grill roundId:\s*(\S+)/.exec(initialInvocation)?.[1];
	assert.ok(firstRoundId, "Expected initial Grill roundId");
	const candidateId = /\bev-[0-9a-f]{64}\b/.exec(initialInvocation)?.[0];
	if (!candidateId) assert.fail("Expected a Grill evidence candidate");
	assert.equal(harness.observedUserMessageCalls.length, 0);
	await grillEvidenceExecute("evidence-1", { candidateId }, undefined, undefined, harness.buildContext() as never);

	const completeRound = async (roundId: string) => {
		await grillCompleteExecute(
			`complete-${roundId}`,
			{
				evidence: [candidateId],
				questions: [{ id: `decision-${roundId}`, options: ["接受", "調整"], question: `第 ${roundId} 題決定` }],
				recommendation: { value: "接受", reason: "需要使用者確認" },
				requiresUserConfirmation: true,
				roundId,
				status: "NEEDS_CONFIRMATION",
			},
			undefined,
			undefined,
			harness.buildContext() as never,
		);
		await Promise.resolve();
	};

	for (let answerIndex = 1; answerIndex <= 8; answerIndex += 1) {
		const roundId = /目前 Grill roundId:\s*(\S+)/.exec(invocation)?.[1] ?? firstRoundId;
		await completeRound(roundId);
		const followUpCountBeforeAnswer: number = harness.observedUserMessageCalls.length;
		const answerResult = await harness.sendInput(`回答 ${answerIndex}`);
		if (answerIndex < 8) {
			assert.equal((answerResult as { action?: string }).action, "transform");
			const nextInvocation = (answerResult as { text?: string }).text ?? "";
			assert.ok(nextInvocation, `Expected follow-up invocation after answer ${answerIndex}`);
			assert.match(nextInvocation, new RegExp(`grill-${answerIndex + 1}`));
			invocation = nextInvocation;
		} else {
			assert.equal((answerResult as { action?: string }).action, "handled");
			assert.doesNotMatch((answerResult as { text?: string }).text ?? "", /grill-9/);
			assert.equal(
				harness.observedUserMessageCalls.length,
				followUpCountBeforeAnswer,
				"The checkpoint answer must not queue a pending replay invocation",
			);
		}
	}

	assert.ok(harness.observedStatuses.some((status) => status.includes("WAIT_USER")), "Expected WAIT_USER state");
});

test("GrillCheckpoint_WhenContinueOneIsSelected_ShouldQueueExactlyOneNormalRound", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/grill-checkpoint.ts", "// GrillCheckpointNeedle evidence.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, intentRoute: "start_forge" });
	const grillComplete = harness.registeredTools.get("forge_grill_complete");
	const grillEvidence = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(grillComplete, "Expected forge_grill_complete tool");
	assert.ok(grillEvidence, "Expected forge_grill_evidence tool");
	const grillCompleteExecute = grillComplete.execute;
	assert.ok(grillCompleteExecute);
	const grillEvidenceExecute = grillEvidence.execute;
	assert.ok(grillEvidenceExecute);

	const initialResult = await harness.sendInput("請幫我釐清 GrillCheckpointNeedle grill-checkpoint.ts");
	const initialInvocation = (initialResult as { text?: string }).text ?? "";
	assert.equal((initialResult as { action?: string }).action, "transform");
	assert.ok(initialInvocation, "Expected initial Grill invocation");
	assert.match(initialInvocation, /grill-1/);
	let invocation = initialInvocation;
	const firstRoundId = /目前 Grill roundId:\s*(\S+)/.exec(initialInvocation)?.[1];
	assert.ok(firstRoundId, "Expected initial Grill roundId");
	const candidateId = /\bev-[0-9a-f]{64}\b/.exec(initialInvocation)?.[0];
	if (!candidateId) assert.fail("Expected a Grill evidence candidate");
	assert.equal(harness.observedUserMessageCalls.length, 0);
	await grillEvidenceExecute("evidence-1", { candidateId }, undefined, undefined, harness.buildContext() as never);

	const completeRound = async (roundId: string) => {
		await grillCompleteExecute(
			`complete-${roundId}`,
			{
				evidence: [candidateId],
				questions: [{ id: `decision-${roundId}`, options: ["接受", "調整"], question: `第 ${roundId} 題決定` }],
				recommendation: { value: "接受", reason: "需要使用者確認" },
				requiresUserConfirmation: true,
				roundId,
				status: "NEEDS_CONFIRMATION",
			},
			undefined,
			undefined,
			harness.buildContext() as never,
		);
		await Promise.resolve();
	};

	for (let answerIndex = 1; answerIndex <= 8; answerIndex += 1) {
		const roundId = /目前 Grill roundId:\s*(\S+)/.exec(invocation)?.[1] ?? firstRoundId;
		await completeRound(roundId);
		const answerResult = await harness.sendInput(`回答 ${answerIndex}`);
		if (answerIndex < 8) {
			assert.equal((answerResult as { action?: string }).action, "transform");
			const nextInvocation = (answerResult as { text?: string }).text ?? "";
			assert.ok(nextInvocation, `Expected follow-up invocation after answer ${answerIndex}`);
			assert.match(nextInvocation, new RegExp(`grill-${answerIndex + 1}`));
			invocation = nextInvocation;
		} else {
			assert.equal((answerResult as { action?: string }).action, "handled");
			assert.doesNotMatch((answerResult as { text?: string }).text ?? "", /grill-9/);
		}
	}

	const continueResult = await harness.sendInput("continue_one");
	const continueInvocation = (continueResult as { text?: string }).text ?? "";
	assert.equal((continueResult as { action?: string }).action, "transform");
	assert.ok(continueInvocation, "Expected exactly one normal Grill round");
	assert.match(continueInvocation, /grill-9/);
	assert.doesNotMatch(continueInvocation, /這是明確收斂 round。/);
	const continueRoundId = /目前 Grill roundId:\s*(\S+)/.exec(continueInvocation)?.[1];
	assert.ok(continueRoundId, "Expected continue_one Grill roundId");
	const followUpCountBeforeContinueRound = harness.observedUserMessageCalls.length;

	await completeRound(continueRoundId);
	const finalResult = await harness.sendInput("回答 continue_one 後的一輪");
	assert.equal((finalResult as { action?: string }).action, "handled");
	assert.doesNotMatch((finalResult as { text?: string }).text ?? "", /grill-10/);
	assert.equal(
		harness.observedUserMessageCalls.length,
		followUpCountBeforeContinueRound,
		"The completed continue_one round must not queue another normal round",
	);
	assert.ok(harness.observedStatuses.some((status) => status.includes("WAIT_USER")), "Expected WAIT_USER state");
});

test("GrillCheckpoint_WhenCancelIsSelected_ShouldResetToReceiveAndRestoreTools", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/grill-checkpoint.ts", "// GrillCheckpointNeedle evidence.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, intentRoute: "start_forge", initialActiveTools: ["read", "write"] });
	const grillComplete = harness.registeredTools.get("forge_grill_complete");
	const grillEvidence = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(grillComplete, "Expected forge_grill_complete tool");
	assert.ok(grillEvidence, "Expected forge_grill_evidence tool");
	const grillCompleteExecute = grillComplete.execute;
	assert.ok(grillCompleteExecute);
	const grillEvidenceExecute = grillEvidence.execute;
	assert.ok(grillEvidenceExecute);

	const initialResult = await harness.sendInput("請幫我釐清 GrillCheckpointNeedle grill-checkpoint.ts");
	let invocation = (initialResult as { text?: string }).text ?? "";
	assert.equal((initialResult as { action?: string }).action, "transform");
	const firstRoundId = /目前 Grill roundId:\s*(\S+)/.exec(invocation)?.[1];
	assert.ok(firstRoundId, "Expected initial Grill roundId");
	const candidateId = /\bev-[0-9a-f]{64}\b/.exec(invocation)?.[0];
	if (!candidateId) assert.fail("Expected a Grill evidence candidate");
	await grillEvidenceExecute("cancel-checkpoint-evidence", { candidateId }, undefined, undefined, harness.buildContext() as never);

	for (let answerIndex = 1; answerIndex <= 8; answerIndex += 1) {
		const roundId = /目前 Grill roundId:\s*(\S+)/.exec(invocation)?.[1] ?? firstRoundId;
		await grillCompleteExecute(
			`cancel-checkpoint-complete-${roundId}`,
			{
				evidence: [candidateId],
				questions: [{ id: `cancel-checkpoint-decision-${roundId}`, options: ["接受", "調整"], question: `第 ${roundId} 題決定` }],
				recommendation: { value: "接受", reason: "需要使用者確認" },
				requiresUserConfirmation: true,
				roundId,
				status: "NEEDS_CONFIRMATION",
			},
			undefined,
			undefined,
			harness.buildContext() as never,
		);
		const answerResult = await harness.sendInput(`取消測試前的第 ${answerIndex} 題`);
		if (answerIndex < 8) {
			assert.equal((answerResult as { action?: string }).action, "transform");
			invocation = (answerResult as { text?: string }).text ?? "";
			assert.match(invocation, new RegExp(`grill-${answerIndex + 1}`));
		} else {
			assert.equal((answerResult as { action?: string }).action, "handled");
		}
	}

	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	const messageCountBeforeCancel = harness.observedUserMessageCalls.length;
	const statusCountBeforeCancel = harness.observedStatuses.length;

	await harness.sendInput("cancel");
	assert.equal(harness.observedStatuses.at(-1), "Forge RECEIVE [active]");
	assert.deepEqual(harness.getActiveTools(), ["read", "write"]);
	assert.equal(harness.observedUserMessageCalls.length, messageCountBeforeCancel);
	assert.equal(
		harness.observedStatuses.slice(statusCountBeforeCancel).some((status) => /GRILL|DEEP_KNOWLEDGE_RETRIEVAL|WAIT_USER/.test(status)),
		false,
		"取消 checkpoint 後不得保留 waitUser 或建立 follow-up / 新 Grill",
	);
});

test("GrillCheckpoint_WhenConvergeIsSelected_ShouldQueueExactlyOneConvergenceRound", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/grill-checkpoint.ts", "// GrillCheckpointNeedle evidence.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, intentRoute: "start_forge" });
	const grillComplete = harness.registeredTools.get("forge_grill_complete");
	const grillEvidence = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(grillComplete, "Expected forge_grill_complete tool");
	assert.ok(grillEvidence, "Expected forge_grill_evidence tool");
	const grillCompleteExecute = grillComplete.execute;
	assert.ok(grillCompleteExecute);
	const grillEvidenceExecute = grillEvidence.execute;
	assert.ok(grillEvidenceExecute);

	const initialResult = await harness.sendInput("請幫我釐清 GrillCheckpointNeedle grill-checkpoint.ts");
	const initialInvocation = (initialResult as { text?: string }).text ?? "";
	assert.equal((initialResult as { action?: string }).action, "transform");
	assert.ok(initialInvocation, "Expected initial Grill invocation");
	assert.match(initialInvocation, /grill-1/);
	let invocation = initialInvocation;
	const firstRoundId = /目前 Grill roundId:\s*(\S+)/.exec(initialInvocation)?.[1];
	assert.ok(firstRoundId, "Expected initial Grill roundId");
	const candidateId = /\bev-[0-9a-f]{64}\b/.exec(initialInvocation)?.[0];
	if (!candidateId) assert.fail("Expected a Grill evidence candidate");
	await grillEvidenceExecute("evidence-1", { candidateId }, undefined, undefined, harness.buildContext() as never);

	const completeRound = async (roundId: string, question = `第 ${roundId} 題決定`) => {
		await grillCompleteExecute(
			`complete-${roundId}`,
			{
				evidence: [candidateId],
				questions: [{ id: `decision-${roundId}`, options: ["接受", "調整"], question }],
				recommendation: { value: "接受", reason: "需要使用者確認" },
				requiresUserConfirmation: true,
				roundId,
				status: "NEEDS_CONFIRMATION",
			},
			undefined,
			undefined,
			harness.buildContext() as never,
		);
		await Promise.resolve();
	};

	for (let answerIndex = 1; answerIndex <= 8; answerIndex += 1) {
		const roundId = /目前 Grill roundId:\s*(\S+)/.exec(invocation)?.[1] ?? firstRoundId;
		await completeRound(roundId);
		const answerResult = await harness.sendInput(`回答 ${answerIndex}`);
		if (answerIndex < 8) {
			assert.equal((answerResult as { action?: string }).action, "transform");
			const nextInvocation = (answerResult as { text?: string }).text ?? "";
			assert.ok(nextInvocation, `Expected follow-up invocation after answer ${answerIndex}`);
			assert.match(nextInvocation, new RegExp(`grill-${answerIndex + 1}`));
			invocation = nextInvocation;
		} else {
			assert.equal((answerResult as { action?: string }).action, "handled");
			assert.doesNotMatch((answerResult as { text?: string }).text ?? "", /grill-9/);
		}
	}

	const convergeResult = await harness.sendInput("converge");
	const convergeInvocation = (convergeResult as { text?: string }).text ?? "";
	assert.equal((convergeResult as { action?: string }).action, "transform");
	assert.ok(convergeInvocation, "Expected exactly one convergence Grill round");
	assert.match(convergeInvocation, /grill-9/);
	assert.match(convergeInvocation, /明確收斂 round/);
	assert.match(convergeInvocation, /Deep Retrieval|DEEP_KNOWLEDGE_RETRIEVAL/i);
	assert.match(convergeInvocation, /objective knowledge|客觀知識/i);
	assert.match(convergeInvocation, /evidence|證據/i);
	assert.match(convergeInvocation, /(?:不得|不應|不可|不能|不要)/i);
	assert.match(convergeInvocation, /implementation detail|實作細節|實現細節/i);
	assert.match(convergeInvocation, /問題|阻塞|blocker/i);
	const convergeRoundId = /目前 Grill roundId:\s*(\S+)/.exec(convergeInvocation)?.[1];
	assert.ok(convergeRoundId, "Expected converge roundId");

	const deepPromptCountBeforeCompletion = harness.observedUserMessageCalls.length;
	const completionResult = await grillCompleteExecute(
		`complete-${convergeRoundId}`,
		{
			evidence: [candidateId],
			questions: [],
			recommendation: {
				value: "READY_FOR_DEEP",
				reason: "沒有真正知識盲點，只缺 Deep Retrieval 的客觀知識或證據。",
			},
			requiresUserConfirmation: false,
			roundId: convergeRoundId,
			status: "READY_FOR_DEEP",
		},
		undefined,
		undefined,
		harness.buildContext() as never,
	);
	assert.equal((completionResult as { terminate?: boolean }).terminate, true);
	assert.equal((completionResult as { details?: { status?: string } }).details?.status, "READY_FOR_DEEP");
	assert.equal(harness.observedUserMessageCalls.length, deepPromptCountBeforeCompletion);
	assert.match(harness.observedStatuses.at(-1) ?? "", /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);

	const deepInvocation = await settlePendingDeepPrompt(harness);
	assert.match(deepInvocation, /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.equal(harness.observedUserMessageCalls.length, deepPromptCountBeforeCompletion + 1);
	assert.doesNotMatch(deepInvocation, /grill-10|grill_checkpoint|WAIT_USER/);
	assert.equal(
		harness.observedUserMessageCalls.filter(({ content }) => content.includes("DEEP_KNOWLEDGE_RETRIEVAL")).length,
		1,
		"Convergence READY_FOR_DEEP must start exactly one Deep Retrieval invocation",
	);

	const blindSpotRootDir = createTempRoot();
	writeWorkspaceFile(blindSpotRootDir, "code_base/src/grill-checkpoint.ts", "// GrillCheckpointNeedle evidence.\n");
	t.after(() => rmSync(blindSpotRootDir, { force: true, recursive: true }));
	const blindSpotHarness = await createExtensionHarness({ cwd: blindSpotRootDir, intentRoute: "start_forge" });
	const blindSpotComplete = blindSpotHarness.registeredTools.get("forge_grill_complete");
	const blindSpotEvidence = blindSpotHarness.registeredTools.get("forge_grill_evidence");
	assert.ok(blindSpotComplete, "Expected forge_grill_complete tool for knowledge blind spot");
	assert.ok(blindSpotEvidence, "Expected forge_grill_evidence tool for knowledge blind spot");
	const blindSpotCompleteExecute = blindSpotComplete.execute;
	assert.ok(blindSpotCompleteExecute);
	const blindSpotEvidenceExecute = blindSpotEvidence.execute;
	assert.ok(blindSpotEvidenceExecute);
	const blindSpotInitial = await blindSpotHarness.sendInput("請幫我釐清 GrillCheckpointNeedle grill-checkpoint.ts");
	let blindSpotInvocation = (blindSpotInitial as { text?: string }).text ?? "";
	assert.equal((blindSpotInitial as { action?: string }).action, "transform");
	const blindSpotFirstRoundId = /目前 Grill roundId:\s*(\S+)/.exec(blindSpotInvocation)?.[1];
	assert.ok(blindSpotFirstRoundId, "Expected knowledge blind spot initial Grill roundId");
	const blindSpotCandidateId = /\bev-[0-9a-f]{64}\b/.exec(blindSpotInvocation)?.[0];
	if (!blindSpotCandidateId) assert.fail("Expected a Grill evidence candidate for knowledge blind spot");
	await blindSpotEvidenceExecute(
		"blind-spot-evidence-1",
		{ candidateId: blindSpotCandidateId },
		undefined,
		undefined,
		blindSpotHarness.buildContext() as never,
	);
	for (let answerIndex = 1; answerIndex <= 8; answerIndex += 1) {
		const roundId = /目前 Grill roundId:\s*(\S+)/.exec(blindSpotInvocation)?.[1] ?? blindSpotFirstRoundId;
		await blindSpotCompleteExecute(
			`blind-spot-complete-${roundId}`,
			{
				evidence: [blindSpotCandidateId],
				questions: [{ id: `blind-spot-decision-${roundId}`, options: ["接受", "調整"], question: `第 ${roundId} 題決定` }],
				recommendation: { value: "接受", reason: "需要使用者確認" },
				requiresUserConfirmation: true,
				roundId,
				status: "NEEDS_CONFIRMATION",
			},
			undefined,
			undefined,
			blindSpotHarness.buildContext() as never,
		);
		const answerResult = await blindSpotHarness.sendInput(`回答知識盲點前的第 ${answerIndex} 題`);
		if (answerIndex < 8) {
			assert.equal((answerResult as { action?: string }).action, "transform");
			blindSpotInvocation = (answerResult as { text?: string }).text ?? "";
			assert.match(blindSpotInvocation, new RegExp(`grill-${answerIndex + 1}`));
		} else {
			assert.equal((answerResult as { action?: string }).action, "handled");
		}
	}

	const blindSpotConvergeResult = await blindSpotHarness.sendInput("converge");
	const blindSpotConvergenceInvocation = (blindSpotConvergeResult as { text?: string }).text ?? "";
	assert.equal((blindSpotConvergeResult as { action?: string }).action, "transform");
	assert.match(blindSpotConvergenceInvocation, /grill-9/);
	assert.match(blindSpotConvergenceInvocation, /明確收斂 round/);
	assert.match(blindSpotConvergenceInvocation, /Deep Retrieval|DEEP_KNOWLEDGE_RETRIEVAL/i);
	assert.match(blindSpotConvergenceInvocation, /objective knowledge|客觀知識/i);
	assert.match(blindSpotConvergenceInvocation, /evidence|證據/i);
	assert.match(blindSpotConvergenceInvocation, /(?:不得|不應|不可|不能|不要)/i);
	assert.match(blindSpotConvergenceInvocation, /implementation detail|實作細節|實現細節/i);
	assert.match(blindSpotConvergenceInvocation, /問題|阻塞|blocker/i);
	const blindSpotRoundId = /目前 Grill roundId:\s*(\S+)/.exec(blindSpotConvergenceInvocation)?.[1];
	assert.ok(blindSpotRoundId, "Expected knowledge blind spot convergence roundId");
	const deepPromptCountBeforeBlindSpotAnswer = blindSpotHarness.observedUserMessageCalls.length;
	const blindSpotCompletion = await blindSpotCompleteExecute(
		`blind-spot-converge-${blindSpotRoundId}`,
		{
			evidence: [blindSpotCandidateId],
			questions: [{ id: "objective-knowledge-gap", options: ["補充客觀知識"], question: "缺少哪一項客觀知識證據？" }],
			recommendation: { value: "需要一項客觀知識證據", reason: "真正知識盲點：缺少客觀知識或證據" },
			requiresUserConfirmation: true,
			roundId: blindSpotRoundId,
			status: "NEEDS_CONFIRMATION",
		},
		undefined,
		undefined,
		blindSpotHarness.buildContext() as never,
	);
	await Promise.resolve();
	assert.equal((blindSpotCompletion as { terminate?: boolean }).terminate, true);
	assert.equal((blindSpotCompletion as { details?: { status?: string } }).details?.status, "NEEDS_CONFIRMATION");

	const blindSpotAnswer = await blindSpotHarness.sendInput("補充：客觀知識證據是官方規格中的限制");
	assert.equal((blindSpotAnswer as { action?: string }).action, "transform");
	const blindSpotDeepInvocation = (blindSpotAnswer as { text?: string }).text ?? "";
	assert.match(blindSpotDeepInvocation, /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.doesNotMatch(blindSpotDeepInvocation, /grill-10|grill_checkpoint|WAIT_USER/);
	assert.equal(blindSpotHarness.observedUserMessageCalls.length, deepPromptCountBeforeBlindSpotAnswer);
	assert.deepEqual(blindSpotHarness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);
});

test("GrillCheckpoint_WhenConvergeReadyHasOnlyWiki_ShouldEnterDeepWithoutRelevanceQuestion", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "wiki/ConvergenceOnlyWikiNeedle.md", "ConvergenceOnlyWikiNeedle 的客觀知識來源。\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, intentRoute: "start_forge" });
	const grillComplete = harness.registeredTools.get("forge_grill_complete");
	const grillEvidence = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(grillComplete?.execute);
	assert.ok(grillEvidence?.execute);
	const grillCompleteExecute = grillComplete.execute;
	const grillEvidenceExecute = grillEvidence.execute;
	const initialResult = await harness.sendInput("請幫我釐清 ConvergenceOnlyWikiNeedle");
	let invocation = (initialResult as { text?: string }).text ?? "";
	const firstRoundId = /目前 Grill roundId:\s*(\S+)/.exec(invocation)?.[1];
	assert.ok(firstRoundId);
	const candidateId = /\bev-[0-9a-f]{64}\b/.exec(invocation)?.[0];
	assert.ok(candidateId);
	await grillEvidenceExecute("convergence-only-wiki-evidence", { candidateId }, undefined, undefined, harness.buildContext());
	for (let answerIndex = 1; answerIndex <= 8; answerIndex += 1) {
		const roundId = /目前 Grill roundId:\s*(\S+)/.exec(invocation)?.[1] ?? firstRoundId;
		await grillCompleteExecute(`convergence-only-wiki-complete-${roundId}`, {
			evidence: [candidateId],
			questions: [{ id: `convergence-only-wiki-${roundId}`, options: ["接受"], question: `第 ${roundId} 題決定` }],
			recommendation: { value: "接受", reason: "需要使用者確認" },
			requiresUserConfirmation: true,
			roundId,
			status: "NEEDS_CONFIRMATION",
		}, undefined, undefined, harness.buildContext());
		const answerResult = await harness.sendInput(`回答 ${answerIndex}`);
		if (answerIndex < 8) invocation = (answerResult as { text?: string }).text ?? "";
	}

	const convergeResult = await harness.sendInput("converge");
	const convergeInvocation = (convergeResult as { text?: string }).text ?? "";
	const convergeRoundId = /目前 Grill roundId:\s*(\S+)/.exec(convergeInvocation)?.[1];
	assert.ok(convergeRoundId);
	const convergenceStatusStartIndex = harness.observedStatuses.length;
	const completionResult = await grillCompleteExecute(`convergence-only-wiki-ready-${convergeRoundId}`, {
		evidence: [candidateId],
		questions: [],
		recommendation: { value: "READY_FOR_DEEP", reason: "沒有真正知識盲點，只缺客觀知識或證據。" },
		requiresUserConfirmation: false,
		roundId: convergeRoundId,
		status: "READY_FOR_DEEP",
	}, undefined, undefined, harness.buildContext());
	assert.equal((completionResult as { details?: { status?: string } }).details?.status, "READY_FOR_DEEP");
	const convergenceStatuses = harness.observedStatuses.slice(convergenceStatusStartIndex);
	assert.match(convergenceStatuses.at(-1) ?? "", /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.doesNotMatch(convergenceStatuses.join("\n"), /relevance_clarification|WAIT_USER/);
	assert.doesNotMatch((await settlePendingDeepPrompt(harness)), /relevance_clarification|WAIT_USER/);
});

test("GrillCheckpoint_WhenConvergeHasOneKnowledgeGapWithOnlyWiki_ShouldEnterDeepAfterAnswer", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "wiki/ConvergenceKnowledgeGapNeedle.md", "ConvergenceKnowledgeGapNeedle 的客觀知識來源。\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, intentRoute: "start_forge" });
	const grillComplete = harness.registeredTools.get("forge_grill_complete");
	const grillEvidence = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(grillComplete?.execute);
	assert.ok(grillEvidence?.execute);
	const grillCompleteExecute = grillComplete.execute;
	const grillEvidenceExecute = grillEvidence.execute;
	const initialResult = await harness.sendInput("請幫我釐清 ConvergenceKnowledgeGapNeedle");
	let invocation = (initialResult as { text?: string }).text ?? "";
	const firstRoundId = /目前 Grill roundId:\s*(\S+)/.exec(invocation)?.[1];
	assert.ok(firstRoundId);
	const candidateId = /\bev-[0-9a-f]{64}\b/.exec(invocation)?.[0];
	assert.ok(candidateId);
	await grillEvidenceExecute("convergence-knowledge-gap-evidence", { candidateId }, undefined, undefined, harness.buildContext());
	for (let answerIndex = 1; answerIndex <= 8; answerIndex += 1) {
		const roundId = /目前 Grill roundId:\s*(\S+)/.exec(invocation)?.[1] ?? firstRoundId;
		await grillCompleteExecute(`convergence-knowledge-gap-complete-${roundId}`, {
			evidence: [candidateId],
			questions: [{ id: `convergence-knowledge-gap-${roundId}`, options: ["接受"], question: `第 ${roundId} 題決定` }],
			recommendation: { value: "接受", reason: "需要使用者確認" },
			requiresUserConfirmation: true,
			roundId,
			status: "NEEDS_CONFIRMATION",
		}, undefined, undefined, harness.buildContext());
		const answerResult = await harness.sendInput(`回答 ${answerIndex}`);
		if (answerIndex < 8) invocation = (answerResult as { text?: string }).text ?? "";
	}

	const convergeResult = await harness.sendInput("converge");
	const convergeInvocation = (convergeResult as { text?: string }).text ?? "";
	const convergeRoundId = /目前 Grill roundId:\s*(\S+)/.exec(convergeInvocation)?.[1];
	assert.ok(convergeRoundId);
	const completionResult = await grillCompleteExecute(`convergence-knowledge-gap-${convergeRoundId}`, {
		evidence: [candidateId],
		questions: [{ id: "objective-knowledge-gap", options: ["補充客觀知識"], question: "缺少哪一項客觀知識證據？" }],
		recommendation: { value: "需要一項客觀知識證據", reason: "真正知識盲點：缺少客觀知識或證據" },
		requiresUserConfirmation: true,
		roundId: convergeRoundId,
		status: "NEEDS_CONFIRMATION",
	}, undefined, undefined, harness.buildContext());
	assert.equal((completionResult as { details?: { status?: string } }).details?.status, "NEEDS_CONFIRMATION");
	const answerResult = await harness.sendInput("補充：客觀知識證據是官方規格中的限制");
	const deepInvocation = (answerResult as { text?: string }).text ?? "";
	assert.equal((answerResult as { action?: string }).action, "transform");
	assert.match(deepInvocation, /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.doesNotMatch(deepInvocation, /relevance_clarification|WAIT_USER/);
});

async function transformNeedsDiscoveryToolResult(
	harness: ExtensionHarness,
	toolCallId: string,
	input: unknown,
	executionResult: unknown,
): Promise<string> {
	assert.ok(harness.toolResultHandler, "Expected tool_result handler for completed retrieval lifecycle");
	const result = executionResult as { content?: unknown; details?: unknown; isError?: boolean };
	const originalContent = Array.isArray(result.content) ? result.content : [];
	const beforeMessages = harness.observedUserMessageCalls.length;
	const transformed = await harness.toolResultHandler(
		{
			type: "tool_result",
			toolCallId,
			toolName: "forge_deep_retrieval_complete",
			input,
			content: result.content,
			details: result.details,
			isError: result.isError ?? false,
		},
		harness.buildContext(),
	);
	assert.equal(transformed, undefined, "tool_result handler 不得 transform control invocation");
	assert.doesNotMatch(JSON.stringify(originalContent), /grill-2|forge_grill_complete/);
	assert.ok(harness.agentSettledHandler, "Expected agent_settled handler for settled discovery restart");
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const messages = harness.observedUserMessageCalls.slice(beforeMessages);
	assert.equal(messages.length, 1, "agent settled 後應只新增一則 user message");
	assert.equal(messages[0]?.options?.deliverAs, undefined);
	return messages[0]?.content ?? "";
}

async function openWorkflow(command: RegisteredCommand): Promise<void> {
	await command.handler(`grill ambiguous ${waitUserPayload}`, {});
	await command.handler("confirm", {});
}

test("Extension_WhenSwitchHasNoNewSession_ShouldKeepWaitUserWorkflowAndBlockNonDomainTools", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	await startFormalGrillRound(rootDir, harness.sendInput);
	await harness.runCommand(`grill ambiguous ${waitUserPayload}`);
	const waitUserStatus = harness.observedStatuses.at(-1);
	const activeGrillTools = harness.getActiveTools();

	await harness.runCommand("switch 改題後的需求");

	assert.equal(harness.observedStatuses.at(-1), waitUserStatus);
	assert.deepEqual(harness.getActiveTools(), activeGrillTools);
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

test("Extension_WhenWaitUserHasNoFollowUpBridge_ShouldKeepQuestionForConfirmAndReject", async (t) => {
	const results: Array<{ status: string; message: string; userMessageCount: number }> = [];
	for (const command of ["confirm", "reject 仍需補充風險"]) {
		const rootDir = createTempRoot();
		t.after(() => rmSync(rootDir, { force: true, recursive: true }));
		const harness = await createExtensionHarness({ cwd: rootDir, withoutFollowUpBridge: true });
		await startFormalGrillRound(rootDir, harness.sendInput);
		let selectorTitle = "";

		await harness.runCommand(`grill ambiguous ${waitUserPayload}`, {
			ui: {
				async select(title) {
					selectorTitle = title;
					return undefined;
				},
			},
		});
		await harness.runCommand(command);

		results.push({
			status: harness.observedStatuses.at(-1) ?? "",
			message: selectorTitle,
			userMessageCount: harness.observedUserMessageCalls.length,
		});
	}

	for (const result of results) {
		assert.match(result.status, /WAIT_USER/);
		assert.equal(result.message, "Proceed to deep knowledge retrieval?");
		assert.equal(result.userMessageCount, 0);
	}
});

test("Extension_WhenContinueCannotFollowUp_ShouldKeepWaitUserAndBlockNonDomainTools", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({
		cwd: rootDir,
		initialActiveTools: ["read"],
		withoutFollowUpBridge: true,
	});
	await startFormalGrillRound(rootDir, harness.sendInput);
	await harness.runCommand(`grill ambiguous ${waitUserPayload}`);
	const activeGrillTools = harness.getActiveTools();

	await assert.doesNotReject(harness.runCommand("continue"));

	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.deepEqual(harness.getActiveTools(), activeGrillTools);
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
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read", "write"], reenterFollowUps: true });
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

	assert.deepEqual(completion.content, [{ type: "text", text: "Forge Grill 完成結果已接受。" }]);
	assert.equal(completion.details.status, "READY_FOR_DEEP");
	assert.ok(harness.observedStatuses.at(-1)?.includes("DEEP_KNOWLEDGE_RETRIEVAL"));
	assert.doesNotMatch(harness.observedMessages.join("\n"), /KNOWLEDGE_UNDERSTANDING/);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);
});

test("Extension_WhenSearchAndCompletionShareBatch_ShouldRejectCompletionWithoutTransition", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, identity } = await prepareDeepRetrieval(rootDir, "mixed-tool-batch", "MixedToolBatchNeedle");
	assert.ok(harness.messageEndHandler, "Expected message_end handler for Deep batch enforcement");

	const beforeStatus = harness.observedStatuses.at(-1);
	const beforeTools = harness.getActiveTools();
	await harness.messageEndHandler(
		{
			message: {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-mixed-search",
						name: "forge_deep_search",
						arguments: { ...identity, query: "MixedToolBatchNeedle", source: "code_base" },
					},
					{
						type: "toolCall",
						id: "call-mixed-completion",
						name: "forge_deep_retrieval_complete",
						arguments: { ...identity, outcome: { kind: "completed" } },
					},
				],
			},
		},
		harness.buildContext(),
	);

	const completionTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(completionTool?.execute);
	const result = await completionTool.execute(
		"call-mixed-completion",
		{ ...identity, outcome: { kind: "completed" } },
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(result.details.status, "rejected");
	assert.equal(result.details.retryable, true);
	assert.equal(result.terminate, true);
	assert.equal(harness.observedStatuses.at(-1), beforeStatus);
	assert.deepEqual(harness.getActiveTools(), beforeTools);
});

test("Extension_WhenMultipleCurrentIdentitySearchesSettle_ShouldTerminateAllAndQueueOneFollowUp", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, identity, searchTool } = await prepareDeepRetrieval(rootDir, "mixed-search-settle", "MixedSearchSettleNeedle");
	assert.ok(harness.messageEndHandler, "Expected message_end handler for Deep batch enforcement");

	await harness.messageEndHandler(
		{
			message: {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-mixed-search-success",
						name: "forge_deep_search",
						arguments: { ...identity, query: "MixedSearchSettleNeedle", source: "code_base" },
					},
					{
						type: "toolCall",
						id: "call-mixed-search-failure",
						name: "forge_deep_search",
						arguments: {
							...identity,
							query: "MixedSearchSettleNeedle",
							source: "target",
							targetSource: "src/not-in-manifest.ts",
						},
					},
					{
						type: "toolCall",
						id: "call-mixed-search-completion",
						name: "forge_deep_retrieval_complete",
						arguments: { ...identity, outcome: { kind: "completed" } },
					},
				],
			},
		},
		harness.buildContext(),
	);

	const beforeFollowUps = harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length;
	const success = await searchTool(
		"call-mixed-search-success",
		{ ...identity, query: "MixedSearchSettleNeedle", source: "code_base" },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(success.details.status, "accepted");
	assert.equal(success.terminate, true);
	assert.equal(
		harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length,
		beforeFollowUps,
		"followUp must wait for every current-identity search to settle",
	);

	await harness.messageEndHandler(
		{
			message: {
				role: "toolResult",
				toolCallId: "call-mixed-search-success",
				toolName: "forge_deep_search",
				content: [{ type: "text", text: JSON.stringify(success.details) }],
				details: success.details,
				isError: false,
			},
		},
		harness.buildContext(),
	);
	assert.equal(
		harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length,
		beforeFollowUps,
		"one settled search must not queue the followUp",
	);

	const failure = await searchTool(
		"call-mixed-search-failure",
		{
			...identity,
			query: "MixedSearchSettleNeedle",
			source: "target",
			targetSource: "src/not-in-manifest.ts",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(failure.details.status, "invalid");
	assert.equal(failure.terminate, true);

	await harness.messageEndHandler(
		{
			message: {
				role: "toolResult",
				toolCallId: "call-mixed-search-failure",
				toolName: "forge_deep_search",
				content: [{ type: "text", text: JSON.stringify(failure.details) }],
				details: failure.details,
				isError: true,
			},
		},
		harness.buildContext(),
	);

	const followUps = harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp");
	assert.equal(followUps.length, beforeFollowUps + 1);
	assert.match(followUps.at(-1)?.content ?? "", /deep-1/);
	assert.match(followUps.at(-1)?.content ?? "", /grill-1/);
	assert.match(followUps.at(-1)?.content ?? "", /DEEP_KNOWLEDGE_RETRIEVAL/);

	const completionTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(completionTool?.execute);
	const completion = await completionTool.execute(
		"call-mixed-search-completion",
		{ ...identity, outcome: { kind: "completed" } },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(completion.details.status, "rejected");
	assert.equal(completion.terminate, true);
	assert.equal(
		harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length,
		beforeFollowUps + 1,
		"mixed completion must not transition or queue a duplicate followUp",
	);
});

test("Extension_WhenStaleOrRouteChangedBatchSettles_ShouldNotQueueDuplicateFollowUp", async (t) => {
	{
		const rootDir = createTempRoot();
		t.after(() => rmSync(rootDir, { force: true, recursive: true }));
		const { harness, identity, searchTool } = await prepareDeepRetrieval(rootDir, "stale-mixed-batch", "StaleMixedBatchNeedle");
		assert.ok(harness.messageEndHandler, "Expected message_end handler for Deep batch enforcement");
		const baselineFollowUps = harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length;

		await harness.messageEndHandler(
			{
				message: {
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call-stale-mixed-search-success",
							name: "forge_deep_search",
							arguments: { ...identity, query: "StaleMixedBatchNeedle", source: "code_base" },
						},
						{
							type: "toolCall",
							id: "call-stale-mixed-search-pending",
							name: "forge_deep_search",
							arguments: {
								...identity,
								query: "StaleMixedBatchNeedle",
								source: "target",
								targetSource: "src/not-in-manifest.ts",
							},
						},
						{
							type: "toolCall",
							id: "call-stale-mixed-completion",
							name: "forge_deep_retrieval_complete",
							arguments: { ...identity, outcome: { kind: "completed" } },
						},
					],
				},
			},
			harness.buildContext(),
		);

		const first = await searchTool(
			"call-stale-mixed-search-success",
			{ ...identity, query: "StaleMixedBatchNeedle", source: "code_base" },
			undefined,
			undefined,
			harness.buildContext(),
		);
		assert.equal(first.details.status, "accepted");
		await harness.messageEndHandler(
			{
				message: {
					role: "toolResult",
					toolCallId: "call-stale-mixed-search-success",
					toolName: "forge_deep_search",
					content: [{ type: "text", text: JSON.stringify(first.details) }],
					details: first.details,
					isError: false,
				},
			},
			harness.buildContext(),
		);

		await harness.runCommand("cancel");
		await harness.runCommand("continue");
		const routeStatus = harness.observedStatuses.at(-1);
		const routeFollowUps = harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length;
		assert.ok(routeFollowUps >= baselineFollowUps);

		const stale = await searchTool(
			"call-stale-mixed-search-pending",
			{
				...identity,
				query: "StaleMixedBatchNeedle",
				source: "target",
				targetSource: "src/not-in-manifest.ts",
			},
			undefined,
			undefined,
			harness.buildContext(),
		);
		assert.equal(stale.details.status, "stale");
		assert.equal(stale.terminate, true);
		await harness.messageEndHandler(
			{
				message: {
					role: "toolResult",
					toolCallId: "call-stale-mixed-search-pending",
					toolName: "forge_deep_search",
					content: [{ type: "text", text: JSON.stringify(stale.details) }],
					details: stale.details,
					isError: true,
				},
			},
			harness.buildContext(),
		);
		assert.equal(
			harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length,
			routeFollowUps,
			"stale remaining result must not queue a followUp",
		);
		assert.equal(harness.observedStatuses.at(-1), routeStatus, "stale result must not route back to the old stage");
	}

	{
		const rootDir = createTempRoot();
		t.after(() => rmSync(rootDir, { force: true, recursive: true }));
		const { harness, identity, searchTool } = await prepareDeepRetrieval(rootDir, "duplicate-mixed-result", "DuplicateMixedResultNeedle");
		assert.ok(harness.messageEndHandler, "Expected message_end handler for Deep batch enforcement");
		const baselineFollowUps = harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length;
		await harness.messageEndHandler(
			{
				message: {
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call-duplicate-mixed-search-success",
							name: "forge_deep_search",
							arguments: { ...identity, query: "DuplicateMixedResultNeedle", source: "code_base" },
						},
						{
							type: "toolCall",
							id: "call-duplicate-mixed-search-failure",
							name: "forge_deep_search",
							arguments: {
								...identity,
								query: "DuplicateMixedResultNeedle",
								source: "target",
								targetSource: "src/not-in-manifest.ts",
							},
						},
						{
							type: "toolCall",
							id: "call-duplicate-mixed-completion",
							name: "forge_deep_retrieval_complete",
							arguments: { ...identity, outcome: { kind: "completed" } },
						},
					],
				},
			},
			harness.buildContext(),
		);
		const first = await searchTool(
			"call-duplicate-mixed-search-success",
			{ ...identity, query: "DuplicateMixedResultNeedle", source: "code_base" },
			undefined,
			undefined,
			harness.buildContext(),
		);
		const failure = await searchTool(
			"call-duplicate-mixed-search-failure",
			{
				...identity,
				query: "DuplicateMixedResultNeedle",
				source: "target",
				targetSource: "src/not-in-manifest.ts",
			},
			undefined,
			undefined,
			harness.buildContext(),
		);
		assert.equal(first.details.status, "accepted");
		assert.equal(failure.details.status, "invalid");
		await harness.messageEndHandler(
			{
				message: {
					role: "toolResult",
					toolCallId: "call-duplicate-mixed-search-success",
					toolName: "forge_deep_search",
					content: [{ type: "text", text: JSON.stringify(first.details) }],
					details: first.details,
					isError: false,
				},
			},
			harness.buildContext(),
		);
		const failureMessage = {
			message: {
				role: "toolResult",
				toolCallId: "call-duplicate-mixed-search-failure",
				toolName: "forge_deep_search",
				content: [{ type: "text", text: JSON.stringify(failure.details) }],
				details: failure.details,
				isError: true,
			},
		};
		await harness.messageEndHandler(
			failureMessage,
			harness.buildContext(),
		);
		assert.equal(
			harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length,
			baselineFollowUps + 1,
		);
		await harness.messageEndHandler(failureMessage, harness.buildContext());
		assert.equal(
			harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length,
			baselineFollowUps + 1,
			"duplicate tool-result must not queue a second followUp",
		);
	}
});

test("Extension_WhenCompletionOnlyBatchReplays_ShouldAcceptOnce", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const { harness, identity, searchTool } = await prepareDeepRetrieval(rootDir, "completion-only-replay", "CompletionOnlyReplayNeedle");
	assert.ok(harness.inputHandler, "Expected public input handler for followUp replay");
	assert.ok(harness.messageEndHandler, "Expected public message_end handler for Deep batch enforcement");
	const baselineFollowUpCount = harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length;

	await harness.messageEndHandler(
		{
			message: {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-completion-only-search-success",
						name: "forge_deep_search",
						arguments: { ...identity, query: "CompletionOnlyReplayNeedle", source: "code_base" },
					},
					{
						type: "toolCall",
						id: "call-completion-only-search-failure",
						name: "forge_deep_search",
						arguments: {
							...identity,
							query: "CompletionOnlyReplayNeedle",
							source: "target",
							targetSource: "src/not-in-manifest.ts",
						},
					},
					{
						type: "toolCall",
						id: "call-completion-only-batch-completion",
						name: "forge_deep_retrieval_complete",
						arguments: { ...identity, outcome: { kind: "completed" } },
					},
				],
			},
		},
		harness.buildContext(),
	);

	const success = await searchTool(
		"call-completion-only-search-success",
		{ ...identity, query: "CompletionOnlyReplayNeedle", source: "code_base" },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(success.details.status, "accepted");
	await harness.messageEndHandler(
		{
			message: {
				role: "toolResult",
				toolCallId: "call-completion-only-search-success",
				toolName: "forge_deep_search",
				content: [{ type: "text", text: JSON.stringify(success.details) }],
				details: success.details,
				isError: false,
			},
		},
		harness.buildContext(),
	);

	const failure = await searchTool(
		"call-completion-only-search-failure",
		{
			...identity,
			query: "CompletionOnlyReplayNeedle",
			source: "target",
			targetSource: "src/not-in-manifest.ts",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(failure.details.status, "invalid");
	await harness.messageEndHandler(
		{
			message: {
				role: "toolResult",
				toolCallId: "call-completion-only-search-failure",
				toolName: "forge_deep_search",
				content: [{ type: "text", text: JSON.stringify(failure.details) }],
				details: failure.details,
				isError: true,
			},
		},
		harness.buildContext(),
	);

	const followUps = harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp");
	assert.equal(followUps.length, baselineFollowUpCount + 1, "all search results should produce one identity-bearing followUp");
	const followUpContent = followUps.at(-1)?.content;
	assert.ok(followUpContent);
	const inputResult = await harness.inputHandler({ text: followUpContent }, harness.buildContext());
	assert.equal((inputResult as { action?: string }).action, "continue");

	const replayCall = {
		type: "toolCall" as const,
		id: "call-completion-only-replay-completion",
		name: "forge_deep_retrieval_complete",
		arguments: { ...identity, outcome: { kind: "completed" as const } },
	};
	await harness.messageEndHandler({ message: { role: "assistant", content: [replayCall] } }, harness.buildContext());

	const completionTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(completionTool?.execute);
	const beforeFollowUpCount = harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length;
	const accepted = await completionTool.execute(
		"call-completion-only-replay-completion",
		{ ...identity, outcome: { kind: "completed" } },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(accepted.details.status, "accepted");
	assert.equal(accepted.terminate, true);
	assert.match(harness.observedStatuses.at(-1) ?? "", /KNOWLEDGE_UNDERSTANDING/);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_complete"]);
	assert.equal(
		harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length,
		beforeFollowUpCount,
		"completion replay must not add another followUp",
	);

	const statusAfterAccept = harness.observedStatuses.at(-1);
	const replayed = await completionTool.execute(
		"call-completion-only-replay-completion",
		{ ...identity, outcome: { kind: "completed" } },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(replayed.details.status, "stale");
	assert.equal(replayed.terminate, true);
	assert.equal(harness.observedStatuses.at(-1), statusAfterAccept);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_complete"]);
	assert.equal(
		harness.observedUserMessageCalls.filter((call) => call.options?.deliverAs === "followUp").length,
		beforeFollowUpCount,
		"same completion call ID replay must remain quiet",
	);
});

test("Extension_PromptGuidance_ShouldDistinguishDecisionFromDiscovery", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const marker = "PromptGuidanceNeedle";
	writeWorkspaceFile(rootDir, "code_base/src/prompt-guidance.ts", `// ${marker} candidate.\n`);
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const baselineMessages = harness.observedUserMessageCalls.length;
	const startResult = await harness.sendInput(`請幫我測試 ${marker} prompt-guidance.ts`);
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);

	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-prompt-guidance-evidence", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute(
		"call-prompt-guidance-complete",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(harness.observedUserMessageCalls.length, baselineMessages);
	assert.ok(harness.agentSettledHandler);
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const initialMessages = harness.observedUserMessageCalls.slice(baselineMessages);
	assert.equal(initialMessages.length, 1);
	assert.equal(initialMessages[0]?.options?.deliverAs, undefined);
	const guidance = [
		/needs_decision[^\n]*僅用於[^\n]*人類[^\n]*選擇/,
		/needs_discovery[^\n]*僅用於[^\n]*來源[^\n]*證據不足/,
		/正式 route[^\n]*kind/,
		/decisionSummary[^\n]*route/,
	];
	for (const pattern of guidance) assert.match(initialMessages.at(-1)?.content ?? "", pattern);

	assert.ok(harness.messageEndHandler);
	const identity = {
		attemptId: "deep-1",
		sourceRoundId: "grill-1",
		phase: "DEEP_KNOWLEDGE_RETRIEVAL" as const,
	};
	await harness.messageEndHandler(
		{
			message: {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-prompt-guidance-search-success",
						name: "forge_deep_search",
						arguments: { ...identity, query: marker, source: "code_base" },
					},
					{
						type: "toolCall",
						id: "call-prompt-guidance-search-failure",
						name: "forge_deep_search",
						arguments: { ...identity, query: marker, source: "target", targetSource: "src/missing.ts" },
					},
					{
						type: "toolCall",
						id: "call-prompt-guidance-completion",
						name: "forge_deep_retrieval_complete",
						arguments: { ...identity, outcome: { kind: "completed" } },
					},
				],
			},
		},
		harness.buildContext(),
	);

	const searchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(searchTool?.execute);
	const success = await searchTool.execute(
		"call-prompt-guidance-search-success",
		{ ...identity, query: marker, source: "code_base" },
		undefined,
		undefined,
		harness.buildContext(),
	);
	const failure = await searchTool.execute(
		"call-prompt-guidance-search-failure",
		{ ...identity, query: marker, source: "target", targetSource: "src/missing.ts" },
		undefined,
		undefined,
		harness.buildContext(),
	);
	for (const [callId, result, isError] of [
		["call-prompt-guidance-search-success", success, false],
		["call-prompt-guidance-search-failure", failure, true],
	] as const) {
		await harness.messageEndHandler(
			{
				message: {
					role: "toolResult",
					toolCallId: callId,
					toolName: "forge_deep_search",
					content: [{ type: "text", text: JSON.stringify(result.details) }],
					details: result.details,
					isError,
				},
			},
			harness.buildContext(),
		);
	}

	const settledMessages = harness.observedUserMessageCalls.slice(baselineMessages);
	assert.equal(settledMessages.length, 2);
	for (const pattern of guidance) assert.match(settledMessages.at(-1)?.content ?? "", pattern);
	for (const pattern of guidance) {
		assert.equal(
			initialMessages.at(-1)?.content?.match(pattern)?.[0],
			settledMessages.at(-1)?.content?.match(pattern)?.[0],
			"settled identity prompt 與 barrier settle prompt 必須帶同一 guidance",
		);
	}
});

test("Integration_WhenNewRequirementAppears_ShouldRouteWorkflowToWaitUser", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	const retrievalCompleteTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	const deepCompleteTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	assert.ok(grillCompleteTool?.execute, "Expected forge_grill_complete to expose execute");
	assert.ok(retrievalCompleteTool?.execute, "Expected forge_deep_retrieval_complete to expose execute");
	assert.ok(deepCompleteTool?.execute, "Expected forge_deep_complete to expose execute");

	await evidenceTool.execute("call-new-requirement-evidence", { candidateId }, undefined, undefined, harness.buildContext());
	await grillCompleteTool.execute(
		"call-new-requirement-grill-complete",
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

	const retrievalComplete = await retrievalCompleteTool.execute(
		"call-new-requirement-retrieval-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(retrievalComplete.details.status, "accepted");

	const decisionOutcome = {
		kind: "needs_decision",
		decisionId: "new-requirement-1",
		question: "要不要擴大需求範圍？",
		options: ["擴大", "維持目前範圍"],
		recommendation: "維持目前範圍",
		evidenceIds: [candidateId],
		decisionSummary: "新需求會改變目前分析範圍。",
	} as const;
	const outcomeSchema = (deepCompleteTool.parameters as { properties?: { outcome?: unknown } } | undefined)?.properties?.outcome as
		| { anyOf?: Array<{ properties?: Record<string, unknown>; required?: string[] }> }
		| undefined;
	const decisionSchema = outcomeSchema?.anyOf?.find((schema) => schema.properties?.kind && JSON.stringify(schema.properties.kind).includes("needs_decision"));
	assert.ok(decisionSchema, "forge_deep_complete schema must expose needs_decision");
	assert.deepEqual(
		Object.keys(decisionSchema.properties ?? {}).sort(),
		["decisionId", "decisionSummary", "evidenceIds", "kind", "options", "question", "recommendation"].sort(),
	);

	const result = await deepCompleteTool.execute(
		"call-new-requirement-deep-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: decisionOutcome,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(result.details.status, "needs_decision");
	assert.deepEqual(result.details.payload, decisionOutcome);
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.doesNotMatch(
		harness.observedMessages.join("\n"),
		/WAIT_USER/,
		"純 UI WAIT_USER 面板不得送進 agent message stream",
	);
	assert.deepEqual(harness.getActiveTools(), ["read"]);
	assert.equal(harness.getActiveTools().some((toolName) => toolName.startsWith("forge_deep")), false);

	const staleResult = await deepCompleteTool.execute(
		"call-new-requirement-deep-complete-stale",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: decisionOutcome,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(staleResult.details.status, "stale");
});

test("Integration_WhenGrillHumanDecisionIsAnswered_ShouldInjectImmutableDecisionIntoEvidencePackage", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	assert.ok(grillCompleteTool?.execute, "Expected forge_grill_complete to expose execute");
	await evidenceTool.execute("call-human-decision-evidence", { candidateId }, undefined, undefined, harness.buildContext());

	const decisionId = "grill-human-decision-1";
	const question = "要採用方案 A 嗎？";
	const answer = "採用方案 A";
	await grillCompleteTool.execute(
		"call-human-decision-grill-complete",
		{
			evidence: [candidateId],
			questions: [{ id: decisionId, question, options: [answer, "維持方案 B"] }],
			recommendation: { reason: "需要使用者決定方案。", value: answer },
			requiresUserConfirmation: true,
			roundId: "grill-1",
			status: "NEEDS_CONFIRMATION",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);

	const resumeResult = await harness.sendInput(answer);
	assert.equal((resumeResult as { action?: string }).action, "transform");
	assert.match((resumeResult as { text?: string }).text ?? "", /roundId\s*[:：]\s*grill-2/);

	await grillCompleteTool.execute(
		"call-human-decision-grill-complete-2",
		{
			evidence: [candidateId],
			questions: [],
			recommendation: { reason: "使用者已完成決策。", value: "proceed" },
			requiresUserConfirmation: false,
			roundId: "grill-2",
			status: "READY_FOR_DEEP",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	const retrievalCompleteTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	const deepCompleteTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(retrievalCompleteTool?.execute, "Expected forge_deep_retrieval_complete to expose execute");
	assert.ok(deepCompleteTool?.execute, "Expected forge_deep_complete to expose execute");
	await retrievalCompleteTool.execute(
		"call-human-decision-retrieval-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-2",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	const completion = await deepCompleteTool.execute(
		"call-human-decision-deep-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-2",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions: [], findings: [], limitations: [] },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	assert.equal(completion.details.status, "accepted");
	assert.match(harness.observedStatuses.at(-1) ?? "", /CONTEXT_BUILD/);
	const evidencePackage = completion.details.evidencePackage as {
		evidence: Array<{ evidenceId: string; origin: string; source: string; metadata: Record<string, unknown> }>;
		decisions: Array<{ decisionId: string; statement: string; evidenceIds: string[] }>;
	};
	const premise = evidencePackage.evidence.find((item) => item.origin === "human_premise");
	assert.ok(premise, "Expected confirmed Grill human premise evidence");
	assert.equal(premise.source, "forge://human-premise");
	assert.equal(premise.metadata.roundId, "grill-1");
	assert.equal(premise.metadata.decisionId, decisionId);
	assert.deepEqual(
		evidencePackage.evidence.filter((item) => item.origin === "grill").map((item) => item.evidenceId),
		[candidateId],
	);
	assert.deepEqual(evidencePackage.decisions, [
		{
			decisionId,
			statement: `問題：${question}；決定：${answer}`,
			evidenceIds: [candidateId, premise.evidenceId],
		},
	]);
});

test("Extension_WhenSourceChangesAfterEvidenceFetch_ShouldCompleteDeepFromSnapshotOnly", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-snapshot-evidence", { candidateId }, undefined, undefined, harness.buildContext());

	writeWorkspaceFile(
		rootDir,
		"code_base/src/boundary-token.ts",
		"// changed after Grill evidence fetch; Deep must use the immutable snapshot instead.\n",
	);
	await harness.runCommand(`grill-result ${JSON.stringify({
		status: "READY_FOR_DEEP",
		questions: [],
		recommendation: { value: "proceed", reason: "snapshot reuse", confidence: 0.9 },
		evidence: [candidateId],
		requiresUserConfirmation: false,
		roundId: "grill-1",
	})}`);

	const retrievalCompleteTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalCompleteTool?.execute, "Expected forge_deep_retrieval_complete to expose execute");
	const retrievalCompletion = await retrievalCompleteTool.execute(
		"call-snapshot-retrieval-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(retrievalCompletion.details.status, "accepted");

	const deepCompleteTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(deepCompleteTool?.execute, "Expected forge_deep_complete to expose execute");
	const deepCompletion = await deepCompleteTool.execute(
		"call-snapshot-deep-complete",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions: [], findings: [], limitations: [] },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(deepCompletion.details.status, "accepted");
	const evidencePackage = deepCompletion.details.evidencePackage as {
		evidence: Array<{ content: string }>;
	};
	assert.equal(evidencePackage.evidence.length, 1);
	assert.match(evidencePackage.evidence[0]?.content ?? "", /BoundaryToken 固定這個 Grill round/);
	assert.doesNotMatch(evidencePackage.evidence[0]?.content ?? "", /changed after Grill evidence fetch/);
});

test("Extension_WhenDebugCompletionUsesWrongRoundId_ShouldRejectAndKeepActiveGrillAttempt", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read", "write"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool, "Expected forge_grill_evidence tool to be registered");
	await evidenceTool.execute?.("call-evidence", { candidateId }, undefined, undefined, harness.buildContext());

	await assert.rejects(
		harness.runCommand(
			`grill-result ${JSON.stringify({
				status: "READY_FOR_DEEP",
				questions: [],
				recommendation: { value: "proceed", reason: "debug completion test", confidence: 0.9 },
				evidence: [candidateId],
				requiresUserConfirmation: false,
				roundId: "grill-999",
			})}`,
		),
		{ message: "grill completion roundId does not match the active round" },
	);

	assert.match(harness.observedStatuses.at(-1) ?? "", /GRILL/);
	assert.doesNotMatch(harness.observedMessages.join("\n"), /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.deepEqual(harness.getActiveTools(), ["forge_grill_evidence", "forge_grill_complete"]);
	assert.deepEqual(
		await harness.toolCallHandler?.({ type: "tool_call", toolCallId: "call-still-grilling", toolName: "read", input: {} }),
		{ block: true },
	);
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

function extractManifestCandidate(result: unknown): string {
	const invocation = (result as { text?: string }).text ?? "";
	const candidateId = invocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "預期正式 Grill round 會提供 snapshot candidate id");
	return candidateId;
}

function formalWaitUserCommand(manifestCandidate: string, roundId = "grill-1", decisionId = "confirm"): string {
	return `grill ambiguous ${JSON.stringify({
		question: "Proceed to deep knowledge retrieval?",
		decisionId,
		roundId,
		recommendation: "confirm",
		options: ["confirm", "reject"],
		evidenceIds: [manifestCandidate],
		decisionSummary: "Need explicit user confirmation before continuing.",
	})}`;
}

function assertWaitUserFollowUp(
	call: SentUserMessage | undefined,
	manifestCandidate: string,
	decisionId: string,
	answer: string,
): void {
	assert.ok(call, "Expected exactly one outbound followUp invocation");
	assert.equal(call.options?.deliverAs, "followUp");
	assertFollowUpInvocation(call.content, manifestCandidate, decisionId, answer);
}

function assertFollowUpInvocation(content: string, manifestCandidate: string, decisionId: string, answer: string): void {
	assert.match(content, /roundId\s*[:：]\s*grill-\d+/);
	assert.match(content, new RegExp(`\\b${manifestCandidate}\\b`));
	assert.match(
		content,
			new RegExp(escapeRegExp(`使用者已回答決策 "${decisionId}"：${JSON.stringify(answer)}。`)),
	);
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
	const manifestCandidate = await startFormalGrillRound(rootDir, sendInput);

	await command.handler(formalWaitUserCommand(manifestCandidate), {});
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

	assert.deepEqual(await harness.sendInput("同意"), { action: "handled" });
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
	assert.match(replay?.content ?? "", /使用者已回答決策 "confirm"："採用方案 A"。/);
	assert.equal(harness.reenteredFollowUpEvents.length, 1, "預期 continue 會重新進入共用 input 路徑");
	assert.equal((harness.reenteredFollowUpEvents[0]?.result as { action?: string }).action, "continue");
});

test("Extension_WhenGrillNeedsConfirmation_ShouldExposeWaitUser", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	await startFormalGrillRound(rootDir, harness.sendInput);

	await harness.runCommand(`grill ambiguous ${waitUserPayload}`);

	assert.match(harness.observedStatuses.join("\n"), /WAIT_USER/);
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

	assert.equal(harness.observedUserMessageCalls.length, 1);
	assertWaitUserFollowUp(harness.observedUserMessageCalls[0], manifestCandidate, "confirm", "confirm");
	assert.equal(harness.reenteredFollowUpEvents.length, 1, "預期 confirm 會重新進入共用 input 路徑");
	assertFollowUpInvocation(harness.reenteredFollowUpEvents[0]?.event.text ?? "", manifestCandidate, "confirm", "confirm");
	assert.equal(
		(harness.reenteredFollowUpEvents[0]?.result as { action?: string }).action,
		"continue",
		"followUp replay bypass 應略過共用 input transform",
	);
	const nextInvocation = harness.observedUserMessageCalls[0]?.content ?? "";
	assert.match(nextInvocation, /grill-2/);
	assert.match(nextInvocation, new RegExp(escapeRegExp(manifestCandidate)));
	assert.match(nextInvocation, /使用者已回答決策 "confirm"："confirm"。/);
	assert.doesNotMatch(nextInvocation, /Deep Knowledge 已開始。|Knowledge Understanding 已開始。/);
});

test("Extension_DeepRetrievalFollowUp_ShouldCarryTargetManifestIncludingEmptyList", async (t) => {
	const scenarios = [
		{
			name: "with target candidate",
			setup(rootDir: string) {
				writeWorkspaceFile(rootDir, "src/deep-target.ts", "// DeepTargetManifestNeedle target candidate.\n");
				writeWorkspaceFile(rootDir, "code_base/src/deep-target.ts", "// DeepTargetManifestNeedle code_base seed.\n");
			},
			request: "請幫我測試 DeepTargetManifestNeedle deep-target.ts",
			expectation: (invocation: string) => {
				const targetLine = invocation
					.split(/\r?\n/)
					.find((line) => line.includes("[target]") && line.includes("src/deep-target.ts"));
				const candidateId = targetLine?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
				assert.ok(candidateId, "Expected the public Grill invocation to expose the target candidate id");
				return candidateId;
			},
			manifest: /target(?:\s+source)?\s+manifest[^\[]*\[[^\]]*src\/deep-target\.ts[^\]]*\]/i,
		},
		{
			name: "without target candidate",
			setup(rootDir: string) {
				writeWorkspaceFile(rootDir, "code_base/src/deep-no-target.ts", "// DeepNoTargetManifestNeedle code_base candidate.\n");
			},
			request: "請幫我測試 DeepNoTargetManifestNeedle deep-no-target.ts",
			expectation: (invocation: string) => {
				const candidateId = invocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
				assert.ok(candidateId, "Expected the public Grill invocation to expose the Grill candidate id");
				return candidateId;
			},
			manifest: /target(?:\s+source)?\s+manifest[^\[]*\[\s*\]/i,
		},
	] as const;

	for (const scenario of scenarios) {
		const rootDir = createTempRoot();
		scenario.setup(rootDir);
		t.after(() => rmSync(rootDir, { force: true, recursive: true }));

		const harness = await createExtensionHarness({ cwd: rootDir });
		const startResult = await harness.sendInput(scenario.request);
		const invocation = (startResult as { text?: string }).text ?? "";
		const candidateId = scenario.expectation(invocation);

		const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
		assert.ok(evidenceTool?.execute, `Expected forge_grill_evidence for ${scenario.name}`);
		await evidenceTool.execute(
			`call-deep-follow-up-${scenario.name}-evidence`,
			{ candidateId },
			undefined,
			undefined,
			harness.buildContext(),
		);

		const completionTool = harness.registeredTools.get("forge_grill_complete");
		assert.ok(completionTool?.execute, `Expected forge_grill_complete for ${scenario.name}`);
		await completionTool.execute(
			`call-deep-follow-up-${scenario.name}-completion`,
			{
				roundId: "grill-1",
				status: "READY_FOR_DEEP",
				questions: [],
				recommendation: { value: "proceed", reason: "target manifest follow-up", confidence: 0.9 },
				evidence: [candidateId],
				requiresUserConfirmation: false,
			},
			undefined,
			undefined,
			harness.buildContext(),
		);

		const prompt = await settlePendingDeepPrompt(harness);
		assert.match(prompt, /"attemptId"\s*:\s*"deep-1"/);
		assert.match(prompt, scenario.manifest);
	}
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
	assert.equal(harness.observedUserMessageCalls.length, 1);
	assertWaitUserFollowUp(harness.observedUserMessageCalls[0], manifestCandidate, "confirm", "confirm");
	assert.equal(harness.reenteredFollowUpEvents.length, 1, "預期 selector 會剛好一次重新進入共用 input 路徑");
	assertFollowUpInvocation(harness.reenteredFollowUpEvents[0]?.event.text ?? "", manifestCandidate, "confirm", "confirm");
	assert.equal(
		(harness.reenteredFollowUpEvents[0]?.result as { action?: string }).action,
		"continue",
		"selector followUp replay bypass 應略過共用 input transform",
	);
	const nextInvocation = harness.observedUserMessageCalls[0]?.content ?? "";
	assert.match(nextInvocation, /grill-2/);
	assert.match(nextInvocation, new RegExp(escapeRegExp(manifestCandidate)));
	assert.doesNotMatch(nextInvocation, /Deep Knowledge 已開始。|Knowledge Understanding 已開始。/);
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
	const observedStatuses: Array<{ key: string; text: string | undefined }> = [];

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

	await command.handler("confirm", {
		ui: {
			setStatus(key: string, text: string | undefined) {
				observedStatuses.push({ key, text });
			},
		},
	});

	assert.notEqual(observedOutputs.at(-1), "DEEP_KNOWLEDGE_RETRIEVAL");
	assert.equal(observedStatuses.at(-1)?.key, "forge-runtime");
	assert.match(observedStatuses.at(-1)?.text ?? "", /WAIT_USER|GRILL|rejected|cannot/i);
});

test("Extension_WhenWaitUser_ShouldPublishPanelAndStatus", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	await startFormalGrillRound(rootDir, harness.sendInput);

	await harness.runCommand(`grill ambiguous ${waitUserPayload}`);

	assert.match(harness.observedStatuses.join("\n"), /WAIT_USER/, "Expected WAIT_USER status to be published");

	assert.equal(harness.observedStatusCalls.at(-1)?.key, "forge-runtime");
	assert.equal(harness.observedStatusCalls.at(-1)?.text, "Forge WAIT_USER [waiting-user]");
});

test("ForgeStage_WhenPublishingWaitUserState_ShouldNotQueueUnsupportedDelivery", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(evidenceTool?.execute);
	assert.ok(grillCompleteTool?.execute);
	await evidenceTool.execute("call-wait-user-publish-evidence", { candidateId }, undefined, undefined, harness.buildContext());
	let selectorCalls = 0;
	let resolveSelectorCalled!: () => void;
	const selectorCalled = new Promise<void>((resolve) => {
		resolveSelectorCalled = resolve;
	});
	const context = harness.buildContext({
		ui: {
			async select() {
				selectorCalls += 1;
				resolveSelectorCalled();
				return undefined;
			},
		},
	});

	await grillCompleteTool.execute(
		"call-wait-user-publish-complete",
		{
			roundId: "grill-1",
			status: "NEEDS_CONFIRMATION",
			questions: [{ id: "wait-user-publish-decision", question: "是否繼續？", options: ["繼續", "停止"] }],
			recommendation: { value: "繼續", reason: "等待人類決策。", confidence: 0.8 },
			evidence: [candidateId],
			requiresUserConfirmation: true,
		},
		undefined,
		undefined,
		context,
	);
	await selectorCalled;

	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.equal(harness.observedStatusCalls.at(-1)?.key, "forge-runtime");

	assert.equal(selectorCalls, 1, "WAIT_USER selector 流程仍應存在");
});

test("Extension_WhenWaitUserPayloadProvided_ShouldRenderPayloadValues", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	await startFormalGrillRound(rootDir, harness.sendInput);
	const selectorCalls: Array<{ title: string; options: string[] }> = [];

	await harness.runCommand(`grill ambiguous ${waitUserPayload}`, {
		ui: {
			async select(title, options) {
				selectorCalls.push({ title, options });
				return undefined;
			},
		},
	});

	assert.equal(selectorCalls.length, 1);
	assert.equal(selectorCalls[0]?.title, "Proceed to deep knowledge retrieval?");
	assert.deepEqual(selectorCalls[0]?.options, ["confirm", "reject", "自行輸入…"]);
	assert.equal(harness.observedStatusCalls.at(-1)?.key, "forge-runtime");
	assert.equal(harness.observedStatusCalls.at(-1)?.text, "Forge WAIT_USER [waiting-user]");
});

test("Extension_WhenStructuredGrillResultProvided_ShouldRenderWaitUserFromResult", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	const selectorCalls: Array<{ title: string; options: string[] }> = [];
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute(
		"call-evidence", { candidateId }, undefined, undefined, harness.buildContext(),
	);
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
		evidence: [candidateId],
		requiresUserConfirmation: true,
		roundId: "grill-1",
	});

	await harness.runCommand(`grill-result ${structuredGrillResult}`, {
		ui: {
			async select(title, options) {
				selectorCalls.push({ title, options });
				return undefined;
			},
		},
	});

	assert.equal(selectorCalls.length, 1);
	assert.equal(selectorCalls[0]?.title, "Should we accept Plan A?");
	assert.deepEqual(selectorCalls[0]?.options, ["accept", "revise", "自行輸入…"]);
	assert.equal(harness.observedStatusCalls.at(-1)?.key, "forge-runtime");
	assert.match(harness.observedStatusCalls.at(-1)?.text ?? "", /WAIT_USER/);
});

test("Extension_WhenStructuredGrillResultIsReadyForDeep_ShouldContinueWithoutWaitUser", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, reenterFollowUps: true });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute(
		"call-evidence", { candidateId }, undefined, undefined, harness.buildContext(),
	);
	const structuredGrillResult = JSON.stringify({
		status: "READY_FOR_DEEP",
		questions: [],
		recommendation: {
			value: "proceed",
			reason: "Signals are aligned enough to continue.",
			confidence: 0.88,
		},
		evidence: [candidateId],
		requiresUserConfirmation: false,
		roundId: "grill-1",
	});

	await harness.runCommand(`grill-result ${structuredGrillResult}`);

	const prompt = harness.observedUserMessageCalls.at(-1);
	assert.equal(prompt?.options?.deliverAs, "followUp");
	assert.match(prompt?.content ?? "", /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.doesNotMatch(prompt?.content ?? "", /KNOWLEDGE_UNDERSTANDING/);
	const statusText = harness.observedStatuses.join("\n");
	assert.doesNotMatch(statusText, /KNOWLEDGE_UNDERSTANDING/);
	assert.doesNotMatch(statusText, /WAIT_USER/);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);
});

test("Extension_WhenRelevanceGateHasNoCandidates_ShouldStopBeforeDeepKnowledge", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "wiki/plan-a.md", "方案 A 壓測計畫的文件證據。\n");
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir });
	const { sendInput, runCommand } = harness;
	let selectorTitle = "";

	const transformResult = await sendInput("請幫我壓測方案 A plan-a.md");
	assert.equal((transformResult as { action?: string }).action, "transform");
	const candidateId = extractManifestCandidate(transformResult);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-relevance-no-candidate-evidence", { candidateId }, undefined, undefined, harness.buildContext());

	await runCommand(`grill-result ${JSON.stringify({
		...JSON.parse(readyForDeepGrillResult),
		roundId: "grill-1",
		evidence: [candidateId],
	})}`, { ui: { async select(title) { selectorTitle = title; return undefined; } } });

	const statusText = harness.observedStatuses.join("\n");
	assert.match(statusText, /WAIT_USER/);
	assert.doesNotMatch(statusText, /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.match(selectorTitle, /候選相關性不足|來源|範圍/);
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

test("Extension_WhenNaturalInputHasWhitespace_ShouldPreserveRawMessageForModelAndWorkflow", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	const userMessage = "  請幫我測試 RawInputNeedle  ";

	const result = await harness.sendInput(userMessage);
	const invocation = (result as { text?: string }).text ?? "";

	assert.equal((result as { action?: string }).action, "transform");
	assert.equal(harness.observedModelRequests.length, 1);
	assert.equal(harness.observedModelRequests[0], userMessage);
	assert.match(invocation, new RegExp(escapeRegExp(userMessage)));
});

test("Extension_WhenGrillRunAliasIsExactOrHasContent_ShouldStartForgeWithoutModelAndKeepRawInput", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	for (const { userMessage, downstreamTask } of [
		{ userMessage: "/grill-run", downstreamTask: "" },
		{ userMessage: "/grill-run 請幫我測試 GrillRunRawNeedle", downstreamTask: "請幫我測試 GrillRunRawNeedle" },
	]) {
		const harness = await createExtensionHarness({ cwd: rootDir });
		const result = await harness.sendInput(userMessage);
		const invocation = (result as { text?: string }).text ?? "";

		assert.equal((result as { action?: string }).action, "transform");
		assert.equal(harness.observedModelRequests.length, 0);
		assert.match(invocation, new RegExp(`任務：${escapeRegExp(downstreamTask)}`));
		assert.doesNotMatch(invocation, new RegExp(escapeRegExp(userMessage)));
	}
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

test("Extension_WhenMissingAssetApprovalLeadsToEmptySnapshot_ShouldNotAskConsentTwice", async (t) => {
	const rootDir = createTempRoot({ withWiki: false, withCodeBase: false });
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const request = "請幫我開始一個全新產品，不存在既有知識文件";

	assert.deepEqual(await harness.sendInput(request), { action: "handled" });
	const grillStart = await harness.sendInput("同意");
	assert.match((grillStart as { text?: string }).text ?? "", /grill-1/);

	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute, "Expected forge_grill_complete to expose execute");
	await grillCompleteTool.execute(
		"call-missing-assets-empty-snapshot",
		{
			roundId: "grill-1",
			status: "NEEDS_CONFIRMATION",
			questions: [{ id: "model-empty-evidence-question", question: "模型不應再次詢問探索同意", options: ["同意", "不同意"] }],
			recommendation: { value: "同意", reason: "沒有找到相關證據。", confidence: 0.8 },
			evidence: [],
			requiresUserConfirmation: true,
		},
		undefined,
		undefined,
		harness.buildContext({
			ui: {
				select: async (title, options) => {
					selectCalls.push({ title, options });
					return undefined;
				},
			},
		}),
	);

	assert.equal(selectCalls.length, 0, "已在 missing-assets gate 同意後，不得再次顯示探索同意");
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);
	assert.match(harness.observedStatuses.at(-1) ?? "", /DEEP_KNOWLEDGE_RETRIEVAL/);

	const baseline = harness.observedUserMessageCalls.length;
	assert.ok(harness.agentSettledHandler, "Expected agent_settled handler for pending Deep invocation");
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const deepMessages = harness.observedUserMessageCalls.slice(baseline);
	assert.equal(deepMessages.length, 1, "預期直接送出一次 Deep invocation");
	assert.match(deepMessages[0]?.content ?? "", /DEEP_KNOWLEDGE_RETRIEVAL/);
});

test("Extension_WhenExplorationConsentWorkflowIsCancelled_ShouldAskAgainInNewWorkflow", async (t) => {
	const rootDir = createTempRoot({ withWiki: false, withCodeBase: false });
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });

	assert.deepEqual(await harness.sendInput("請幫我開始一個全新產品，不存在既有知識文件"), { action: "handled" });
	const firstApproval = await harness.sendInput("同意");
	assert.equal((firstApproval as { action?: string }).action, "transform");
	assert.match(harness.observedStatuses.at(-1) ?? "", /GRILL/);

	await harness.runCommand("cancel");
	assert.equal(harness.observedStatuses.at(-1), "Forge RECEIVE [active]");

	mkdirSync(join(rootDir, "wiki"), { recursive: true });
	mkdirSync(join(rootDir, "code_base"), { recursive: true });
	const secondStart = await harness.sendInput("請幫我開始另一個全新產品");
	const secondInvocation = (secondStart as { text?: string }).text ?? "";
	assert.equal((secondStart as { action?: string }).action, "transform");
	const roundId = /目前 Grill roundId:\s*(\S+)/.exec(secondInvocation)?.[1];
	assert.ok(roundId, "Expected second workflow Grill roundId");

	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute, "Expected forge_grill_complete to expose execute");
	await grillCompleteTool.execute(
		"call-cancelled-consent-empty-snapshot",
		{
			roundId,
			status: "NEEDS_CONFIRMATION",
			questions: [{ id: "second-workflow-consent", question: "是否同意探索？", options: ["同意", "不同意"] }],
			recommendation: { value: "同意", reason: "沒有找到相關證據。", confidence: 0.8 },
			evidence: [],
			requiresUserConfirmation: true,
		},
		undefined,
		undefined,
		harness.buildContext({
			ui: {
				select: async (title, options) => {
					selectCalls.push({ title, options });
					return undefined;
				},
			},
		}),
	);

	assert.equal(selectCalls.length, 1, "取消前一 workflow 後，新 workflow 必須重新詢問探索同意");
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
});

test("Extension_WhenKnowledgeAssetsExist_ShouldKeepStartForgePathUsingInjectedRoot", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput(`${knowledgeBoundaryRequest} boundary.md`);

	assert.equal(typeof result, "object");
	assert.equal((result as { action?: string }).action, "transform");
	assert.match((result as { text?: string }).text ?? "", /<skill name="grilling"/);
	const invocation = (result as { text?: string }).text ?? "";
	assert.match(invocation, /wiki\/boundary\.md/);
	assert.doesNotMatch(invocation, new RegExp(tempRootEvidence));
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
	writeWorkspaceFile(rootDir, "code_base/src/search-panel.ts", "// Search panel renders WidgetNeedle results.\n");
	writeWorkspaceFile(rootDir, "code_base/src/search-adapter.ts", "// Adapter normalizes WidgetNeedle queries.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const harness = await createExtensionHarness({ cwd: rootDir });
	const result = await harness.sendInput("請幫我測試 WidgetNeedle search-panel.ts search-adapter.ts");
	const text = (result as { text?: string }).text ?? "";

	assert.equal((result as { action?: string }).action, "transform");
	assert.match(text, /code_base\/src\/search-panel\.ts/);
	assert.match(text, /code_base\/src\/search-adapter\.ts/);
	assert.doesNotMatch(text, /Search panel renders WidgetNeedle results/);
	assert.doesNotMatch(text, /Adapter normalizes WidgetNeedle queries/);
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

	const result = await (inputHandler as (message: unknown, context: unknown) => Promise<unknown>)(
		{ text: "今天天氣如何？" },
		{
			model: {},
			modelRegistry: {
				complete: async () => ({ content: [{ type: "text", text: '{"route":"passthrough"}' }] }),
			},
		},
	);

	assert.deepEqual(result, { action: "continue" });
});

test("Extension_WhenWaitUserUiThrows_ShouldPreservePendingDecisionAndAllowRetry", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir });
	const manifestCandidate = await startFormalGrillRound(rootDir, harness.sendInput);
	const decisionPayload = JSON.stringify({
		...JSON.parse(waitUserPayload),
		decisionId: "decision-ui-throw",
		evidenceIds: [manifestCandidate],
	});
	const sentinel = new Error("WAIT_USER_UI_SENTINEL");
	let customAttempts = 0;
	const context = {
		ui: {
			select: async () => "自行輸入…",
			custom: async () => {
				customAttempts += 1;
				if (customAttempts === 1) {
					throw sentinel;
				}
				return "retry answer";
			},
		},
	};

	await assert.rejects(harness.runCommand(`grill ambiguous ${decisionPayload}`, context), (error) => error === sentinel);
	const waitUserStatus = harness.observedStatuses.at(-1);
	assert.equal(waitUserStatus, "Forge WAIT_USER [waiting-user]");

	await harness.runCommand(`grill ambiguous ${decisionPayload}`, context);

	assert.equal(customAttempts, 2);
	assert.equal(harness.observedUserMessageCalls.length, 1);
	assertWaitUserFollowUp(harness.observedUserMessageCalls[0], manifestCandidate, "decision-ui-throw", "retry answer");
	assert.equal(harness.observedStatuses.at(-1), "Forge GRILL [active]");
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

	assertWaitUserFollowUp(harness.observedUserMessageCalls.at(-1), manifestCandidate, "confirm", "自訂回答");
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
	assertWaitUserFollowUp(harness.observedUserMessageCalls[0], manifestCandidate, "confirm", "confirm");
});

test("Extension_WhenWaitUserOptionCannotResume_ShouldKeepWaitUserAndCloseSelector", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});
	const harness = await createExtensionHarness({ cwd: rootDir, withoutFollowUpBridge: true });
	const manifestCandidate = await startFormalGrillRound(rootDir, harness.sendInput);
	let selectorCalls = 0;
	let selectorTitle = "";
	let selectorOptions: string[] = [];

	await assert.doesNotReject(
		harness.runCommand(formalWaitUserCommand(manifestCandidate), {
			ui: {
				async select(title, options) {
					selectorCalls += 1;
					selectorTitle = title;
					selectorOptions = options;
					if (selectorCalls === 1) return "confirm";
					throw new Error("selector reopened");
				},
			},
		}),
	);

	assert.equal(selectorCalls, 1);
	assert.equal(harness.observedUserMessageCalls.length, 0);
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	assert.equal(selectorTitle, "Proceed to deep knowledge retrieval?");
	assert.deepEqual(selectorOptions, ["confirm", "reject", "自行輸入…"]);
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
	assert.match(nextInvocation, /使用者已回答決策 "confirm"："confirm"。/);
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

	await harness.runCommand(formalWaitUserCommand(manifestCandidate, "grill-1"));
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

test("Extension_WhenSamePendingWaitUserDecisionIsRetriedAfterUiReturns_ShouldRerenderWithoutTransition", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	await startFormalGrillRound(rootDir, harness.sendInput);
	let selectorCalls = 0;
	const waitUserCommand = `grill ambiguous ${JSON.stringify({
		decisionId: "decision-publish-once",
		roundId: "grill-1",
		question: "是否繼續？",
		recommendation: "繼續",
		options: ["繼續", "停止"],
		evidenceIds: ["EV-PUBLISH-ONCE"],
		decisionSummary: "等待人類決策。",
	})}`;
	const context = {
		ui: {
			async select() {
				selectorCalls += 1;
				return undefined;
			},
		},
	};

	await harness.runCommand(waitUserCommand, context);
	await harness.runCommand(waitUserCommand, context);

	const publishedPanelCount = harness.observedStatusCalls.filter((call) => call.text?.includes("WAIT_USER")).length;
	assert.equal(selectorCalls, 2, "前一次 UI 返回後，同一 pending decisionId 應再次顯示 selector");
	assert.equal(publishedPanelCount, 2, "前一次 UI 返回後，同一 pending decisionId 應再次顯示 WAIT_USER 狀態");
});

test("Extension_WhenSamePendingWaitUserUiIsActive_ShouldNotPublishDuplicateUi", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	await startFormalGrillRound(rootDir, harness.sendInput);
	let selectorCalls = 0;
	let releaseUi: (() => void) | undefined;
	let markUiEntered: (() => void) | undefined;
	const uiEntered = new Promise<void>((resolve) => {
		markUiEntered = resolve;
	});
	const uiRelease = new Promise<string | undefined>((resolve) => {
		releaseUi = () => resolve(undefined);
	});
	const waitUserCommand = `grill ambiguous ${JSON.stringify({
		decisionId: "decision-active-ui-dedupe",
		roundId: "grill-1",
		question: "同一個 UI 是否只開一次？",
		recommendation: "繼續",
		options: ["繼續", "停止"],
		evidenceIds: ["EV-ACTIVE-UI-DEDUPE"],
		decisionSummary: "等待人類決策。",
	})}`;
	const context = {
		ui: {
			async select() {
				selectorCalls += 1;
				markUiEntered?.();
				return await uiRelease;
			},
		},
	};

	let firstRun: Promise<void> | undefined;
	try {
		firstRun = harness.runCommand(waitUserCommand, context);
		await uiEntered;
		const statusCount = harness.observedStatuses.length;
		const panelCount = harness.observedStatusCalls.filter((call) => call.text?.includes("WAIT_USER")).length;

		await harness.runCommand(waitUserCommand, context);

		assert.equal(selectorCalls, 1, "第一個 UI 尚未返回時，第二次不得開啟 selector");
		assert.equal(harness.observedStatuses.length, statusCount, "第二次不得重做 WAIT_USER transition");
		assert.equal(
			harness.observedStatusCalls.filter((call) => call.text?.includes("WAIT_USER")).length,
			panelCount,
			"第一個 UI 尚未返回時，第二次不得發布另一份 WAIT_USER 狀態",
		);
	} finally {
		releaseUi?.();
		await firstRun;
	}
});

test("Extension_WhenWaitUserHasNoUi_ShouldPreservePendingDecisionAndAllowRetry", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	await startFormalGrillRound(rootDir, harness.sendInput);
	let selectorCalls = 0;
	const waitUserCommand = `grill ambiguous ${JSON.stringify({
		decisionId: "decision-no-ui-retry",
		roundId: "grill-1",
		question: "沒有 UI 時是否保留？",
		recommendation: "保留",
		options: ["保留", "停止"],
		evidenceIds: ["EV-NO-UI-RETRY"],
		decisionSummary: "等待 UI 重試。",
	})}`;

	await assert.doesNotReject(() => harness.runCommand(waitUserCommand, {}));
	const uiContext = {
		ui: {
			async select() {
				selectorCalls += 1;
				return undefined;
			},
		},
	};
	await harness.runCommand(waitUserCommand, uiContext);

	assert.equal(selectorCalls, 1, "無 UI 後相同 pending decisionId 應可重試 selector");
	assert.equal(harness.observedStatusCalls.filter((call) => call.text?.includes("WAIT_USER")).length, 2, "無 UI 後相同 pending decisionId 應可重顯 WAIT_USER 狀態");
	assert.equal(harness.observedUserMessageCalls.length, 0, "重試顯示不得重做 WAIT_USER transition 或送出回答");
});

test("Extension_WhenDifferentPendingWaitUserDecisionReenters_ShouldIgnoreAndPreserveOriginal", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	await startFormalGrillRound(rootDir, harness.sendInput);
	let selectorCalls = 0;
	const context = {
		ui: {
			async select() {
				selectorCalls += 1;
				return undefined;
			},
		},
	};
	const firstWaitUserCommand = `grill ambiguous ${JSON.stringify({
		decisionId: "decision-first-pending",
		roundId: "grill-1",
		question: "原始待決策？",
		recommendation: "繼續",
		options: ["繼續", "停止"],
		evidenceIds: ["EV-FIRST-PENDING"],
		decisionSummary: "保留第一個待決策。",
	})}`;
	const secondWaitUserCommand = `grill ambiguous ${JSON.stringify({
		decisionId: "decision-second-reentry",
		roundId: "grill-1",
		question: "後續重入問題？",
		recommendation: "改變方向",
		options: ["改變方向", "停止"],
		evidenceIds: ["EV-SECOND-REENTRY"],
		decisionSummary: "不得取代第一個待決策。",
	})}`;

	await harness.runCommand(firstWaitUserCommand, context);
	await assert.doesNotReject(() => harness.runCommand(secondWaitUserCommand, context));

	assert.equal(selectorCalls, 1, "不同 pending decisionId 重入不得發布第二個 selector");
	assert.equal(harness.observedStatusCalls.filter((call) => call.text?.includes("WAIT_USER")).length, 1, "不同 pending decisionId 重入不得發布第二個 WAIT_USER 狀態");
});

test("Extension_WhenSameNeedsConfirmationGrillResultIsReenteredAfterUiReturns_ShouldRepublishSelectorAndPanel", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute(
		"call-evidence", { candidateId }, undefined, undefined, harness.buildContext(),
	);
	let selectorCalls = 0;
	const grillResult = JSON.stringify({
		status: "NEEDS_CONFIRMATION",
		questions: [{ id: "question-grill-result-dedupe", question: "是否繼續？", options: ["繼續", "停止"] }],
		recommendation: { value: "繼續", reason: "等待人類決策。" },
		evidence: [candidateId],
		requiresUserConfirmation: true,
		roundId: "grill-1",
	});
	const context = {
		ui: {
			async select() {
				selectorCalls += 1;
				return undefined;
			},
		},
	};

	await harness.runCommand(`grill-result ${grillResult}`, context);
	await assert.doesNotReject(() => harness.runCommand(`grill-result ${grillResult}`, context));

	assert.equal(selectorCalls, 2, "UI 返回後同一 grill-result question id 可再次發布 selector");
	assert.equal(harness.observedStatusCalls.filter((call) => call.text?.includes("WAIT_USER")).length, 2, "UI 返回後同一 grill-result question id 可再次發布 WAIT_USER 狀態");
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
			decisionId: "next-grill-question",
			roundId: "grill-1",
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

		assert.equal(harness.observedUserMessageCalls.length, 1);
		assertWaitUserFollowUp(harness.observedUserMessageCalls[0], manifestCandidate, "next-grill-question", row.answer);

		const reenteredFollowUpEvents = (
			harness as typeof harness & {
				reenteredFollowUpEvents?: Array<{
					event: { text: string };
					result: { action?: string; text?: string };
				}>;
			}
		).reenteredFollowUpEvents;
		assert.equal(reenteredFollowUpEvents?.length, 1, "Expected exactly one followUp to re-enter the shared input path");
		assertFollowUpInvocation(reenteredFollowUpEvents?.[0]?.event.text ?? "", manifestCandidate, "next-grill-question", row.answer);
		assert.equal(
			reenteredFollowUpEvents?.[0]?.result.action,
			"continue",
			"followUp replay bypass 應略過共用 input transform",
		);

		const nextInvocation = harness.observedUserMessageCalls[0]?.content ?? "";
		assert.match(nextInvocation, /grill-2/);
		assert.match(nextInvocation, new RegExp(escapeRegExp(manifestCandidate)));
		assert.match(nextInvocation, /forge_grill_evidence 只接受 manifest 中的 candidateId/);
		assert.match(nextInvocation, /完成時必須呼叫 forge_grill_complete；completion payload 必須原樣包含此 roundId/);
		assert.match(
			nextInvocation,
			new RegExp(escapeRegExp(`使用者已回答決策 "next-grill-question"：${JSON.stringify(row.answer)}。`)),
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

test("Extension_WhenGrillResultDebugCommandReceivesStructuredResult_ShouldPublishWaitUser", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir });
	const selectorCalls: Array<{ title: string; options: string[] }> = [];
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute, "Expected forge_grill_evidence to expose execute");
	await evidenceTool.execute("call-debug-evidence", { candidateId }, undefined, undefined, harness.buildContext());
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
		evidence: [candidateId],
		requiresUserConfirmation: true,
		roundId: "grill-1",
	});

	await harness.runCommand(`grill-result ${structuredGrillResult}`, {
		ui: {
			async select(title, options) {
				selectorCalls.push({ title, options });
				return undefined;
			},
		},
	});

	assert.deepEqual(selectorCalls, [{ title: "是否接受方案 A？", options: ["accept", "revise", "自行輸入…"] }]);
	assert.equal(harness.observedStatusCalls.at(-1)?.key, "forge-runtime");
	assert.match(harness.observedStatusCalls.at(-1)?.text ?? "", /WAIT_USER/);
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

test("Extension_WhenDeepSearchQueryIsWhitespace_ShouldRejectWithoutChangingRetrieval", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/deep-blank-query.ts", "// DeepBlankQueryNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"], reenterFollowUps: true });
	const startResult = await harness.sendInput("請幫我測試 DeepBlankQueryNeedle deep-blank-query.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-blank-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute);
	await completionTool.execute("call-blank-grill-complete", {
		roundId: "grill-1", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	const searchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(searchTool?.execute);
	const beforeStatus = harness.observedStatuses.at(-1);
	const result = await searchTool.execute("call-blank-search", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		query: "   ", source: "wiki",
	}, undefined, undefined, harness.buildContext());
	assert.equal(result.details.status, "invalid");
	assert.equal(harness.observedStatuses.at(-1), beforeStatus);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);
});

test("Extension_WhenDeepSearchRepeatsSupplementalQuery_ShouldReuseWithoutReread", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "wiki/deep-repeat-supplemental.md", "DeepRepeatSupplementalNeedle wiki evidence.\n");
	writeWorkspaceFile(rootDir, "code_base/src/deep-repeat.ts", "// DeepRepeatSupplementalNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DeepRepeatSupplementalNeedle deep-repeat.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-repeat-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute);
	await completionTool.execute("call-repeat-grill-complete", {
		roundId: "grill-1", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	const searchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(searchTool?.execute);
	const input = {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL" as const,
		query: "DeepRepeatSupplementalNeedle", source: "wiki" as const,
	};
	const first = await searchTool.execute("call-repeat-search-1", input, undefined, undefined, harness.buildContext());
	const supplementalId = (first.details.evidence as Array<{ evidenceId: string }>)[0]?.evidenceId;
	assert.equal(first.details.status, "accepted");
	assert.ok(supplementalId);
	const second = await searchTool.execute("call-repeat-search-2", input, undefined, undefined, harness.buildContext());
	assert.equal(second.details.status, "accepted");
	assert.deepEqual(second.details.evidence, []);
	assert.deepEqual(second.details.reusedEvidenceIds, [supplementalId]);
});

test("Extension_WhenDeepCompletionNeedsDecisionReferencesUnknownEvidence_ShouldRejectWithoutTransition", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/deep-unknown-evidence.ts", "// DeepUnknownEvidenceNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"], reenterFollowUps: true });
	const startResult = await harness.sendInput("請幫我測試 DeepUnknownEvidenceNeedle deep-unknown-evidence.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-unknown-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-unknown-grill-complete", {
		roundId: "grill-1", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	const beforeRetrievalStatus = harness.observedStatuses.at(-1);
	const retrievalResult = await retrievalTool.execute("call-unknown-retrieval", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_decision", decisionId: "unknown-retrieval", question: "?", options: ["ok"], recommendation: "ok", evidenceIds: ["ev-unknown"] },
	}, undefined, undefined, harness.buildContext());
	assert.equal(retrievalResult.details.status, "invalid");
	assert.equal(harness.observedStatuses.at(-1), beforeRetrievalStatus);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);

	const validRetrieval = await retrievalTool.execute("call-valid-retrieval", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL", outcome: { kind: "completed" },
	}, undefined, undefined, harness.buildContext());
	assert.equal(validRetrieval.details.status, "accepted");
	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingTool?.execute);
	const beforeUnderstandingStatus = harness.observedStatuses.at(-1);
	const understandingResult = await understandingTool.execute("call-unknown-understanding", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "KNOWLEDGE_UNDERSTANDING",
		outcome: { kind: "needs_decision", decisionId: "unknown-understanding", question: "?", options: ["ok"], recommendation: "ok", evidenceIds: ["ev-unknown"] },
	}, undefined, undefined, harness.buildContext());
	assert.equal(understandingResult.details.status, "invalid");
	assert.equal(harness.observedStatuses.at(-1), beforeUnderstandingStatus);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_complete"]);
});

test("Extension_WhenRetrievalNeedsDiscovery_ShouldAutomaticallyRestartLightDiscoveryAndGrill", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/deep-discovery-retry.ts", "// DeepDiscoveryRetryNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"], reenterFollowUps: true });
	const startResult = await harness.sendInput("請幫我測試 DeepDiscoveryRetryNeedle deep-discovery-retry.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-discovery-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-discovery-grill-complete", {
		roundId: "grill-1", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	const beforeFollowUps = harness.observedUserMessageCalls.length;
	const retrievalResult = await retrievalTool.execute("call-needs-discovery", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, undefined, undefined, harness.buildContext());
	assert.equal(harness.observedUserMessageCalls.length, beforeFollowUps, "active tool turn 不得重入 followUp");
	assert.ok(harness.toolResultHandler, "Expected tool_result handler for completed retrieval lifecycle");
	const originalContent = retrievalResult.content ?? [];
	const originalDetails = retrievalResult.details;
	const originalIsError = retrievalResult.isError ?? false;
	const unrelatedResult = await harness.toolResultHandler(
		{
			type: "tool_result",
			toolCallId: "unrelated-tool-call",
			toolName: "forge_deep_retrieval_complete",
			input: {},
			content: originalContent,
			details: originalDetails,
			isError: originalIsError,
		},
		harness.buildContext(),
	);
	assert.equal(unrelatedResult, undefined);
	const transformedResult = await harness.toolResultHandler(
		{
			type: "tool_result",
			toolCallId: "call-needs-discovery",
			toolName: "forge_deep_retrieval_complete",
			input: {
				attemptId: "deep-1",
				sourceRoundId: "grill-1",
				phase: "DEEP_KNOWLEDGE_RETRIEVAL",
				outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
			},
			content: originalContent,
			details: originalDetails,
			isError: originalIsError,
		},
		harness.buildContext(),
	);
	assert.equal(transformedResult, undefined, "tool_result handler 不得把 Grill control invocation 加入 tool-result content");
	assert.doesNotMatch(JSON.stringify(originalContent), /grill-2|forge_grill_complete/);
	assert.ok(harness.agentSettledHandler, "Expected agent_settled handler for settled discovery restart");
	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const settledMessages = harness.observedUserMessageCalls.slice(beforeFollowUps);
	assert.equal(settledMessages.length, 1, "agent settled 後應只送出一則 Grill control invocation");
	assert.equal(settledMessages[0]?.options?.deliverAs, undefined);
	assert.match(settledMessages[0]?.content ?? "", /grill-2/);
	assert.match(harness.observedStatuses.at(-1) ?? "", /GRILL/);
	assert.deepEqual(harness.getActiveTools(), ["forge_grill_evidence", "forge_grill_complete"]);
});

test("Extension_WhenGrillCompletionEntersDeep_ShouldSendRuntimeIdentityAfterAgentSettled", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-tool-result-transport-evidence", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);

	const result = await grillCompleteTool.execute("call-tool-result-transport-complete", {
		roundId: "grill-1",
		status: "READY_FOR_DEEP",
		questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId],
		requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	assert.deepEqual(result.content, [{ type: "text", text: "Forge Grill 完成結果已接受。" }]);
	assert.equal(result.terminate, true);
	assert.equal(harness.observedUserMessageCalls.length, 0, "agent 尚未 settled 前不得送出 Deep prompt");
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);
	assert.deepEqual(
		await harness.toolCallHandler?.({
			type: "tool_call",
			toolCallId: "call-pending-settled-deep-search",
			toolName: "forge_deep_search",
			input: {
				attemptId: "deep-1",
				sourceRoundId: "grill-1",
				phase: "DEEP_KNOWLEDGE_RETRIEVAL",
				query: "pending settled handoff",
				source: "wiki",
			},
		}),
		{ block: true },
	);
	assert.ok(harness.agentSettledHandler, "Expected agent_settled handler to be registered");

	await harness.agentSettledHandler({}, harness.buildContext());
	assert.equal(harness.observedUserMessageCalls.length, 0, "agent_settled handler 不得同步重入舊 context");
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	assert.equal(harness.observedUserMessageCalls.length, 1);
	assert.equal(harness.observedUserMessageCalls[0]?.options?.deliverAs, undefined);
	assert.match(
		harness.observedUserMessageCalls[0]?.content ?? "",
		/\{"attemptId":"deep-1","sourceRoundId":"grill-1","phase":"DEEP_KNOWLEDGE_RETRIEVAL"\}/,
	);

	await harness.agentSettledHandler({}, harness.buildContext());
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	assert.equal(harness.observedUserMessageCalls.length, 1, "重複 agent settled 不得重送 Deep prompt");
});

test("Extension_DeepRetrievalSecondNeedsDiscovery_StopsAtWaitUserWithoutFollowUp", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const marker = "DeepDiscoverySecondNeedle";
	const { harness, searchTool } = await prepareDeepRetrieval(rootDir, "deep-discovery-second", marker);

	const firstRetrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(firstRetrievalTool?.execute);
	const firstRetrievalResult = await firstRetrievalTool.execute(
		"call-deep-discovery-first",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	const secondGrillInvocation = await transformNeedsDiscoveryToolResult(harness, "call-deep-discovery-first", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, firstRetrievalResult);
	assert.match(secondGrillInvocation, /grill-2/);
	const secondCandidateId = secondGrillInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(secondCandidateId, "第二輪 Grill invocation 應包含實際 candidate id");
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-deep-discovery-second-evidence", { candidateId: secondCandidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute(
		"call-deep-discovery-second-grill",
		{
			roundId: "grill-2",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
			evidence: [secondCandidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);

	const deep2Search = await searchTool(
		"call-deep-discovery-second-search",
		{
			attemptId: "deep-2",
			sourceRoundId: "grill-2",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			query: marker,
			source: "code_base",
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(deep2Search.details.status, "accepted");
	const followUpCountBeforeCompletion = harness.observedUserMessageCalls.length;
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute(
		"call-deep-discovery-second-complete",
		{
			attemptId: "deep-2",
			sourceRoundId: "grill-2",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "needs_discovery", decisionSummary: "仍需要補充線索" },
		},
		undefined,
		undefined,
		harness.buildContext({
			ui: {
				select: async (title, options) => {
					selectCalls.push({ title, options });
					return undefined;
				},
			},
		}),
	);

	assert.equal(harness.observedStatuses.at(-1)?.includes("WAIT_USER"), true);
	assert.deepEqual(selectCalls.at(-1), {
		title: "此專案資料來源不足，將以前次grill/ 資料來源所得之證據進行後續開發，請確認",
		options: ["確認", "取消", "自行輸入…"],
	});
	assert.equal(harness.observedUserMessageCalls.length, followUpCountBeforeCompletion);
});

test("Extension_DeepDiscoveryFallbackCancel_ShouldResetFromSelectorAndCustomEditor", async (t) => {
	for (const { label, answer, custom } of [
		{ label: "selector", answer: "取消", custom: false },
		{ label: "custom editor", answer: " 取消 ", custom: true },
	]) {
		const rootDir = createTempRoot();
		t.after(() => rmSync(rootDir, { force: true, recursive: true }));
		const marker = `DeepDiscoveryCancel${label === "selector" ? "Selector" : "Custom"}Needle`;
		const { harness, searchTool } = await prepareDeepRetrieval(rootDir, `deep-discovery-cancel-${label.replace(" ", "-")}`, marker);
		const firstRetrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
		assert.ok(firstRetrievalTool?.execute);
		const firstResult = await firstRetrievalTool.execute(`call-${label}-first`, {
			attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
		}, undefined, undefined, harness.buildContext());
		const secondInvocation = await transformNeedsDiscoveryToolResult(harness, `call-${label}-first`, {
			attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
		}, firstResult);
		const fallbackRoundId = secondInvocation.match(/roundId\s*[:：]\s*(grill-\d+)/)?.[1];
		assert.ok(fallbackRoundId);
		const secondCandidateId = secondInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
		assert.ok(secondCandidateId);
		const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
		const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
		assert.ok(evidenceTool?.execute);
		assert.ok(grillCompleteTool?.execute);
		await evidenceTool.execute(`call-${label}-evidence`, { candidateId: secondCandidateId }, undefined, undefined, harness.buildContext());
		await grillCompleteTool.execute(`call-${label}-grill`, {
			roundId: "grill-2", status: "READY_FOR_DEEP", questions: [],
			recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
			evidence: [secondCandidateId], requiresUserConfirmation: false,
		}, undefined, undefined, harness.buildContext());
		await searchTool(`call-${label}-search`, {
			attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			query: marker, source: "code_base",
		}, undefined, undefined, harness.buildContext());

		const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
		assert.ok(retrievalTool?.execute);
		await retrievalTool.execute(`call-${label}-fallback`, {
			attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "needs_discovery", decisionSummary: "仍需要補充線索" },
		}, undefined, undefined, harness.buildContext({
			ui: {
				select: async (_title, options) => {
					assert.deepEqual(options, ["確認", "取消", "自行輸入…"]);
					return custom ? "自行輸入…" : answer.trim();
				},
				...(custom ? { custom: async () => answer } : {}),
			},
		}));

		assert.equal(harness.observedStatuses.at(-1), "Forge RECEIVE [active]", `${label} 取消應回到初始 RECEIVE`);
		assert.deepEqual(harness.getActiveTools(), ["read"], `${label} 取消應清除 active tools`);
		assert.equal(harness.observedStatuses.some((status) => status.includes("KNOWLEDGE_UNDERSTANDING")), false);
		const followUpCountAfterCancel = harness.observedUserMessageCalls.length;
		const staleFallback = await retrievalTool.execute(`call-${label}-stale-fallback`, {
			attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "needs_discovery", decisionSummary: "仍需要補充線索" },
		}, undefined, undefined, harness.buildContext({
			ui: { select: async () => "取消" },
		}));
		assert.equal(staleFallback.details.status, "stale");
		assert.equal(harness.observedStatuses.at(-1), "Forge RECEIVE [active]");
		assert.equal(harness.observedUserMessageCalls.length, followUpCountAfterCancel);
		const fresh = await harness.sendInput(`請幫我測試 ${marker} fresh-request.ts`);
		const freshRoundId = (fresh as { text?: string }).text?.match(/roundId\s*[:：]\s*(grill-\d+)/)?.[1];
		assert.ok(freshRoundId);
		assert.notEqual(freshRoundId, fallbackRoundId);
	}
});

test("Extension_DeepDiscoveryFallbackExactConfirmation_StartsKnowledgeUnderstandingWithCompletionToolOnly", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const marker = "DeepDiscoveryExactConfirmationNeedle";
	const { harness, searchTool } = await prepareDeepRetrieval(rootDir, "deep-discovery-exact-confirmation", marker);
	const firstRetrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(firstRetrievalTool?.execute);
	const firstRetrievalResult = await firstRetrievalTool.execute("call-exact-confirmation-first", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, undefined, undefined, harness.buildContext());
	const secondGrillInvocation = await transformNeedsDiscoveryToolResult(harness, "call-exact-confirmation-first", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, firstRetrievalResult);
	const secondCandidateId = secondGrillInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(secondCandidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-exact-confirmation-second-evidence", { candidateId: secondCandidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-exact-confirmation-second-grill", {
		roundId: "grill-2", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [secondCandidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());

	const deep2Search = await searchTool("call-exact-confirmation-second-search", {
		attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		query: marker, source: "code_base",
	}, undefined, undefined, harness.buildContext());
	assert.equal(deep2Search.details.status, "accepted");
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	const observedStatusCountBeforeFallback = harness.observedStatuses.length;
	const observedUserMessageCountBeforeFallback = harness.observedUserMessageCalls.length;
	await retrievalTool.execute("call-exact-confirmation-second-complete", {
		attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "仍需要補充線索" },
	}, undefined, undefined, harness.buildContext({
		ui: {
			select: async (title, options) => {
				selectCalls.push({ title, options });
				return "確認";
			},
		},
	}));
	await settlePendingDeepPrompt(harness);

	assert.equal(
		harness.observedStatuses.slice(observedStatusCountBeforeFallback).some((status) => status.includes("KNOWLEDGE_UNDERSTANDING")),
		true,
	);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_complete"]);
	assert.match(
		harness.observedUserMessageCalls.slice(observedUserMessageCountBeforeFallback).at(-1)?.content ?? "",
		/KNOWLEDGE_UNDERSTANDING/,
	);
	assert.equal(selectCalls.length, 1);
});

test("Extension_DeepDiscoveryFallbackExactTypedInput_StartsKnowledgeUnderstandingWithoutReturningToGrill", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const marker = "DeepDiscoveryExactTypedInputNeedle";
	const { harness, searchTool } = await prepareDeepRetrieval(rootDir, "deep-discovery-exact-typed-input", marker);
	const firstRetrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(firstRetrievalTool?.execute);
	const firstRetrievalResult = await firstRetrievalTool.execute("call-exact-typed-input-first", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, undefined, undefined, harness.buildContext());
	const secondGrillInvocation = await transformNeedsDiscoveryToolResult(harness, "call-exact-typed-input-first", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, firstRetrievalResult);
	const secondCandidateId = secondGrillInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(secondCandidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-exact-typed-input-second-evidence", { candidateId: secondCandidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-exact-typed-input-second-grill", {
		roundId: "grill-2", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [secondCandidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());

	const deep2Search = await searchTool("call-exact-typed-input-second-search", {
		attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		query: marker, source: "code_base",
	}, undefined, undefined, harness.buildContext());
	assert.equal(deep2Search.details.status, "accepted");
	const beforeTypedInput = harness.observedUserMessageCalls.length;
	const grillInvocationsBeforeTypedInput = harness.observedUserMessageCalls.filter(({ content }) => /grill-\d+/.test(content)).length;
	const lightDiscoveryInvocationsBeforeTypedInput = harness.observedUserMessageCalls.filter(({ content }) => /LIGHT_DISCOVERY/.test(content)).length;
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute("call-exact-typed-input-second-complete", {
		attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "仍需要補充線索" },
	}, undefined, undefined, harness.buildContext());
	const transformedInput = await harness.sendInput("確認");
	const transformedText = (transformedInput as { text?: string }).text ?? "";

	assert.match(harness.observedStatuses.at(-1) ?? "", /KNOWLEDGE_UNDERSTANDING/);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_complete"]);
	assert.match(transformedText, /KNOWLEDGE_UNDERSTANDING/);
	assert.equal(harness.observedUserMessageCalls.length, beforeTypedInput);
	assert.equal(
		harness.observedUserMessageCalls.filter(({ content }) => /grill-\d+/.test(content)).length,
		grillInvocationsBeforeTypedInput,
	);
	assert.equal(
		harness.observedUserMessageCalls.filter(({ content }) => /LIGHT_DISCOVERY/.test(content)).length,
		lightDiscoveryInvocationsBeforeTypedInput,
	);
});

test("Extension_DeepDiscoveryFallback_WhenSnapshotSwitches_ShouldCarryFetchedEvidenceIntoUnderstanding", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const marker = "DeepDiscoveryCarryEvidenceNeedle";
	const firstContent = `// ${marker} code base evidence.\n`;
	const { harness, searchTool, candidateId: firstCandidateId } = await prepareDeepRetrieval(
		rootDir,
		"deep-discovery-carry",
		marker,
	);
	const firstRetrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(firstRetrievalTool?.execute);
	const firstRetrievalResult = await firstRetrievalTool.execute("call-carry-first-discovery", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, undefined, undefined, harness.buildContext());
	writeWorkspaceFile(rootDir, "code_base/src/extra/deep-discovery-carry.ts", `// ${marker} additional code base evidence.\n`);
	const secondGrillInvocation = await transformNeedsDiscoveryToolResult(harness, "call-carry-first-discovery", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, firstRetrievalResult);
	const secondCandidateId = [...new Set(secondGrillInvocation.match(/\bev-[0-9a-f]{64}\b/g) ?? [])].find(
		(candidateId) => candidateId !== firstCandidateId,
	);
	assert.ok(secondCandidateId, "新增檔案後的新 Grill invocation 應包含不同於原始 evidence 的 candidate");
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-carry-second-evidence", { candidateId: secondCandidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-carry-second-grill", {
		roundId: "grill-2", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [secondCandidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());

	const deep2Search = await searchTool("call-carry-second-search", {
		attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		query: marker, source: "code_base",
	}, undefined, undefined, harness.buildContext());
	assert.equal(deep2Search.details.status, "accepted");
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute("call-carry-second-discovery", {
		attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "仍需要補充線索" },
	}, undefined, undefined, harness.buildContext({
		ui: { select: async () => "確認" },
	}));
	await settlePendingDeepPrompt(harness);
	const understandingInvocation = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const understandingAttemptId = understandingInvocation.match(/attemptId=([^\s]+)/)?.[1];
	assert.ok(understandingAttemptId);
	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingTool?.execute);
	const result = await understandingTool.execute("call-carry-understanding-complete", {
		attemptId: understandingAttemptId,
		sourceRoundId: "grill-2",
		phase: "KNOWLEDGE_UNDERSTANDING",
		outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions: [], findings: [], limitations: [] },
	}, undefined, undefined, harness.buildContext());
	const details = result.details as { evidencePackage?: { evidence?: Array<{ evidenceId: string; content: string }> } };
	const evidence = details.evidencePackage?.evidence ?? [];
	assert.equal(evidence.filter((item) => item.evidenceId === firstCandidateId).length, 1);
	assert.equal(evidence.find((item) => item.evidenceId === firstCandidateId)?.content, firstContent);
});

test("Extension_DeepDiscoveryFallback_WhenSnapshotSwitches_ShouldCarryDeepSupplementalEvidenceIntoUnderstanding", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const marker = "DeepDiscoveryCarrySupplementalNeedle";
	const { harness, searchTool } = await prepareDeepRetrieval(rootDir, "deep-discovery-carry-supplemental", marker);
	const firstRetrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(firstRetrievalTool?.execute);
	const firstRetrievalResult = await firstRetrievalTool.execute("call-carry-supplemental-first-discovery", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, undefined, undefined, harness.buildContext());
	const secondGrillInvocation = await transformNeedsDiscoveryToolResult(harness, "call-carry-supplemental-first-discovery", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, firstRetrievalResult);
	const secondCandidateId = secondGrillInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(secondCandidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-carry-supplemental-second-evidence", { candidateId: secondCandidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-carry-supplemental-second-grill", {
		roundId: "grill-2", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [secondCandidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());

	const supplementalContent = `唯一 supplemental marker：${marker}\n`;
	writeWorkspaceFile(rootDir, "wiki/deep-supplemental-marker.md", supplementalContent);
	const deep2Search = await searchTool("call-carry-supplemental-second-search", {
		attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		query: marker, source: "wiki",
	}, undefined, undefined, harness.buildContext());
	assert.equal(deep2Search.details.status, "accepted");
	const deep2Evidence = deep2Search.details.evidence as Array<{ evidenceId: string; content: string }> | undefined;
	assert.equal(deep2Evidence?.length, 1);
	const reusedEvidenceIds = deep2Search.details.reusedEvidenceIds as string[] | undefined;
	assert.deepEqual(reusedEvidenceIds, []);
	const supplementalEvidence = deep2Evidence?.[0];
	assert.ok(supplementalEvidence);
	assert.equal(supplementalEvidence.content, supplementalContent);
	const supplementalEvidenceId = supplementalEvidence.evidenceId;

	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute("call-carry-supplemental-second-discovery", {
		attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "仍需要補充線索" },
	}, undefined, undefined, harness.buildContext({ ui: { select: async () => "確認" } }));
	await settlePendingDeepPrompt(harness);
	const understandingInvocation = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const understandingAttemptId = understandingInvocation.match(/attemptId=([^\s]+)/)?.[1];
	assert.ok(understandingAttemptId);
	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingTool?.execute);
	const result = await understandingTool.execute("call-carry-supplemental-understanding-complete", {
		attemptId: understandingAttemptId,
		sourceRoundId: "grill-2",
		phase: "KNOWLEDGE_UNDERSTANDING",
		outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions: [], findings: [], limitations: [] },
	}, undefined, undefined, harness.buildContext());
	const details = result.details as {
		evidencePackage?: { evidence?: Array<{ evidenceId: string; content: string; origin: string }> };
	};
	const evidence = details.evidencePackage?.evidence ?? [];
	assert.equal(evidence.filter((item) => item.evidenceId === supplementalEvidenceId).length, 1);
	assert.equal(evidence.find((item) => item.evidenceId === supplementalEvidenceId)?.content, supplementalContent);
	assert.equal(evidence.find((item) => item.evidenceId === supplementalEvidenceId)?.origin, "deep_retrieval");
});

test("Extension_DeepDiscoveryFallback_WhenConfirmed_ShouldRecordHumanPremiseAndDecisionReference", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const marker = "DeepDiscoveryHumanPremiseNeedle";
	const originalGoal = `請幫我測試 ${marker} deep-discovery-human-premise.ts`;
	const { harness, searchTool } = await prepareDeepRetrieval(
		rootDir,
		"deep-discovery-human-premise",
		marker,
		false,
		originalGoal,
	);
	const firstRetrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(firstRetrievalTool?.execute);
	const firstRetrievalResult = await firstRetrievalTool.execute("call-human-premise-first-discovery", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, undefined, undefined, harness.buildContext());
	const secondGrillInvocation = await transformNeedsDiscoveryToolResult(harness, "call-human-premise-first-discovery", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, firstRetrievalResult);
	const secondCandidateId = secondGrillInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(secondCandidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-human-premise-second-evidence", { candidateId: secondCandidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-human-premise-second-grill", {
		roundId: "grill-2", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [secondCandidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());

	const deep2Search = await searchTool("call-human-premise-second-search", {
		attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		query: marker, source: "code_base",
	}, undefined, undefined, harness.buildContext());
	assert.equal(deep2Search.details.status, "accepted");
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute("call-human-premise-second-discovery", {
		attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "仍需要補充線索" },
	}, undefined, undefined, harness.buildContext({
		ui: { select: async () => "確認" },
	}));
	await settlePendingDeepPrompt(harness);
	const understandingInvocation = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const understandingAttemptId = understandingInvocation.match(/attemptId=([^\s]+)/)?.[1];
	assert.ok(understandingAttemptId);
	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingTool?.execute);
	const result = await understandingTool.execute("call-human-premise-understanding-complete", {
		attemptId: understandingAttemptId,
		sourceRoundId: "grill-2",
		phase: "KNOWLEDGE_UNDERSTANDING",
		outcome: {
			kind: "completed",
			knowledgeSummary: "測試知識摘要",
			decisions: [],
			findings: [],
			limitations: [],
		},
	}, undefined, undefined, harness.buildContext());

	const details = result.details as {
		evidencePackage?: {
			evidence?: Array<{
				evidenceId: string;
				origin: string;
				source: string;
				content: string;
				metadata: Record<string, unknown>;
			}>;
		decisions?: Array<{ evidenceIds: string[] }>;
	};
	};
	const evidence = details.evidencePackage?.evidence ?? [];
	const premise = evidence.filter((item) => item.origin === "human_premise");
	assert.equal(premise.length, 1);
	assert.equal(premise[0]?.source, "forge://human-premise");
	assert.match(premise[0]?.content ?? "", new RegExp(marker));
	assert.match(premise[0]?.content ?? "", new RegExp(originalGoal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.match(premise[0]?.content ?? "", /此專案資料來源不足，將以前次grill\/ 資料來源所得之證據進行後續開發，請確認/);
	assert.match(premise[0]?.content ?? "", /確認/);
	assert.equal(premise[0]?.metadata.needsDiscoveryCount, 2);
	assert.deepEqual(premise[0]?.metadata.sourceRoundIds, ["grill-1", "grill-2"]);
	const premiseId = premise[0]?.evidenceId;
	assert.ok(premiseId);
	assert.equal(details.evidencePackage?.decisions?.some((decision) => decision.evidenceIds.includes(premiseId)), true);
	assert.equal(harness.observedStatuses.at(-1)?.includes("CONTEXT_BUILD"), true);
});

test("Extension_ContextBuildStatus_ShouldUseForgeRuntimeKeyAndStatusText", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const marker = "ContextBuildStatusNeedle";
	const { harness, searchTool } = await prepareDeepRetrieval(rootDir, "context-build-status", marker);
	const firstRetrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(firstRetrievalTool?.execute);
	const firstRetrievalResult = await firstRetrievalTool.execute("call-context-status-first-discovery", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, undefined, undefined, harness.buildContext());
	const secondGrillInvocation = await transformNeedsDiscoveryToolResult(harness, "call-context-status-first-discovery", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "需要補充線索" },
	}, firstRetrievalResult);
	const secondCandidateId = secondGrillInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(secondCandidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-context-status-second-evidence", { candidateId: secondCandidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-context-status-second-grill", {
		roundId: "grill-2", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [secondCandidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	const deep2Search = await searchTool("call-context-status-second-search", {
		attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		query: marker, source: "code_base",
	}, undefined, undefined, harness.buildContext());
	assert.equal(deep2Search.details.status, "accepted");
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute("call-context-status-second-discovery", {
		attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_discovery", decisionSummary: "仍需要補充線索" },
	}, undefined, undefined, harness.buildContext({
		ui: {
			select: async () => "確認",
		},
	}));
	await settlePendingDeepPrompt(harness);
	const understandingInvocation = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const understandingAttemptId = understandingInvocation.match(/attemptId=([^\s]+)/)?.[1];
	assert.ok(understandingAttemptId);
	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingTool?.execute);
	await understandingTool.execute("call-context-status-understanding-complete", {
		attemptId: understandingAttemptId, sourceRoundId: "grill-2", phase: "KNOWLEDGE_UNDERSTANDING",
		outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions: [], findings: [], limitations: [] },
	}, undefined, undefined, harness.buildContext({
	}));
	const contextBuildStatus = harness.observedStatusCalls.at(-1);
	assert.equal(contextBuildStatus?.key, "forge-runtime");
	assert.match(contextBuildStatus?.text ?? "", /Forge CONTEXT_BUILD \[active\]/);
});

test("Extension_DeepFallback_WhenConfirmedWithoutLockedEvidence_ShouldAcceptNeedsDecisionEvidence", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const marker = "FallbackNeedsDecisionEvidenceNeedle";
	const { harness, searchTool, candidateId } = await prepareDeepRetrieval(rootDir, "fallback-needs-decision-evidence", marker);
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	const firstResult = await retrievalTool.execute("call-fallback-needs-decision-first", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL", outcome: { kind: "needs_discovery" },
	}, undefined, undefined, harness.buildContext());
	const invocation = await transformNeedsDiscoveryToolResult(harness, "call-fallback-needs-decision-first", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL", outcome: { kind: "needs_discovery" },
	}, firstResult);
	const secondCandidateId = invocation.match(/ev-[0-9a-f]{64}/)?.[0];
	assert.ok(secondCandidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(evidenceTool?.execute);
	assert.ok(grillCompleteTool?.execute);
	await evidenceTool.execute("call-fallback-needs-decision-evidence", { candidateId: secondCandidateId }, undefined, undefined, harness.buildContext());
	await grillCompleteTool.execute("call-fallback-needs-decision-grill", { roundId: "grill-2", status: "READY_FOR_DEEP", questions: [], recommendation: { value: "proceed", reason: "ok", confidence: 0.9 }, evidence: [secondCandidateId], requiresUserConfirmation: false }, undefined, undefined, harness.buildContext());
	const identity = { attemptId: "deep-2", sourceRoundId: "grill-2", phase: "DEEP_KNOWLEDGE_RETRIEVAL" as const };
	const search = await searchTool("call-fallback-needs-decision-search", { ...identity, query: marker, source: "code_base" }, undefined, undefined, harness.buildContext());
	assert.equal(search.details.status, "accepted");
	const completion = await retrievalTool.execute("call-fallback-needs-decision-complete", { ...identity, outcome: { kind: "needs_discovery" } }, undefined, undefined, harness.buildContext({ ui: { select: async () => "確認" } }));
	assert.equal(completion.details.status, "needs_discovery");
	await settlePendingDeepPrompt(harness);
	const deepComplete = harness.registeredTools.get("forge_deep_complete");
	assert.ok(deepComplete?.execute);
	const understandingInvocation = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const understandingAttemptId = understandingInvocation.match(/attemptId=([^\s]+)/)?.[1];
	assert.ok(understandingAttemptId);
	const result = await deepComplete.execute("call-fallback-needs-decision-understanding", { attemptId: understandingAttemptId, sourceRoundId: "grill-2", phase: "KNOWLEDGE_UNDERSTANDING", outcome: { kind: "needs_decision", decisionId: "fallback-decision", question: "是否繼續？", options: ["繼續"], recommendation: "繼續", evidenceIds: [candidateId] } }, undefined, undefined, harness.buildContext());
	assert.equal(result.details.status, "needs_decision");
});

test("Extension_SuccessfulSwitchBeforeNewWorkflow_ShouldClearFallbackEvidenceAndMetadata", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const oldMarker = "OldWorkflowFallbackMarker";
	const newMarker = "NewWorkflowFallbackMarker";
	const oldGoal = `請幫我測試 ${oldMarker} old-workflow.ts`;
	const newGoal = `請幫我測試 ${newMarker} new-workflow.ts`;
	const oldPath = writeWorkspaceFile(rootDir, "code_base/src/old-workflow.ts", `// ${oldMarker}\n`);
	writeWorkspaceFile(rootDir, "code_base/src/new-workflow.ts", `// ${newMarker}\n`);

	let harness!: Awaited<ReturnType<typeof createExtensionHarness>>;
	const replacementSessionMessages: string[] = [];
	harness = await createExtensionHarness({
		cwd: rootDir,
		reenterFollowUps: true,
		newSession: async (sessionOptions) => {
			await sessionOptions?.withSession?.({
				async sendUserMessage(content) {
					replacementSessionMessages.push(content);
				},
			});
			return { cancelled: false };
		},
	});

	const oldStart = await harness.sendInput(oldGoal);
	const oldInvocation = (oldStart as { text?: string }).text ?? "";
	const oldCandidateId = oldInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(oldCandidateId);
	const oldRoundId = oldInvocation.match(/roundId\s*[:：]\s*(grill-\d+)/)?.[1];
	assert.ok(oldRoundId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-old-workflow-evidence", { candidateId: oldCandidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute(
		"call-old-workflow-grill-complete",
		{
			roundId: oldRoundId,
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "old workflow", confidence: 0.9 },
			evidence: [oldCandidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	const oldDeepInvocation = await settlePendingDeepPrompt(harness);
	const parseIdentity = (content: string): RuntimeIssuedIdentity => {
		const field = (name: string): string => {
			const value = content.match(new RegExp(`${name}(?:=|["']?\\s*:\\s*["']?)([^\\s,"}]+)`))?.[1];
			assert.ok(value, `runtime invocation 應包含 ${name}`);
			return value;
		};
		return {
			attemptId: field("attemptId"),
			sourceRoundId: field("sourceRoundId"),
			phase: field("phase") as RuntimeIssuedIdentity["phase"],
		};
	};
	const oldIdentity = parseIdentity(oldDeepInvocation);
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute(
		"call-old-workflow-needs-discovery",
		{ ...oldIdentity, outcome: { kind: "needs_discovery", decisionSummary: "old fallback" } },
		undefined,
		undefined,
		harness.buildContext(),
	);

	rmSync(oldPath, { force: true });
	await harness.runCommand(`switch ${newGoal}`);
	assert.deepEqual(replacementSessionMessages, [newGoal]);
	const newStart = await harness.sendInput(newGoal);
	const newInvocation = (newStart as { text?: string }).text ?? "";
	assert.match(newInvocation, new RegExp(escapeRegExp(newGoal)));
	assert.doesNotMatch(newInvocation, new RegExp(escapeRegExp(oldGoal)));
	const newCandidateId = newInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(newCandidateId);
	const newRoundId = newInvocation.match(/roundId\s*[:：]\s*(grill-\d+)/)?.[1];
	assert.ok(newRoundId);

	await evidenceTool.execute("call-new-workflow-evidence", { candidateId: newCandidateId }, undefined, undefined, harness.buildContext());
	await grillCompleteTool.execute(
		"call-new-workflow-grill-complete",
		{
			roundId: newRoundId,
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "new workflow", confidence: 0.9 },
			evidence: [newCandidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	const firstNewIdentity = parseIdentity(await settlePendingDeepPrompt(harness));
	const firstNewResult = await retrievalTool.execute(
		"call-new-workflow-first-needs-discovery",
		{ ...firstNewIdentity, outcome: { kind: "needs_discovery", decisionSummary: "new first fallback" } },
		undefined,
		undefined,
		harness.buildContext(),
	);
	const secondNewInvocation = await transformNeedsDiscoveryToolResult(harness, "call-new-workflow-first-needs-discovery", {
		...firstNewIdentity, outcome: { kind: "needs_discovery", decisionSummary: "new first fallback" },
	}, firstNewResult);
	const secondCandidateId = secondNewInvocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(secondCandidateId);
	const secondNewRoundId = secondNewInvocation.match(/roundId\s*[:：]\s*(grill-\d+)/)?.[1];
	assert.ok(secondNewRoundId);
	await evidenceTool.execute("call-new-workflow-second-evidence", { candidateId: secondCandidateId }, undefined, undefined, harness.buildContext());
	await grillCompleteTool.execute(
		"call-new-workflow-second-grill-complete",
		{
			roundId: secondNewRoundId,
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "new second workflow", confidence: 0.9 },
			evidence: [secondCandidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	const secondNewIdentity = parseIdentity(await settlePendingDeepPrompt(harness));
	await retrievalTool.execute(
		"call-new-workflow-second-needs-discovery",
		{ ...secondNewIdentity, outcome: { kind: "needs_discovery", decisionSummary: "new second fallback" } },
		undefined,
		undefined,
		harness.buildContext({ ui: { select: async () => "確認" } }),
	);
	await settlePendingDeepPrompt(harness);
	const understandingInvocation = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	const understandingIdentity = parseIdentity(understandingInvocation);
	assert.equal(understandingIdentity.phase, "KNOWLEDGE_UNDERSTANDING");
	const deepCompleteTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(deepCompleteTool?.execute);
	const completeResult = await deepCompleteTool.execute(
		"call-new-workflow-understanding-complete",
		{
			...understandingIdentity,
			outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions: [], findings: [], limitations: [] },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(completeResult.details.status, "accepted");
	const evidencePackage = completeResult.details.evidencePackage as {
		evidence: Array<{ evidenceId: string; origin: string; content: string; metadata: Record<string, unknown> }>;
	};
	const premise = evidencePackage.evidence.filter((item) => item.origin === "human_premise");
	assert.equal(premise.length, 1);
	const humanPremiseEvidenceId = premise[0]?.evidenceId;
	assert.ok(humanPremiseEvidenceId);
	assert.deepEqual(
		evidencePackage.evidence.filter((item) => item.origin !== "deep_retrieval").map((item) => item.evidenceId),
		[newCandidateId, humanPremiseEvidenceId],
	);
	assert.match(premise[0]?.content ?? "", new RegExp(escapeRegExp(newGoal)));
	assert.doesNotMatch(premise[0]?.content ?? "", new RegExp(escapeRegExp(oldGoal)));
	assert.equal(premise[0]?.metadata.needsDiscoveryCount, 2);
	assert.deepEqual(premise[0]?.metadata.sourceRoundIds, [firstNewIdentity.sourceRoundId, secondNewIdentity.sourceRoundId]);
	assert.doesNotMatch(JSON.stringify(evidencePackage), new RegExp(escapeRegExp(oldMarker)));
	assert.equal(harness.observedStatuses.at(-1)?.includes("CONTEXT_BUILD"), true);
});

test("Extension_WhenRetrievalNeedsDecisionReceivesUserInput_ShouldRetryRetrievalWithoutReturningToGrill", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/deep-retrieval-decision.ts", "// DeepRetrievalDecisionNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DeepRetrievalDecisionNeedle deep-retrieval-decision.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-retrieval-decision-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute(
		"call-retrieval-decision-grill-complete",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	const decisionResult = await retrievalTool.execute(
		"call-retrieval-decision",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: {
				kind: "needs_decision",
				decisionId: "retrieval-decision",
				question: "是否以目前證據繼續？",
				options: ["繼續", "停止"],
				recommendation: "繼續",
				evidenceIds: [candidateId],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(decisionResult.details.status, "needs_decision");
	const statusCountBeforeAnswer = harness.observedStatuses.length;

	const answerResult = await harness.sendInput("補充答案：繼續");
	const nextInvocation = (answerResult as { text?: string }).text ?? "";
	assert.equal((answerResult as { action?: string }).action, "transform");
	assert.match(nextInvocation, /attemptId=deep-2/);
	assert.match(nextInvocation, /sourceRoundId=grill-1/);
	assert.match(nextInvocation, /phase=DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);
	assert.equal(
		harness.observedStatuses.slice(statusCountBeforeAnswer).some((status) => status.includes("GRILL [active]")),
		false,
		"Deep Retrieval decision answer 不得回到 Grill",
	);
});

test("Extension_WhenUnderstandingNeedsDecisionAndConfirmRuns_ShouldRetryUnderstandingWithoutReturningToRetrieval", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/deep-understanding-decision.ts", "// DeepUnderstandingDecisionNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DeepUnderstandingDecisionNeedle deep-understanding-decision.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-understanding-decision-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute(
		"call-understanding-decision-grill-complete",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute(
		"call-understanding-decision-retrieval",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL",
			outcome: { kind: "completed" },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingTool?.execute);
	const decisionResult = await understandingTool.execute(
		"call-understanding-decision",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: {
				kind: "needs_decision",
				decisionId: "understanding-decision",
				question: "是否接受這項理解？",
				options: ["接受", "停止"],
				recommendation: "接受",
				evidenceIds: [candidateId],
			},
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(decisionResult.details.status, "needs_decision");
	const statusCountBeforeConfirm = harness.observedStatuses.length;

	await harness.runCommand("confirm");
	await settlePendingDeepPrompt(harness);

	const nextInvocation = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	assert.match(nextInvocation, /attemptId=deep-2/);
	assert.match(nextInvocation, /sourceRoundId=grill-1/);
	assert.match(nextInvocation, /phase=KNOWLEDGE_UNDERSTANDING/);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_complete"]);
	assert.equal(
		harness.observedStatuses.slice(statusCountBeforeConfirm).some((status) => status.includes("DEEP_KNOWLEDGE_RETRIEVAL")),
		false,
		"Knowledge Understanding decision confirm 不得回到 Retrieval",
	);
	assert.equal(
		harness.observedStatuses.slice(statusCountBeforeConfirm).some((status) => status.includes("GRILL [active]")),
		false,
		"Knowledge Understanding decision confirm 不得回到 Grill",
	);
});

test("Extension_WhenUnderstandingDecisionReplayAwaitsMessageStart_ShouldBlockStaleAttemptOnly", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/decision-replay-gate.ts", "// DecisionReplayGateNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DecisionReplayGateNeedle decision-replay-gate.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(evidenceTool?.execute);
	assert.ok(grillCompleteTool?.execute);
	await evidenceTool.execute("call-decision-replay-gate-evidence", { candidateId }, undefined, undefined, harness.buildContext());
	await grillCompleteTool.execute("call-decision-replay-gate-grill", {
		roundId: "grill-1", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	await settlePendingDeepPrompt(harness);

	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(retrievalTool?.execute);
	assert.ok(understandingTool?.execute);
	await retrievalTool.execute("call-decision-replay-gate-retrieval", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL", outcome: { kind: "completed" },
	}, undefined, undefined, harness.buildContext());
	await understandingTool.execute("call-decision-replay-gate-decision", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "KNOWLEDGE_UNDERSTANDING",
		outcome: {
			kind: "needs_decision", decisionId: "decision-replay-gate", question: "是否接受？",
			options: ["接受", "停止"], recommendation: "接受", evidenceIds: [candidateId],
		},
	}, undefined, undefined, harness.buildContext());

	await harness.runCommand("confirm");
	await settlePendingDeepPrompt(harness);
	const replayInvocation = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	assert.match(replayInvocation, /attemptId=deep-2/);
	assert.ok(harness.toolCallHandler);
	assert.deepEqual(await harness.toolCallHandler({
		type: "tool_call", toolCallId: "call-stale-deep-1", toolName: "forge_deep_complete", input: {
			attemptId: "deep-1", sourceRoundId: "grill-1", phase: "KNOWLEDGE_UNDERSTANDING",
		},
	}), { block: true });
	assert.deepEqual(await harness.toolCallHandler({
		type: "tool_call", toolCallId: "call-fresh-deep-2-before-start", toolName: "forge_deep_complete", input: {
			attemptId: "deep-2", sourceRoundId: "grill-1", phase: "KNOWLEDGE_UNDERSTANDING",
		},
	}), { block: true });

	assert.ok(harness.messageStartHandler, "Expected message_start handler for replay identity gate");
	await harness.messageStartHandler({
		type: "message_start",
		message: { role: "user", content: [{ type: "text", text: replayInvocation }], timestamp: Date.now() },
	} as never, harness.buildContext());
	assert.deepEqual(await harness.toolCallHandler({
		type: "tool_call", toolCallId: "call-fresh-deep-2-after-start", toolName: "forge_deep_complete", input: {
			attemptId: "deep-2", sourceRoundId: "grill-1", phase: "KNOWLEDGE_UNDERSTANDING",
		},
	}), undefined);
});

test("Extension_WhenDeepContinueRuns_ShouldCreateNewAttemptAndPreservePhaseAndSourceRound", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/deep-continue-attempt.ts", "// DeepContinueAttemptNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DeepContinueAttemptNeedle deep-continue-attempt.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-continue-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-continue-grill-complete", {
		roundId: "grill-1", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await harness.runCommand("continue");
	const searchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(searchTool?.execute);
	const retrievalRetry = await searchTool.execute("call-retrieval-retry", {
		attemptId: "deep-2", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		query: "DeepContinueAttemptNeedle", source: "code_base",
	}, undefined, undefined, harness.buildContext());
	assert.equal(retrievalRetry.details.status, "accepted");
	await retrievalTool.execute("call-retrieval-lock", {
		attemptId: "deep-2", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL", outcome: { kind: "completed" },
	}, undefined, undefined, harness.buildContext());
	const deepCompleteTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(deepCompleteTool?.execute);
	await harness.runCommand("continue");
	const understandingRetry = await deepCompleteTool.execute("call-understanding-retry", {
		attemptId: "deep-3", sourceRoundId: "grill-1", phase: "KNOWLEDGE_UNDERSTANDING",
		outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions: [], findings: [{ statement: "ok", evidenceIds: [candidateId] }], limitations: [] },
	}, undefined, undefined, harness.buildContext());
	assert.equal(understandingRetry.details.status, "accepted");
});

test("Extension_WhenDeepCancelRuns_ShouldKeepInputSnapshotEvidenceAndRestoreOriginalTools", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "wiki/deep-cancel-extra.md", "DeepCancelNeedle supplemental evidence.\n");
	writeWorkspaceFile(rootDir, "code_base/src/deep-cancel.ts", "// DeepCancelNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"], reenterFollowUps: true });
	const request = "請幫我測試 DeepCancelNeedle deep-cancel.ts";
	const startResult = await harness.sendInput(request);
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-cancel-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-cancel-grill-complete", {
		roundId: "grill-1", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	const searchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(searchTool?.execute);
	const searchResult = await searchTool.execute("call-cancel-search", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		query: "DeepCancelNeedle", source: "wiki",
	}, undefined, undefined, harness.buildContext());
	assert.equal(searchResult.details.status, "accepted");
	const supplementalEvidenceId = (searchResult.details.evidence as Array<{ evidenceId: string }>)[0]?.evidenceId;
	assert.ok(supplementalEvidenceId);
	await harness.runCommand("cancel");
	assert.deepEqual(harness.getActiveTools(), ["read"]);
	assert.match(harness.observedStatuses.at(-1) ?? "", /DEEP_KNOWLEDGE_RETRIEVAL/);
	await harness.runCommand("continue");
	const restartedDeepInvocation = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	assert.match(restartedDeepInvocation, /DEEP_KNOWLEDGE_RETRIEVAL/);
	assert.match(restartedDeepInvocation, /deep-2/);
	assert.match(restartedDeepInvocation, /grill-1/);
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);
});

test("Integration_WhenDeepSearchQueryExceedsCharacterLimit_ShouldRejectWithoutChangingAttemptState", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-query-limit-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute(
		"call-query-limit-grill-complete",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	const searchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(searchTool?.execute);
	const identity = {
		attemptId: "deep-1",
		sourceRoundId: "grill-1",
		phase: "DEEP_KNOWLEDGE_RETRIEVAL" as const,
	};
	const beforeStatus = harness.observedStatuses.at(-1);
	const beforeTools = harness.getActiveTools();
	const accepted = await searchTool.execute(
		"call-query-limit-1500",
		{ ...identity, query: "😀".repeat(1500), source: "wiki" },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(accepted.details.status, "accepted");
	assert.equal(harness.observedStatuses.at(-1), beforeStatus);
	assert.deepEqual(harness.getActiveTools(), beforeTools);

	const rejected = await searchTool.execute(
		"call-query-limit-1501",
		{ ...identity, query: "😀".repeat(1501), source: "wiki" },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.ok(["rejected", "invalid"].includes(String(rejected.details.status)));
	assert.equal(harness.observedStatuses.at(-1), beforeStatus);
	assert.deepEqual(harness.getActiveTools(), beforeTools);
});

test("Integration_WhenDeepSearchRoundExceedsSearchLimit_ShouldRejectNinthSearchAcrossRetry", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"], reenterFollowUps: true });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-search-count-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute(
		"call-search-count-grill-complete",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	const searchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(searchTool?.execute);
	const searchExecute = searchTool.execute;
	assert.ok(searchExecute);
	const baseIdentity = {
		sourceRoundId: "grill-1",
		phase: "DEEP_KNOWLEDGE_RETRIEVAL" as const,
	};
	for (let index = 1; index <= 8; index += 1) {
		const result = await searchExecute(
			`call-search-count-${index}`,
			{ ...baseIdentity, attemptId: "deep-1", query: `quota-probe-${index}`, source: "wiki" },
			undefined,
			undefined,
			harness.buildContext(),
		);
		assert.equal(result.details.status, "accepted", `第 ${index} 次搜尋應成功`);
	}

	await harness.runCommand("cancel");
	await harness.runCommand("continue");
	const retryInvocation = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	assert.match(retryInvocation, /attemptId=deep-2/);
	assert.match(retryInvocation, /sourceRoundId=grill-1/);
	const beforeNinthStatus = harness.observedStatuses.at(-1);
	const beforeNinthTools = harness.getActiveTools();
	const ninth = await searchTool.execute(
		"call-search-count-9",
		{ ...baseIdentity, attemptId: "deep-2", query: "quota-probe-9", source: "wiki" },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.ok(["rejected", "invalid"].includes(String(ninth.details.status)));
	assert.equal(harness.observedStatuses.at(-1), beforeNinthStatus);
	assert.deepEqual(harness.getActiveTools(), beforeNinthTools);
});

test("Integration_WhenEvidenceExceedsByteLimit_ShouldRejectWithoutRecordingIt", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const acceptedMarker = "AcceptedByteNeedle";
	const oversizedMarker = "OversizedByteNeedle";
	writeWorkspaceFile(rootDir, "code_base/src/byte-limit-grill.ts", "ByteLimitGrillNeedle");
	writeWorkspaceFile(
		rootDir,
		"code_base/src/accepted-AcceptedByteNeedle-256-kib.ts",
		acceptedMarker + "A".repeat(262144 - Buffer.byteLength(acceptedMarker, "utf8")),
	);
	writeWorkspaceFile(
		rootDir,
		"code_base/src/oversized-OversizedByteNeedle-256-kib.ts",
		oversizedMarker + "B".repeat(262145 - Buffer.byteLength(oversizedMarker, "utf8")),
	);
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-byte-limit-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute(
		"call-byte-limit-grill-complete",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	const searchTool = harness.registeredTools.get("forge_deep_search");
	assert.ok(searchTool?.execute);
	const identity = {
		attemptId: "deep-1",
		sourceRoundId: "grill-1",
		phase: "DEEP_KNOWLEDGE_RETRIEVAL" as const,
	};
	const beforeStatus = harness.observedStatuses.at(-1);
	const beforeTools = harness.getActiveTools();
	const accepted = await searchTool.execute(
		"call-byte-limit-accepted",
		{ ...identity, query: acceptedMarker, source: "code_base" },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(accepted.details.status, "accepted");
	assert.equal((accepted.details.evidence as Array<{ content: string }>).length, 1);
	assert.equal(Buffer.byteLength((accepted.details.evidence as Array<{ content: string }>)[0].content, "utf8"), 262144);
	assert.equal(harness.observedStatuses.at(-1), beforeStatus);
	assert.deepEqual(harness.getActiveTools(), beforeTools);

	const oversized = await searchTool.execute(
		"call-byte-limit-oversized",
		{ ...identity, query: oversizedMarker, source: "code_base" },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.ok(["rejected", "invalid"].includes(String(oversized.details.status)));
	assert.deepEqual(oversized.details.evidence ?? [], []);
	assert.equal(harness.observedStatuses.at(-1), beforeStatus);
	assert.deepEqual(harness.getActiveTools(), beforeTools);

	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	const locked = await retrievalTool.execute(
		"call-byte-limit-lock",
		{ ...identity, outcome: { kind: "completed" } },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(locked.details.status, "accepted");
	assert.equal((locked.details.lockedEvidenceIds as string[]).length, 2);
	assert.doesNotMatch(JSON.stringify(locked.details), new RegExp(oversizedMarker));
});

test("Integration_WhenWikiOrCodeBaseEvidenceExceedsByteLimit_ShouldRejectWithoutConsumingSearchQuota", async (t) => {
	for (const source of ["wiki", "code_base"] as const) {
		const rootDir = createTempRoot();
		t.after(() => rmSync(rootDir, { force: true, recursive: true }));
		const oversizedMarker = `${source}-OversizedPreReadNeedle`;
		writeWorkspaceFile(
			rootDir,
			`${source}/oversized-${oversizedMarker}.md`,
			oversizedMarker + "X".repeat(262145 - Buffer.byteLength(oversizedMarker, "utf8")),
		);
		for (let index = 1; index <= 8; index += 1) {
			writeWorkspaceFile(
				rootDir,
				`${source}/quota-${source}-QuotaNeedle-${index}.md`,
				`${source}-QuotaNeedle-${index}`,
			);
		}

		const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
		const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
		const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
		assert.ok(evidenceTool?.execute);
		await evidenceTool.execute(`call-${source}-grill`, { candidateId }, undefined, undefined, harness.buildContext());
		const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
		assert.ok(grillCompleteTool?.execute);
		await grillCompleteTool.execute(
			`call-${source}-grill-complete`,
			{
				roundId: "grill-1",
				status: "READY_FOR_DEEP",
				questions: [],
				recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
				evidence: [candidateId],
				requiresUserConfirmation: false,
			},
			undefined,
			undefined,
			harness.buildContext(),
		);
		const searchTool = harness.registeredTools.get("forge_deep_search");
		assert.ok(searchTool?.execute);
		const searchExecute = searchTool.execute;
		assert.ok(searchExecute);
		const identity = {
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "DEEP_KNOWLEDGE_RETRIEVAL" as const,
		};

		const oversized = await searchExecute(
			`call-${source}-oversized`,
			{ ...identity, query: oversizedMarker, source },
			undefined,
			undefined,
			harness.buildContext(),
		);
		assert.equal(oversized.details.status, "rejected");
		assert.equal(oversized.details.reason, "evidence_too_large");
		assert.deepEqual(oversized.details.evidence ?? [], []);

		for (let index = 1; index <= 8; index += 1) {
			const accepted = await searchExecute(
				`call-${source}-quota-${index}`,
				{ ...identity, query: `${source}-QuotaNeedle-${index}`, source },
				undefined,
				undefined,
				harness.buildContext(),
			);
			assert.equal(accepted.details.status, "accepted", `${source} 第 ${index} 次合法搜尋應成功`);
		}
	}
});

test("Integration_WhenGrillSnapshotSourceExceedsByteLimit_ShouldKeepManifestButRejectEvidenceFetch", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const marker = "GrillSnapshotOversizedNeedle";
	writeWorkspaceFile(
		rootDir,
		"wiki/grill-snapshot-oversized.md",
		marker + "Y".repeat(262145 - Buffer.byteLength(marker, "utf8")),
	);
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const initialResult = await harness.sendInput(`請幫我測試 ${marker} grill-snapshot-oversized.md`);
	const initialInvocation = (initialResult as { text?: string }).text ?? "";
	assert.match(initialInvocation, /evidence_too_large/);
	const candidateId = extractManifestCandidate(initialResult);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	const rejected = await evidenceTool.execute(
		"call-grill-snapshot-oversized",
		{ candidateId },
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(rejected.details.status, "rejected");
	assert.equal(rejected.details.reason, "evidence_too_large");
	assert.deepEqual(rejected.details.evidence ?? [], []);
	assert.match(harness.observedStatuses.at(-1) ?? "", /GRILL/);

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute);
	const completionExecute = completionTool.execute;
	assert.ok(completionExecute);
	await assert.rejects(
		() =>
			completionExecute(
				"call-grill-snapshot-oversized-complete",
				{
					roundId: "grill-1",
					status: "READY_FOR_DEEP",
					questions: [],
					recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
					evidence: [candidateId],
					requiresUserConfirmation: false,
				},
				undefined,
				undefined,
				harness.buildContext(),
			),
		/evidence that was not fetched/,
	);
	assert.match(harness.observedStatuses.at(-1) ?? "", /GRILL/);
});

test("Integration_WhenDeepCompleteExceedsPackageCountLimit_ShouldRejectWithoutChangingUnderstandingState", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-package-limit-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute(
		"call-package-limit-grill-complete",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
			evidence: [candidateId],
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	const identity = {
		attemptId: "deep-1",
		sourceRoundId: "grill-1",
		phase: "DEEP_KNOWLEDGE_RETRIEVAL" as const,
	};
	await retrievalTool.execute("call-package-limit-retrieval", { ...identity, outcome: { kind: "completed" } }, undefined, undefined, harness.buildContext());
	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingTool?.execute);
	const beforeStatus = harness.observedStatuses.at(-1);
	const beforeTools = harness.getActiveTools();
	const tooManyFindings = Array.from({ length: 51 }, (_, index) => ({
		statement: `超過上限的發現 ${index}`,
		evidenceIds: [candidateId],
	}));
	const rejected = await understandingTool.execute(
		"call-package-limit-understanding",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions: [], findings: tooManyFindings, limitations: [] },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(rejected.details.status, "invalid");
	assert.equal(harness.observedStatuses.at(-1), beforeStatus, "拒絕時 stage 不得改變");
	assert.deepEqual(harness.getActiveTools(), beforeTools, "拒絕時 Understanding 工具面不得改變");

	const accepted = await understandingTool.execute(
		"call-package-limit-understanding-retry",
		{
			attemptId: "deep-1",
			sourceRoundId: "grill-1",
			phase: "KNOWLEDGE_UNDERSTANDING",
			outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions: [], findings: [{ statement: "合法發現", evidenceIds: [candidateId] }], limitations: [] },
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
	assert.equal(accepted.details.status, "accepted", "同一 attempt 應可在拒絕後重試");
});

test("Integration_WhenGrillRoundEvidenceExceedsTwoMiB_ShouldRejectNinthFetchWithoutRecordingIt", async (t) => {
	const rootDir = createTempRoot({ withWiki: false, withCodeBase: false });
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	mkdirSync(join(rootDir, "code_base"), { recursive: true });
	const marker = "GrillRoundTotalNeedle";
	const wikiPaths = Array.from({ length: 3 }, (_, index) => `wiki/GrillRoundTotalNeedle-${index + 1}.md`);
	const codeBasePaths = Array.from({ length: 3 }, (_, index) => `code_base/src/GrillRoundTotalNeedle-${index + 4}.ts`);
	const targetPaths = Array.from({ length: 3 }, (_, index) => `src/GrillRoundTotalNeedle-${index + 4}.ts`);
	for (const [index, relativePath] of [...wikiPaths, ...codeBasePaths, ...targetPaths].entries()) {
		const contentMarker = `${marker}-${index + 1}`;
		writeWorkspaceFile(rootDir, relativePath, contentMarker + "X".repeat(262144 - Buffer.byteLength(contentMarker, "utf8")));
	}

	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"], reenterFollowUps: true });
	const initialResult = await harness.sendInput(`/grill-run 請幫我測試 ${marker}`);
	const candidateIds = [...new Set(((initialResult as { text?: string }).text ?? "").match(/\bev-[0-9a-f]{64}\b/g) ?? [])];
	assert.equal(candidateIds.length, 9, "應公開九筆可定位的 snapshot candidate");
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	const evidenceExecute = evidenceTool?.execute;
	assert.ok(evidenceExecute);
	for (const [index, candidateId] of candidateIds.entries()) {
		const result = await evidenceExecute(
			`call-grill-round-total-${index + 1}`,
			{ candidateId },
			undefined,
			undefined,
			harness.buildContext(),
		);
		if (index < 8) {
			assert.equal(result.details.status, undefined, `第 ${index + 1} 筆證據應成功讀取`);
			continue;
		}
		assert.equal(result.details.status, "rejected");
		assert.equal(result.details.reason, "evidence_round_too_large");
		assert.deepEqual(result.details.evidence, []);
		const retry = await evidenceExecute(
			"call-grill-round-total-9-retry",
			{ candidateId },
			undefined,
			undefined,
			harness.buildContext(),
		);
		assert.equal(retry.details.status, "rejected");
		assert.equal(retry.details.reason, "evidence_round_too_large");
		assert.deepEqual(retry.details.evidence, []);
	}

	const completionTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(completionTool?.execute);
	const completion = await completionTool.execute(
		"call-grill-round-total-complete",
		{
			roundId: "grill-1",
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: { value: "proceed", reason: "前八筆證據足夠", confidence: 0.9 },
			evidence: candidateIds.slice(0, 8),
			requiresUserConfirmation: false,
		},
		undefined,
		undefined,
		harness.buildContext(),
	);
		assert.equal(completion.details.status, "READY_FOR_DEEP");
	assert.deepEqual(harness.getActiveTools(), ["forge_deep_search", "forge_deep_retrieval_complete"]);
});

test("Integration_WhenStaleRetrievalOutcomeIsCompletedOrNeedsDiscovery_ShouldRejectBeforeOutcomeValidation", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-stale-retrieval-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-stale-retrieval-grill-complete", {
		roundId: "grill-1", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	const retrievalExecute = retrievalTool?.execute;
	assert.ok(retrievalExecute);
	const beforeStatus = harness.observedStatuses.at(-1);
	const beforeTools = harness.getActiveTools();
	for (const outcome of [{ kind: "completed" as const }, { kind: "needs_discovery" as const }]) {
		const result = await retrievalExecute("call-stale-retrieval-outcome", {
			attemptId: "deep-stale", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL", outcome,
		}, undefined, undefined, harness.buildContext());
		assert.equal(result.details.status, "stale");
		assert.equal(result.terminate, true);
		assert.equal(harness.observedStatuses.at(-1), beforeStatus);
		assert.deepEqual(harness.getActiveTools(), beforeTools);
	}
});

test("Extension_WhenRetrievalNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/deep-retrieval-decision-repeat.ts", "// DeepRetrievalDecisionRepeatNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DeepRetrievalDecisionRepeatNeedle deep-retrieval-decision-repeat.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-retrieval-decision-repeat-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-retrieval-decision-repeat-grill-complete", {
		roundId: "grill-1", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	const decisionResult = await retrievalTool.execute("call-retrieval-decision-repeat-1", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_decision", decisionId: "retrieval-decision-repeat", question: "是否以目前證據繼續？", options: ["繼續", "停止"], recommendation: "繼續", evidenceIds: [candidateId] },
	}, undefined, undefined, harness.buildContext());
	assert.equal(decisionResult.details.status, "needs_decision");
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	const beforeStatus = harness.observedStatuses.at(-1);
	const beforeTools = harness.getActiveTools();
	const stale = await retrievalTool.execute("call-old-retrieval-completion", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL", outcome: { kind: "completed" },
	}, undefined, undefined, harness.buildContext());
	assert.equal(stale.details.status, "stale");
	assert.equal(stale.terminate, true);
	assert.equal(harness.observedStatuses.at(-1), beforeStatus);
	assert.deepEqual(harness.getActiveTools(), beforeTools);
	const answerResult = await harness.sendInput("補充答案：繼續");
	const nextInvocation = (answerResult as { text?: string }).text ?? "";
	assert.match(nextInvocation, /attemptId=deep-2/);
	assert.match(nextInvocation, /sourceRoundId=grill-1/);
	assert.match(nextInvocation, /phase=DEEP_KNOWLEDGE_RETRIEVAL/);
	const freshDecision = await retrievalTool.execute("call-retrieval-decision-repeat-2", {
		attemptId: "deep-2", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
		outcome: { kind: "needs_decision", decisionId: "retrieval-decision-repeat-2", question: "再次確認？", options: ["繼續", "停止"], recommendation: "繼續", evidenceIds: [candidateId] },
	}, undefined, undefined, harness.buildContext());
	assert.equal(freshDecision.details.status, "needs_decision");
});

test("Extension_WhenUnderstandingNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt", async (t) => {
	const rootDir = createTempRoot();
	writeWorkspaceFile(rootDir, "code_base/src/deep-understanding-decision-repeat.ts", "// DeepUnderstandingDecisionRepeatNeedle candidate.\n");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const startResult = await harness.sendInput("請幫我測試 DeepUnderstandingDecisionRepeatNeedle deep-understanding-decision-repeat.ts");
	const candidateId = (startResult as { text?: string }).text?.match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-understanding-decision-repeat-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-understanding-decision-repeat-grill-complete", {
		roundId: "grill-1", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute("call-understanding-decision-repeat-retrieval", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL", outcome: { kind: "completed" },
	}, undefined, undefined, harness.buildContext());
	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	assert.ok(understandingTool?.execute);
	const decisionResult = await understandingTool.execute("call-understanding-decision-repeat-1", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "KNOWLEDGE_UNDERSTANDING",
		outcome: { kind: "needs_decision", decisionId: "understanding-decision-repeat", question: "是否接受這項理解？", options: ["接受", "停止"], recommendation: "接受", evidenceIds: [candidateId] },
	}, undefined, undefined, harness.buildContext());
	assert.equal(decisionResult.details.status, "needs_decision");
	assert.match(harness.observedStatuses.at(-1) ?? "", /WAIT_USER/);
	const beforeStatus = harness.observedStatuses.at(-1);
	const beforeTools = harness.getActiveTools();
	const stale = await understandingTool.execute("call-old-understanding-completion", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "KNOWLEDGE_UNDERSTANDING",
		outcome: { kind: "completed", knowledgeSummary: "測試知識摘要", decisions: [], findings: [], limitations: [] },
	}, undefined, undefined, harness.buildContext());
	assert.equal(stale.details.status, "stale");
	assert.equal(stale.terminate, true);
	assert.equal(harness.observedStatuses.at(-1), beforeStatus);
	assert.deepEqual(harness.getActiveTools(), beforeTools);
	await harness.runCommand("confirm");
	await settlePendingDeepPrompt(harness);
	const nextInvocation = harness.observedUserMessageCalls.at(-1)?.content ?? "";
	assert.match(nextInvocation, /attemptId=deep-2/);
	assert.match(nextInvocation, /sourceRoundId=grill-1/);
	assert.match(nextInvocation, /phase=KNOWLEDGE_UNDERSTANDING/);
	const freshDecision = await understandingTool.execute("call-understanding-decision-repeat-2", {
		attemptId: "deep-2", sourceRoundId: "grill-1", phase: "KNOWLEDGE_UNDERSTANDING",
		outcome: { kind: "needs_decision", decisionId: "understanding-decision-repeat-2", question: "再次確認理解？", options: ["接受", "停止"], recommendation: "接受", evidenceIds: [candidateId] },
	}, undefined, undefined, harness.buildContext());
	assert.equal(freshDecision.details.status, "needs_decision");
});

test("Integration_WhenStaleUnderstandingOutcomeIsCompletedOrNeedsDiscovery_ShouldRejectBeforePackageValidation", async (t) => {
	const rootDir = createTempRoot();
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));
	const harness = await createExtensionHarness({ cwd: rootDir, initialActiveTools: ["read"] });
	const candidateId = await startFormalGrillRound(rootDir, harness.sendInput);
	const evidenceTool = harness.registeredTools.get("forge_grill_evidence");
	assert.ok(evidenceTool?.execute);
	await evidenceTool.execute("call-stale-understanding-grill", { candidateId }, undefined, undefined, harness.buildContext());
	const grillCompleteTool = harness.registeredTools.get("forge_grill_complete");
	assert.ok(grillCompleteTool?.execute);
	await grillCompleteTool.execute("call-stale-understanding-grill-complete", {
		roundId: "grill-1", status: "READY_FOR_DEEP", questions: [],
		recommendation: { value: "proceed", reason: "ok", confidence: 0.9 },
		evidence: [candidateId], requiresUserConfirmation: false,
	}, undefined, undefined, harness.buildContext());
	const retrievalTool = harness.registeredTools.get("forge_deep_retrieval_complete");
	assert.ok(retrievalTool?.execute);
	await retrievalTool.execute("call-stale-understanding-retrieval", {
		attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL", outcome: { kind: "completed" },
	}, undefined, undefined, harness.buildContext());
	const understandingTool = harness.registeredTools.get("forge_deep_complete");
	const understandingExecute = understandingTool?.execute;
	assert.ok(understandingExecute);
	const beforeStatus = harness.observedStatuses.at(-1);
	const beforeTools = harness.getActiveTools();
	for (const outcome of [
		{ kind: "completed" as const, knowledgeSummary: "測試知識摘要", decisions: [{ decisionId: "unknown", statement: "x", evidenceIds: ["ev-unknown"] }], findings: [], limitations: [] },
		{ kind: "needs_discovery" as const },
	]) {
		const result = await understandingExecute("call-stale-understanding-outcome", {
			attemptId: "deep-stale", sourceRoundId: "grill-1", phase: "KNOWLEDGE_UNDERSTANDING", outcome,
		}, undefined, undefined, harness.buildContext());
		assert.equal(result.details.status, "stale");
		assert.equal(result.terminate, true);
		assert.equal(harness.observedStatuses.at(-1), beforeStatus);
		assert.deepEqual(harness.getActiveTools(), beforeTools);
	}
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
