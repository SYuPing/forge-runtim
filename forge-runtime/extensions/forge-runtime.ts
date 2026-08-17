import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import Type from "typebox";
import { buildGrillingSkillInvocation } from "../src/grill/grill-skill.ts";
import {
	GrillCompletionSchema,
	type StructuredGrillResult,
	parseGrillCompletion,
	parseStructuredGrillResult,
	toWaitUserPayload,
} from "../src/grill/grill-result.ts";
import { discoverEvidence } from "../src/knowledge/discovery-engine.ts";
import {
	type CodeBaseCandidate,
	detectCodeBaseConflict,
	evaluateCandidateRelevance,
	getKnowledgeAssetStatus,
	loadWikiDiscoverySources,
} from "../src/discovery/discovery-sources.ts";
import { runLightDiscovery, type LightDiscoveryResult } from "../src/discovery/light-discovery.ts";
import { understandIntent } from "../src/intent/intent-understanding.ts";
import { buildEvidenceSummaryText } from "../src/ui/evidence-summary-widget.ts";
import { createForgeSessionState, type GrillEvidenceSnapshot, type WaitUserPayload } from "../src/runtime/session-state.ts";
import type { ForgeUiState } from "../src/ui/ui-state.ts";
import { buildValidationRepairText } from "../src/ui/validation-repair-widget.ts";
import { buildWaitUserPanel } from "../src/ui/wait-user-panel.ts";
import { buildWorkflowStatusText } from "../src/ui/workflow-status-widget.ts";

interface CommandContext {
	cwd?: string;
	newSession?: (options?: {
		withSession?: (ctx: { sendUserMessage(content: string): Promise<void> | void }) => Promise<void> | void;
	}) => Promise<{ cancelled: boolean }>;
	ui?: {
		notify(message: string, level?: string): void;
		select?(title: string, options: string[]): Promise<string | undefined>;
			custom?(
				factory: (
					tui: TUI,
					hostTheme: ForgeHostTheme,
					_keybindings: unknown,
					done: (value: string | undefined) => void,
				) => Component | Promise<Component>,
		): Promise<string | undefined>;
		setStatus?(status: string): void;
	};
	}

interface ForgeHostTheme {
	fg(token: "accent" | "muted" | "borderMuted", text: string): string;
}

interface ForgeEditorTheme {
	borderColor: EditorTheme["borderColor"];
	selectList: EditorTheme["selectList"];
}

interface CommandRegistration {
	description?: string;
	handler(args: string, ctx: CommandContext): Promise<void> | void;
}

interface ExtensionMessage {
	content?: unknown;
	customType?: unknown;
	display?: unknown;
}

interface AssistantTextBlock {
	type: "text";
	text: string;
}

interface AssistantThinkingBlock {
	type: "thinking";
	thinking: string;
}

interface AssistantToolCallBlock {
	type: "toolCall";
}

interface AssistantMessageEvent {
	message?: {
		content?: Array<AssistantTextBlock | AssistantThinkingBlock | AssistantToolCallBlock>;
		role?: string;
	};
}

interface UserMessageEvent {
	message?: {
		content?: Array<AssistantTextBlock>;
		role?: string;
	};
}

interface ToolCallEvent {
	type: "tool_call";
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
}

interface InputEvent {
	text?: unknown;
}

type ForgeEventHandler<TEvent> = {
	bivarianceHack(event: TEvent, ctx?: CommandContext): Promise<unknown> | unknown;
}["bivarianceHack"];

interface ForgeExtensionApi {
	on?(eventName: "tool_call", handler: ForgeEventHandler<ToolCallEvent>): void;
	on?(
		eventName: string,
		handler: ForgeEventHandler<AssistantMessageEvent | UserMessageEvent | InputEvent>,
	): void;
	registerCommand(name: string, command: CommandRegistration): void;
	registerTool?(tool: {
		name: string;
		label: string;
		description: string;
		parameters: object;
		execute(
			toolCallId: string,
			params: object,
			signal: AbortSignal | undefined,
			onUpdate: object | undefined,
			ctx: object,
		): Promise<object>;
	}): void;
	getActiveTools?(): string[];
	setActiveTools?(toolNames: string[]): void;
	sendMessage?(message: ExtensionMessage): Promise<void> | void;
	sendUserMessage?(content: string, options?: { deliverAs?: "steer" | "followUp" }): Promise<void> | void;
}

interface ActiveWorkflowContext {
	goal: string;
	lightDiscovery: LightDiscoveryResult;
	rootDir: string;
	seeds: string[];
	snapshot: GrillEvidenceSnapshot;
}

export default function forgeRuntimeExtension(pi: ForgeExtensionApi): void {
	const sessionState = createForgeSessionState();
	const grillToolNames = ["forge_grill_evidence", "forge_grill_complete"];
	let pendingGrillRun = false;
	let pendingKnowledgeRequest: { missingAssets: string[]; request: string; rootDir: string } | undefined;
	let pendingUserMessageRewrite: string | undefined;
	let activeWorkflow: ActiveWorkflowContext | undefined;
	let savedActiveTools: string[] | undefined;
	let suppressCompletionTurn = false;
	let pendingReplayInvocation: string | undefined;
	let pendingWaitUserDecisionId: string | undefined;
	let activeWaitUserUiLeaseDecisionId: string | undefined;
	const canEnforceGrillToolBoundary = Boolean(pi.registerTool && pi.getActiveTools && pi.setActiveTools && pi.on);
	const requireGrillToolBoundary = (ctx: CommandContext) => {
		if (canEnforceGrillToolBoundary) {
			return true;
		}
		ctx.ui?.notify?.("Forge 無法安全限制 Grill 工具面，已拒絕啟動或重播 Grill。", "warn");
		return false;
	};

	const activateGrillTools = () => {
		savedActiveTools ??= pi.getActiveTools?.();
		pi.setActiveTools?.(grillToolNames);
	};
	const restoreActiveTools = () => {
		if (!savedActiveTools) {
			return;
		}
		pi.setActiveTools?.(savedActiveTools);
		savedActiveTools = undefined;
	};
		const clearPendingState = () => {
			pendingGrillRun = false;
		pendingKnowledgeRequest = undefined;
		pendingReplayInvocation = undefined;
		pendingUserMessageRewrite = undefined;
		pendingWaitUserDecisionId = undefined;
		activeWaitUserUiLeaseDecisionId = undefined;
			suppressCompletionTurn = false;
		};
		const publishWaitUser = async (payload: WaitUserPayload, ctx: CommandContext): Promise<void> => {
			const decisionId = payload.decisionId;
			const hasDecisionId = typeof decisionId === "string" && decisionId.length > 0;
			const currentState = sessionState.current();
			if (
				currentState.stage === "WAIT_USER" &&
				hasDecisionId &&
				typeof pendingWaitUserDecisionId === "string" &&
				decisionId !== pendingWaitUserDecisionId
			) {
				return;
			}
			if (currentState.stage === "WAIT_USER" && hasDecisionId && decisionId === pendingWaitUserDecisionId) {
				if (activeWaitUserUiLeaseDecisionId === decisionId) {
					return;
				}
				activeWaitUserUiLeaseDecisionId = decisionId;
				try {
					await handleWaitUserState(pi, ctx, currentState);
				} finally {
					if (activeWaitUserUiLeaseDecisionId === decisionId) {
						activeWaitUserUiLeaseDecisionId = undefined;
					}
				}
				return;
			}
			if (hasDecisionId) {
				pendingWaitUserDecisionId = decisionId;
				activeWaitUserUiLeaseDecisionId = decisionId;
			}
			try {
				await handleWaitUserState(pi, ctx, sessionState.requireWaitUser(payload));
			} finally {
				if (hasDecisionId && activeWaitUserUiLeaseDecisionId === decisionId) {
					activeWaitUserUiLeaseDecisionId = undefined;
				}
			}
		};
		const hasActiveGrillAttempt = () => pendingGrillRun && sessionState.current().stage === "GRILL";
	const resumeGrillWithAnswer = async (answer: string, ctx: CommandContext): Promise<string | undefined> => {
		const currentRound = sessionState.continueGrillRound();
		const state = sessionState.recordAnswer(answer);
		if (state.stage !== "WAIT_USER") {
			pendingWaitUserDecisionId = undefined;
		}
		if (state.stage !== "GRILL") {
			await publishState(pi, ctx, state);
			return undefined;
		}
		const nextRound = sessionState.startGrillRound(currentRound.request, currentRound.snapshot);
		pendingGrillRun = true;
		pendingUserMessageRewrite = answer;
		activateGrillTools();
		await publishState(pi, ctx, state);
		return buildGrillingSkillInvocation(
			[currentRound.request, state.decisionSummary].filter((value): value is string => Boolean(value)).join("\n\n"),
			nextRound.roundId,
			nextRound.snapshot.manifest,
		);
	};

	pi.registerTool?.({
		name: "forge_grill_evidence",
		label: "Forge Grill Evidence",
		description: "Read evidence from the active Forge Grill round.",
		parameters: Type.Object(
			{ candidateId: Type.String({ pattern: "^ev-[0-9a-f]{64}$" }) },
			{ additionalProperties: false },
			),
			async execute(_toolCallId: string, params: { candidateId: string }) {
				if (!hasActiveGrillAttempt()) {
					return { block: true };
				}
				const candidate = activeWorkflow?.snapshot.candidates[params.candidateId];
			if (!candidate) {
				throw new Error("GRILL_EVIDENCE_CANDIDATE_NOT_FOUND");
			}
			sessionState.recordEvidenceFetch(candidate.candidateId);
			return {
				content: [{ type: "text", text: candidate.content }],
				details: {
					candidateId: candidate.candidateId,
					kind: candidate.kind,
					metadata: candidate.metadata,
					source: candidate.source,
					title: candidate.title,
				},
			};
		},
	});
	pi.registerTool?.({
		name: "forge_grill_complete",
		label: "Forge Grill Complete",
		description: "Submit the structured result for the active Forge Grill round.",
			parameters: GrillCompletionSchema,
			async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, ctx: unknown) {
				if (!hasActiveGrillAttempt()) {
					return { block: true };
				}
				const round = sessionState.continueGrillRound();
				const completion = parseGrillCompletion(params, {
						expectedRoundId: round.roundId,
						fetchedEvidenceIds: sessionState.getFetchedEvidenceIds(),
						isFirstRoundOfSnapshot: sessionState.isFirstGrillRoundOfSnapshot(),
						snapshotManifest: round.snapshot.manifest,
					});
				if (completion.requiresUserConfirmation) {
					const waitUser = {
						...toWaitUserPayload(completion),
						decisionId: completion.questions[0]?.id,
					};
					await publishWaitUser(waitUser, ctx as CommandContext);
				} else {
					await continueDeepKnowledge(
						pi,
					ctx as CommandContext,
						sessionState,
						activeWorkflow,
						publishWaitUser,
						completion.recommendation.reason,
						completion,
					);
					if (sessionState.current().stage !== "GRILL") {
						restoreActiveTools();
					}
				}
				pendingGrillRun = sessionState.current().stage === "GRILL";
				suppressCompletionTurn = true;
			return {
				content: [{ type: "text", text: "Forge Grill completion accepted." }],
				details: { roundId: completion.roundId, status: completion.status },
			};
		},
	});

	pi.on?.("message_end", async (event: AssistantMessageEvent | UserMessageEvent, ctx?: CommandContext) => {
		if (pendingUserMessageRewrite && event.message?.role === "user") {
			const rewrittenText = pendingUserMessageRewrite;
			pendingUserMessageRewrite = undefined;
			return {
				message: {
					...event.message,
					content: [{ type: "text", text: rewrittenText }],
				},
			};
		}

		if (event.message?.role !== "assistant") {
			return;
		}
		if (suppressCompletionTurn) {
			suppressCompletionTurn = false;
			return {
				message: {
					...event.message,
					content: [{ type: "text", text: "" }],
				},
			};
		}
		if (!pendingGrillRun) {
			return;
		}

			if (event.message.content?.some((block) => block.type === "toolCall")) {
				return;
			}

				const firstOmission = sessionState.recordCompletionOmission();
					if (firstOmission) {
						await publishState(pi, ctx ?? {}, sessionState.current());
						await pi.sendMessage?.({
							content: "GRILL_COMPLETION_REQUIRED\n請輸入 /forge-runtime retry、/forge-runtime cancel，或 /forge-runtime switch <request>。",
							customType: "forge-grill-error",
							display: true,
						});
				}
				clearPendingState();
				restoreActiveTools();
		return {
			message: {
				...event.message,
				content: [{ type: "text", text: "" }],
			},
		};
	});

	pi.on?.("message_update", async (event: AssistantMessageEvent) => {
		if ((!pendingGrillRun && !suppressCompletionTurn) || event.message?.role !== "assistant") {
			return;
		}

		for (const content of event.message.content ?? []) {
			if (content.type === "text") {
				content.text = "";
			}
			if (content.type === "thinking") {
				content.thinking = "";
			}
		}
	});

		pi.on?.("tool_call", async (event: ToolCallEvent) => {
			if (grillToolNames.includes(event.toolName)) {
				return hasActiveGrillAttempt() ? undefined : { block: true };
			}
			if (!pendingGrillRun && sessionState.current().stage !== "WAIT_USER") {
				return;
			}
		return { block: true };
	});

	pi.on?.("input", async (event: { text?: unknown }, ctx?: CommandContext) => {
		if (!event || typeof event !== "object" || !("text" in event)) {
			return { action: "continue" as const };
		}

		let text = typeof event.text === "string" ? event.text.trim() : "";
		if (text === pendingReplayInvocation) {
			pendingReplayInvocation = undefined;
			return { action: "continue" as const };
		}
		if (text.startsWith("/grill-run ")) {
			text = text.slice("/grill-run ".length).trim();
		}
		const rootDir = ctx?.cwd ?? process.cwd();
		if (text.startsWith("/")) {
			return { action: "continue" as const };
		}

		if (pendingKnowledgeRequest) {
			if (!isApproval(text)) {
				ctx?.ui?.notify?.(
					`目前缺少 ${pendingKnowledgeRequest.missingAssets.join(" / ")}；若要在無完整參考基底下繼續，請明確回覆同意。`,
					"warn",
				);
				return { action: "handled" as const };
			}
			if (!requireGrillToolBoundary(ctx ?? {})) {
				return { action: "handled" as const };
			}

			const approvedRequest = pendingKnowledgeRequest.request;
			const approvedRootDir = pendingKnowledgeRequest.rootDir;
			pendingKnowledgeRequest = undefined;
			await publishState(pi, ctx ?? {}, sessionState.beginIntent(approvedRequest));
			await publishState(pi, ctx ?? {}, sessionState.beginLightDiscovery(approvedRequest));
			pendingGrillRun = true;
			pendingUserMessageRewrite = text;
			const lightDiscovery = await runLightDiscovery(approvedRootDir, extractDiscoverySeeds(approvedRequest));
			const round = sessionState.startGrillRound(approvedRequest, lightDiscovery.snapshot);
			activeWorkflow = {
				goal: approvedRequest,
				lightDiscovery,
				rootDir: approvedRootDir,
				seeds: extractDiscoverySeeds(approvedRequest),
				snapshot: round.snapshot,
			};
			activateGrillTools();
			await publishState(pi, ctx ?? {}, sessionState.beginGrill(approvedRequest));
			return {
				action: "transform" as const,
				text: buildGrillingSkillInvocation(
					[approvedRequest, lightDiscovery.summary].filter((value) => value.length > 0).join("\n\n"),
					round.roundId,
					lightDiscovery.snapshot.manifest,
				),
			};
		}

		const currentState = sessionState.current();
		const intent = understandIntent({
			hasSlashCommand: false,
			openWorkflowGoal: currentState.decisionSummary,
			openWorkflowStage: currentState.stage,
			recommendedOption: currentState.waitUser?.recommendation,
			resumeSelectionOptions: currentState.waitUser?.options,
			sessionState:
				currentState.stage === "WAIT_USER"
					? "wait_user"
					: currentState.stage === "RECEIVE"
						? "idle"
						: "open_workflow",
			userMessage: text,
		});

		if (intent.route === "resume_wait_user") {
			if (!requireGrillToolBoundary(ctx ?? {})) {
				return { action: "handled" as const };
			}
			const invocation = await resumeGrillWithAnswer(intent.resumeSelection ?? text, ctx ?? {});
			return invocation ? { action: "transform" as const, text: invocation } : { action: "handled" as const };
		}

		if (intent.route === "resume_open_workflow") {
			// ponytail: v1 先硬擋雙開；真的需要換題/排隊，再補 explicit switch 或 queue。
			ctx?.ui?.notify?.(
				"Forge 已有進行中的 workflow。請用 /forge-runtime continue、/forge-runtime cancel，或 /forge-runtime switch <request>。",
				"warn",
			);
			return { action: "handled" as const };
		}

		if (intent.route !== "start_forge") {
			return { action: "continue" as const };
		}
		if (!requireGrillToolBoundary(ctx ?? {})) {
			return { action: "handled" as const };
		}

		const knowledgeAssets = getKnowledgeAssetStatus(rootDir);
		if (knowledgeAssets.missingAssets.length > 0) {
			pendingKnowledgeRequest = {
				missingAssets: knowledgeAssets.missingAssets,
				request: intent.goal,
				rootDir,
			};
			ctx?.ui?.notify?.(
				`目前缺少 ${knowledgeAssets.missingAssets.join(" / ")}。若接受在沒有完整知識庫或代碼庫的情況下繼續，請明確回覆同意。`,
				"warn",
			);
			return { action: "handled" as const };
		}

		const conflict = detectCodeBaseConflict(rootDir, intent.lightDiscoverySeeds);
		if (conflict) {
			ctx?.ui?.notify?.(
				`Target Conflict\n偵測到 code_base 衝突：${conflict.relativePath}\ncode_base: ${conflict.codeBasePath}\ntarget: ${conflict.targetSourcePath}\n請先釐清後再繼續。`,
				"warn",
			);
			return { action: "handled" as const };
		}

		await publishState(pi, ctx ?? {}, sessionState.beginIntent(intent.goal));
		await publishState(pi, ctx ?? {}, sessionState.beginLightDiscovery(intent.goal));
		pendingGrillRun = true;
		pendingUserMessageRewrite = text;
		const lightDiscovery = await runLightDiscovery(rootDir, intent.lightDiscoverySeeds);
		const round = sessionState.startGrillRound(intent.goal, lightDiscovery.snapshot);
		activeWorkflow = {
			goal: intent.goal,
			lightDiscovery,
			rootDir,
			seeds: intent.lightDiscoverySeeds,
			snapshot: round.snapshot,
		};
		activateGrillTools();
		await publishState(pi, ctx ?? {}, sessionState.beginGrill(intent.goal));
		return {
			action: "transform" as const,
			text: buildGrillingSkillInvocation(
				[intent.goal, lightDiscovery.summary].filter((value) => value.length > 0).join("\n\n"),
				round.roundId,
				lightDiscovery.snapshot.manifest,
			),
		};
	});

	pi.registerCommand("forge-runtime", {
		description: "Drive the Forge workflow spike: grill ambiguous <json> | grill-result <json> | confirm | reject",
			handler: async (args, ctx) => {
				const command = args.trim();
				if (command.startsWith("grill ambiguous ")) {
					await publishWaitUser(parseWaitUserPayload(command.slice(16)), ctx);
					return;
				}

				if (command.startsWith("grill-result ")) {
					const grillResult = parseStructuredGrillResult(command.slice("grill-result ".length));
					if (!grillResult.requiresUserConfirmation) {
						await continueDeepKnowledge(
							pi,
							ctx,
							sessionState,
							activeWorkflow,
							publishWaitUser,
							grillResult.recommendation.reason,
							grillResult,
						);
						return;
					}
					await publishWaitUser(
						{
							...toWaitUserPayload(grillResult),
							decisionId: grillResult.questions[0]?.id,
						},
						ctx,
					);
					return;
				}

				if (command === "continue") {
					if (sessionState.current().validationRepair?.rootCause === "RECOVERY_REQUIRED") {
						ctx.ui?.notify?.("目前需要 recovery action；請使用 /forge-runtime retry、cancel 或 switch <request>。", "warn");
						await publishState(pi, ctx, sessionState.current());
						return;
					}
					if (!pi.sendUserMessage || !requireGrillToolBoundary(ctx)) {
					await publishState(pi, ctx, sessionState.current());
					return;
				}
				const round = sessionState.continueGrillRound();
				const invocation = buildGrillingSkillInvocation(
					[round.request, sessionState.current().decisionSummary]
						.filter((value): value is string => Boolean(value))
						.join("\n\n"),
					round.roundId,
					round.snapshot.manifest,
				);
				pendingReplayInvocation = invocation;
				pendingGrillRun = true;
				activateGrillTools();
				await pi.sendUserMessage?.(invocation, { deliverAs: "followUp" });
				await publishState(pi, ctx, sessionState.current());
					return;
				}

				if (command === "retry") {
					if (!pi.sendUserMessage || !requireGrillToolBoundary(ctx)) {
						await publishState(pi, ctx, sessionState.current());
						return;
					}
					const round = sessionState.retryGrillRound();
					if (!round) {
						ctx.ui?.notify?.("目前沒有可 retry 的 Grill recovery。", "warn");
						await publishState(pi, ctx, sessionState.current());
						return;
					}
					const invocation = buildGrillingSkillInvocation(
						[round.request, sessionState.current().decisionSummary]
							.filter((value): value is string => Boolean(value))
							.join("\n\n"),
						round.roundId,
						round.snapshot.manifest,
					);
					pendingReplayInvocation = invocation;
					pendingGrillRun = true;
					activateGrillTools();
					await pi.sendUserMessage(invocation, { deliverAs: "followUp" });
					await publishState(pi, ctx, sessionState.current());
					return;
				}

				if (command === "cancel") {
				activeWorkflow = undefined;
				clearPendingState();
				restoreActiveTools();
				await publishState(pi, ctx, sessionState.reset());
				return;
			}

			if (command.startsWith("switch ")) {
				const request = command.slice("switch ".length).trim();
				if (request.length === 0) {
					await publishState(pi, ctx, sessionState.current());
					return;
				}
				if (!ctx.newSession) {
					await publishState(pi, ctx, sessionState.current());
					return;
				}

				const result = await ctx.newSession({
					withSession: async (nextSession) => {
						await nextSession.sendUserMessage(request);
					},
				});
				if (result.cancelled) {
					await publishState(pi, ctx, sessionState.current());
					return;
				}
				activeWorkflow = undefined;
				clearPendingState();
				restoreActiveTools();
				sessionState.reset();
				return;
			}

			if (command === "confirm") {
				const state = sessionState.current();
				if (state.stage === "WAIT_USER" && state.waitUser) {
					if (await resumeWaitUserByFollowUp(pi, state.waitUser.recommendation)) {
						return;
					}
					await publishState(pi, ctx, state);
					return;
				}
				await confirmAndContinueDeepKnowledge(pi, ctx, sessionState, activeWorkflow, publishWaitUser);
				return;
			}

			if (command === "reject") {
				const state = sessionState.current();
				if (state.stage === "WAIT_USER" && state.waitUser) {
					if (await resumeWaitUserByFollowUp(pi, "reject")) {
						return;
					}
					await publishState(pi, ctx, state);
					return;
				}
				await publishState(pi, ctx, sessionState.reject());
				return;
			}

			if (command.startsWith("reject ")) {
				const answer = command.slice("reject ".length).trim();
				const state = sessionState.current();
				if (state.stage === "WAIT_USER" && state.waitUser) {
					if (await resumeWaitUserByFollowUp(pi, answer)) {
						return;
					}
					await publishState(pi, ctx, state);
					return;
				}
				await publishState(pi, ctx, sessionState.reject(answer));
				return;
			}

			await publishState(pi, ctx, sessionState.current());
		},
	});

}

function isApproval(text: string): boolean {
	return new Set(["好", "可以", "同意", "照做", "yes", "ok", "okay", "y"]).has(text.trim().toLowerCase());
}

function extractDiscoverySeeds(message: string): string[] {
	return message
		.split(/\s+/)
		.filter((token) => token.length >= 2)
		.slice(0, 8);
}

async function handleWaitUserState(
	pi: ForgeExtensionApi,
	ctx: CommandContext,
	state: ForgeUiState,
): Promise<void> {
	const RUNTIME_OWNED_INPUT_LABEL = "自行輸入…";
	await publishState(pi, ctx, state);

	if (!ctx.ui?.select || !state.waitUser) {
		return;
	}

	while (true) {
		const selection = await ctx.ui.select(state.waitUser.question, [
			...state.waitUser.options,
			RUNTIME_OWNED_INPUT_LABEL,
		]);
		if (selection === undefined) {
			return;
		}
		if (selection === RUNTIME_OWNED_INPUT_LABEL) {
			if (!ctx.ui.custom) {
				return;
			}
			const answer = await ctx.ui.custom(async (tui, hostTheme, _keybindings, done) => {
				const { Editor, Key, matchesKey } = await import("@earendil-works/pi-tui");
				const editorTheme: ForgeEditorTheme = {
					borderColor: (text) => hostTheme.fg("borderMuted", text),
					selectList: {
						selectedPrefix: (text) => hostTheme.fg("accent", text),
						selectedText: (text) => hostTheme.fg("accent", text),
						description: (text) => hostTheme.fg("muted", text),
						scrollInfo: (text) => hostTheme.fg("muted", text),
						noMatch: (text) => hostTheme.fg("muted", text),
					},
				};
				const editor = new Editor(tui, editorTheme);
				editor.onSubmit = (value) => {
					const trimmed = value.trim();
					if (trimmed.length > 0) done(trimmed);
				};
				const handleInput = editor.handleInput.bind(editor);
				editor.handleInput = (data) => {
					if (matchesKey(data, Key.escape)) {
						done(undefined);
						return;
					}
					handleInput(data);
				};
				return editor;
			});
			if (answer === undefined) {
				continue;
			}
			const trimmed = answer.trim();
			if (trimmed.length === 0) {
				continue;
			}
			await resumeWaitUserByFollowUp(pi, trimmed);
			return;
		}
		await resumeWaitUserByFollowUp(pi, selection);
		return;
	}
}

async function resumeWaitUserByFollowUp(pi: ForgeExtensionApi, answer: string): Promise<boolean> {
	if (!pi.sendUserMessage) {
		return false;
	}
	await pi.sendUserMessage(answer, { deliverAs: "followUp" });
	return true;
}

async function confirmAndContinueDeepKnowledge(
	pi: ForgeExtensionApi,
	ctx: CommandContext,
	sessionState: ReturnType<typeof createForgeSessionState>,
	activeWorkflow: ActiveWorkflowContext | undefined,
	publishWaitUser: (payload: WaitUserPayload, ctx: CommandContext) => Promise<void>,
): Promise<ForgeUiState> {
	const beforeConfirm = sessionState.current();
	const nextState = sessionState.confirm();
	await publishState(pi, ctx, nextState);

	if (beforeConfirm.stage !== "WAIT_USER" || !beforeConfirm.waitUser || nextState.stage !== "USER_CONFIRMED") {
		return nextState;
	}

	await continueDeepKnowledge(pi, ctx, sessionState, activeWorkflow, publishWaitUser, beforeConfirm.decisionSummary);
	return nextState;
}

async function continueDeepKnowledge(
	pi: ForgeExtensionApi,
	ctx: CommandContext,
	sessionState: ReturnType<typeof createForgeSessionState>,
	activeWorkflow: ActiveWorkflowContext | undefined,
	publishWaitUser: (payload: WaitUserPayload, ctx: CommandContext) => Promise<void>,
	decisionSummary?: string,
	grillResult?: StructuredGrillResult,
): Promise<void> {
	const workflow = activeWorkflow;
	const candidates = workflow?.lightDiscovery.codeBaseCandidates ?? [];
	const relevance = evaluateCandidateRelevance(candidates);
	if (workflow && relevance.decision !== "proceed_deep") {
		const round = sessionState.continueGrillRound();
		const evidenceIds = [...sessionState.getFetchedEvidenceIds()];
		const waitUserPayload = {
				decisionId: round.roundId,
				decisionSummary: relevance.reason,
				evidenceIds,
				options: ["補充可信來源", "縮小需求範圍"],
				question: `${relevance.reason}\n請選擇補充可信來源或縮小需求範圍。`,
				recommendation: "縮小需求範圍",
		};
		await publishWaitUser(waitUserPayload, ctx);
		return;
	}

	await publishState(pi, ctx, sessionState.beginDeepKnowledge(decisionSummary));
	const evidence = workflow
		? await buildDeepKnowledgeEvidence(workflow.rootDir, workflow.seeds, relevance.candidates)
		: (grillResult?.evidence ?? []).map((evidenceId) => ({ evidenceId, source: evidenceId, summary: evidenceId, title: evidenceId }));
	const deepSummary =
		evidence.length > 0
			? `Deep knowledge loaded from ${evidence.length} sources: ${evidence.map((item) => item.title).join(", ")}`
			: "Deep knowledge found no additional sources.";
	await publishState(
		pi,
		ctx,
		sessionState.completeDeepKnowledge(
			evidence.map((item) => item.evidenceId),
			deepSummary,
		),
	);
}

async function buildDeepKnowledgeEvidence(
	rootDir: string,
	seeds: string[],
	candidates: CodeBaseCandidate[],
): Promise<Array<{ evidenceId: string; source: string; summary: string; title: string }>> {
	const wikiDocuments = loadWikiDiscoverySources(rootDir)
		.filter((source) => seeds.some((seed) => source.content.toLowerCase().includes(seed.toLowerCase())))
		.slice(0, 3)
		.map((source) => ({
			content: source.content,
			source: source.path,
			summary: summarize(source.content),
			title: basename(source.path),
		}));
	const codeBaseDocuments = candidates.slice(0, 2).map((candidate) => ({
		content: candidate.content,
		source: `code_base/${candidate.relativePath}`,
		summary: summarize(candidate.content),
		title: candidate.relativePath,
	}));
	const targetDocuments = candidates.slice(0, 1).flatMap((candidate) => {
		const targetPath = resolve(rootDir, candidate.relativePath);
		if (!existsSync(targetPath)) {
			return [];
		}
		const content = readFileSync(targetPath, "utf8");
		return [
			{
				content,
				source: targetPath,
				summary: summarize(content),
				title: basename(targetPath),
			},
		];
	});
	const documents = [...wikiDocuments, ...codeBaseDocuments, ...targetDocuments];
	if (documents.length === 0) {
		return [];
	}

	return (await discoverEvidence({ documents, mode: "deep" })) as Array<{
		content: string;
		evidenceId: string;
		source: string;
		summary: string;
		title: string;
	}>;
}

function summarize(content: string): string {
	return content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"))
		.slice(0, 2)
		.join(" ")
		.slice(0, 220);
}

function parseWaitUserPayload(raw: string): WaitUserPayload {
	const parsed = JSON.parse(raw) as Partial<WaitUserPayload>;
	if (typeof parsed.question !== "string" || parsed.question.length === 0) {
		throw new Error("wait user payload requires question");
	}
	if (typeof parsed.recommendation !== "string" || parsed.recommendation.length === 0) {
		throw new Error("wait user payload requires recommendation");
	}
	if (!Array.isArray(parsed.options) || parsed.options.some((option) => typeof option !== "string" || option.length === 0)) {
		throw new Error("wait user payload requires string options");
	}
	if (
		!Array.isArray(parsed.evidenceIds) ||
		parsed.evidenceIds.some((evidenceId) => typeof evidenceId !== "string" || evidenceId.length === 0)
	) {
		throw new Error("wait user payload requires string evidenceIds");
	}

	return {
		decisionId: typeof parsed.decisionId === "string" ? parsed.decisionId : undefined,
		decisionSummary: typeof parsed.decisionSummary === "string" ? parsed.decisionSummary : undefined,
		evidenceIds: parsed.evidenceIds,
		options: parsed.options,
		question: parsed.question,
		recommendation: parsed.recommendation,
	};
}

async function publishState(pi: ForgeExtensionApi, ctx: CommandContext, state: ForgeUiState): Promise<void> {
	const status = buildWorkflowStatusText(state);
	const sections = [
		buildWaitUserPanel(state),
		state.stage === "WAIT_USER" ? buildEvidenceSummaryText({ ...state, lastEvidenceIds: [] }) : buildEvidenceSummaryText(state),
		buildValidationRepairText(state),
	].filter(
		(value): value is string => Boolean(value),
	);
	const panelText = [status, ...sections].join("\n\n");
	ctx.ui?.setStatus?.(status);
	await pi.sendMessage?.({ content: panelText, customType: "forge-stage", display: true });
}
