import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import Type from "typebox";
import { buildGrillingSkillInvocation } from "../src/grill/grill-skill.ts";
import {
	GrillCompletionSchema,
	type StructuredGrillResult,
	parseGrillCompletion,
	toWaitUserPayload,
} from "../src/grill/grill-result.ts";
import {
	type CodeBaseCandidate,
	evaluateCandidateRelevance,
	findCodeBaseCandidates,
	getKnowledgeAssetStatus,
	loadWikiDiscoverySources,
	readEvidenceSource,
} from "../src/discovery/discovery-sources.ts";
import { runLightDiscovery, type LightDiscoveryMatch, type LightDiscoveryResult } from "../src/discovery/light-discovery.ts";
import { understandIntent } from "../src/intent/intent-understanding.ts";
import type { IntentModelContext } from "../src/intent/intent-types.ts";
import { buildEvidenceSummaryText } from "../src/ui/evidence-summary-widget.ts";
import {
			createForgeSessionState,
			type DeepAttemptIdentity,
			DEEP_EVIDENCE_MAX_BYTES,
			DEEP_EVIDENCE_ROUND_MAX_BYTES,
			DEEP_SEARCH_MAX_PER_SOURCE_ROUND,
		DEEP_SEARCH_MAX_QUERY_CODE_POINTS,
			getDeepEvidenceContentBytes,
	type GrillEvidenceCandidate,
	type GrillEvidenceSnapshot,
	type WaitUserPayload,
	waitUserDecisionKey,
} from "../src/runtime/session-state.ts";
import {
	createEvidencePackage,
	validateEvidencePackage,
	type EvidenceDecision,
	type EvidenceInput,
	type EvidenceFinding,
	type EvidenceLimitation,
} from "../src/evidence/evidence-engine.ts";
import type { ForgeUiState } from "../src/ui/ui-state.ts";
import { buildValidationRepairText } from "../src/ui/validation-repair-widget.ts";
import { buildWaitUserPanel } from "../src/ui/wait-user-panel.ts";
import { buildWorkflowStatusText } from "../src/ui/workflow-status-widget.ts";

const DEEP_RESULT_GUIDANCE = [
	"needs_decision 僅用於需要人類選擇。",
	"needs_discovery 僅用於來源或證據不足。",
	"正式 route 只依 kind；不得用 decisionSummary 自由文字判斷 route。",
].join("\n");

function isEvidenceTooLargeRejection(
	value: unknown,
): value is { readonly reason: "evidence_too_large"; readonly byteSize: number; readonly limit: number } {
	if (typeof value !== "object" || value === null) return false;
	return (
		"reason" in value &&
		value.reason === "evidence_too_large" &&
		"byteSize" in value &&
		typeof value.byteSize === "number" &&
		"limit" in value &&
		typeof value.limit === "number"
	);
}

interface CommandContext extends IntentModelContext {
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
	id?: string;
	name?: string;
}

interface DeepRetrievalBatch {
	identity: DeepAttemptIdentity;
	searchCallIds: ReadonlySet<string>;
	completionCallIds: ReadonlySet<string>;
	settledSearchCallIds: Set<string>;
	mixed: boolean;
	followUpQueued: boolean;
}

interface PendingDiscoveryRestart {
	toolCallId: string;
	toolName: string;
	identity: DeepAttemptIdentity;
}

interface PendingSettledDeepInvocation {
	activeWorkflow: ActiveWorkflowContext;
	invocation: string;
	identity: DeepAttemptIdentity;
}

interface AssistantMessageEvent {
	message?: {
		content?: Array<AssistantTextBlock | AssistantThinkingBlock | AssistantToolCallBlock>;
		role?: string;
		toolCallId?: string;
		toolName?: string;
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

interface ToolResultEvent {
	toolCallId: string;
	toolName: string;
	content: unknown[];
	isError: boolean;
}

interface InputEvent {
	text?: unknown;
}

type ForgeEventHandler<TEvent> = {
	bivarianceHack(event: TEvent, ctx?: CommandContext): Promise<unknown> | unknown;
}["bivarianceHack"];

	interface ForgeExtensionApi {
		on?(eventName: "tool_call", handler: ForgeEventHandler<ToolCallEvent>): void;
		on?(eventName: "tool_result", handler: ForgeEventHandler<ToolResultEvent>): void;
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
	sendMessage?(
		message: ExtensionMessage,
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" | "displayOnly" },
	): Promise<void> | void;
	sendUserMessage?(content: string, options?: { deliverAs?: "steer" | "followUp" }): Promise<void> | void;
}

interface ActiveWorkflowContext {
	goal: string;
	lightDiscovery: GrillCompatibleDiscovery;
	rootDir: string;
	seeds: string[];
	snapshot: GrillEvidenceSnapshot;
}

interface GrillCompatibleDiscovery {
	codeBaseCandidates: CodeBaseCandidate[];
	snapshot: GrillEvidenceSnapshot;
	summary: string;
}

export default function forgeRuntimeExtension(pi: ForgeExtensionApi): void {
	const sessionState = createForgeSessionState();
	const grillToolNames = ["forge_grill_evidence", "forge_grill_complete"];
	const deepRetrievalToolNames = ["forge_deep_search", "forge_deep_retrieval_complete"];
	const deepUnderstandingToolNames = ["forge_deep_complete"];
	let pendingGrillRun = false;
	let pendingKnowledgeRequest: { missingAssets: string[]; request: string; rootDir: string } | undefined;
	let activeWorkflow: ActiveWorkflowContext | undefined;
	let savedActiveTools: string[] | undefined;
	let pendingReplayInvocation: string | undefined;
	let pendingSettledDeepInvocation: PendingSettledDeepInvocation | undefined;
	let pendingSettledDeepInvocationTimer: ReturnType<typeof setTimeout> | undefined;
		let pendingDiscoveryRestart: PendingDiscoveryRestart | undefined;
		const fetchedGrillEvidence = new Map<string, EvidenceInput>();
		const fetchedDeepSupplementalEvidence = new Map<string, EvidenceInput>();
		const acceptedNeedsDiscoverySourceRoundIds: string[] = [];
		let fallbackHumanDecisionId: string | undefined;
		let fallbackHumanPremise: EvidenceInput | undefined;
		const rememberFetchedEvidence = (store: Map<string, EvidenceInput>, evidence: EvidenceInput): void => {
			const existing = store.get(evidence.evidenceId);
			if (existing) {
				if (existing.content !== evidence.content) throw new Error("evidence_id_content_conflict");
				return;
			}
			store.set(evidence.evidenceId, { ...evidence, metadata: { ...evidence.metadata } });
		};
		let activeWaitUserUiLeaseKey: string | undefined;
		let deepRetrievalBatch: DeepRetrievalBatch | undefined;
		const canEnforceToolBoundary = () =>
			typeof pi.registerTool === "function" &&
			typeof pi.getActiveTools === "function" &&
			typeof pi.setActiveTools === "function" &&
			typeof pi.on === "function";
		const requireGrillToolBoundary = (ctx: CommandContext) => {
			if (canEnforceToolBoundary()) {
				return true;
			}
			ctx.ui?.notify?.("Forge 無法安全限制 Grill 工具面，已拒絕啟動或重播 Grill。", "warn");
			return false;
		};
		const requireDeepToolBoundary = (ctx: CommandContext) => {
			if (canEnforceToolBoundary() && typeof pi.sendUserMessage === "function") {
				return true;
			}
			ctx.ui?.notify?.("Forge 無法安全限制 Deep 工具面，已拒絕進入 Deep。", "warn");
			return false;
		};

	const activateGrillTools = () => {
		savedActiveTools ??= pi.getActiveTools?.();
		pi.setActiveTools?.(grillToolNames);
	};
	const activateDeepRetrievalTools = () => {
		savedActiveTools ??= pi.getActiveTools?.();
		pendingGrillRun = false;
		pi.setActiveTools?.(deepRetrievalToolNames);
	};
	const activateDeepUnderstandingTools = () => {
		pi.setActiveTools?.(deepUnderstandingToolNames);
	};
	const restoreActiveTools = () => {
		if (!savedActiveTools) {
			return;
		}
		pi.setActiveTools?.(savedActiveTools);
		savedActiveTools = undefined;
	};
	const releaseGrillBoundary = () => {
		pendingGrillRun = false;
		restoreActiveTools();
	};
		const clearPendingState = () => {
			pendingGrillRun = false;
			pendingKnowledgeRequest = undefined;
			pendingReplayInvocation = undefined;
			pendingSettledDeepInvocation = undefined;
			if (pendingSettledDeepInvocationTimer) {
				clearTimeout(pendingSettledDeepInvocationTimer);
				pendingSettledDeepInvocationTimer = undefined;
			}
			pendingDiscoveryRestart = undefined;
			activeWaitUserUiLeaseKey = undefined;
		};
		const clearFallbackWorkflowState = () => {
			fetchedGrillEvidence.clear();
			fetchedDeepSupplementalEvidence.clear();
			acceptedNeedsDiscoverySourceRoundIds.length = 0;
			fallbackHumanPremise = undefined;
			fallbackHumanDecisionId = undefined;
		};
		const publishWaitUser = async (
			payload: WaitUserPayload,
		ctx: CommandContext,
		options?: { deliverAs?: "displayOnly" },
	): Promise<void> => {
		const decisionKey = waitUserDecisionKey(payload);
		const currentState = sessionState.current();
			if (currentState.stage === "WAIT_USER" && currentState.waitUser) {
			if (decisionKey !== waitUserDecisionKey(currentState.waitUser)) {
				return;
			}
			if (activeWaitUserUiLeaseKey === decisionKey) {
				return;
			}
			activeWaitUserUiLeaseKey = decisionKey;
			try {
				await handleWaitUserState(pi, ctx, currentState, options, resumeWaitUserAnswer);
			} finally {
				if (activeWaitUserUiLeaseKey === decisionKey) {
					activeWaitUserUiLeaseKey = undefined;
				}
			}
			return;
		}
		activeWaitUserUiLeaseKey = decisionKey;
		try {
			await handleWaitUserState(pi, ctx, sessionState.requireWaitUser(payload), options, resumeWaitUserAnswer);
		} finally {
			if (activeWaitUserUiLeaseKey === decisionKey) {
				activeWaitUserUiLeaseKey = undefined;
			}
		}
		};
	const hasUnknownEvidenceIds = (ids: readonly string[], known: ReadonlySet<string>) =>
		ids.some((evidenceId) => !known.has(evidenceId));
		const isCurrentDeepAttempt = (identity: DeepAttemptIdentity) => {
			const attempt = sessionState.currentDeepAttempt();
			return Boolean(
				attempt &&
				attempt.attemptId === identity.attemptId &&
				attempt.sourceRoundId === identity.sourceRoundId &&
				attempt.phase === identity.phase,
			);
		};
		const hasActiveDeepAttempt = () => {
			const stage = sessionState.current().stage;
			return Boolean(
				sessionState.currentDeepAttempt() &&
				(stage === "DEEP_KNOWLEDGE_RETRIEVAL" || stage === "KNOWLEDGE_UNDERSTANDING"),
			);
		};
		const hasActiveGrillAttempt = () => pendingGrillRun && sessionState.current().stage === "GRILL";
	const parseActiveGrillCompletion = (payload: unknown) => {
		const round = sessionState.continueGrillRound();
		return parseGrillCompletion(payload, {
			expectedRoundId: round.roundId,
			fetchedEvidenceIds: sessionState.getFetchedEvidenceIds(),
			isFirstRoundOfSnapshot: sessionState.isFirstGrillRoundOfSnapshot(),
			snapshotManifest: round.snapshot.manifest,
		});
	};
	const resumeGrillWithAnswer = async (answer: string, ctx: CommandContext): Promise<string | undefined> => {
		const currentRound = sessionState.continueGrillRound();
		const state = sessionState.recordAnswer(answer);
		if (state.stage === "USER_CONFIRMED") {
			activeWaitUserUiLeaseKey = undefined;
			const workflow = activeWorkflow;
			if (!workflow) {
				await publishState(pi, ctx, state);
				return undefined;
			}
			pendingGrillRun = false;
			restoreActiveTools();
			const clarifiedRequest = [currentRound.request, answer].join("\n\n");
			await publishState(pi, ctx, sessionState.beginLightDiscovery(clarifiedRequest));
			const discovery = runLightDiscovery(workflow.rootDir, clarifiedRequest);
			const lightDiscovery = buildGrillCompatibleDiscovery(workflow.rootDir, discovery, clarifiedRequest);
			const nextRound = sessionState.startGrillRound(clarifiedRequest, lightDiscovery.snapshot);
			activeWorkflow = {
				...workflow,
				goal: clarifiedRequest,
				lightDiscovery,
				seeds: extractDeepDiscoverySeeds(clarifiedRequest),
				snapshot: nextRound.snapshot,
			};
			pendingGrillRun = true;
			activateGrillTools();
			await publishState(pi, ctx, sessionState.beginGrill(clarifiedRequest));
			return buildGrillingSkillInvocation(
				[clarifiedRequest, lightDiscovery.summary].join("\n\n"),
				nextRound.roundId,
				nextRound.snapshot.manifest,
			);
		}
		if (state.stage !== "GRILL") {
			await publishState(pi, ctx, state);
			return undefined;
		}
		const nextRound = sessionState.startGrillRound(currentRound.request, currentRound.snapshot);
		pendingGrillRun = true;
		activateGrillTools();
		await publishState(pi, ctx, state);
		return buildGrillingSkillInvocation(
			[currentRound.request, state.decisionSummary].filter((value): value is string => Boolean(value)).join("\n\n"),
			nextRound.roundId,
			nextRound.snapshot.manifest,
		);
	};
		const prepareDeepKnowledgeAnswer = (
			answer: string,
		):
			| { kind: "not_deep" }
				| { kind: "handled"; state: ForgeUiState; invocation?: string } => {
				const current = sessionState.current();
				const waitUserKind = current.waitUser?.kind;
				if (current.stage !== "WAIT_USER" || (waitUserKind !== "deep_decision" && waitUserKind !== "deep_discovery_fallback")) {
					return { kind: "not_deep" };
				}
				const answeredState = sessionState.recordAnswer(answer);
					if (answeredState.stage === "WAIT_USER") {
						return { kind: "handled", state: answeredState };
					}
					if (waitUserKind === "deep_discovery_fallback") {
						const workflow = activeWorkflow;
						if (!workflow) {
							return { kind: "handled", state: answeredState };
						}
						fallbackHumanDecisionId = current.waitUser?.decisionId;
						const sourceRoundIds = [...acceptedNeedsDiscoverySourceRoundIds];
						const evidenceId = `human-premise-${createHash("sha256")
							.update([workflow.goal, current.waitUser?.question ?? "", answer, ...sourceRoundIds].join("\u0000"))
							.digest("hex")}`;
						fallbackHumanPremise = {
							evidenceId,
							kind: "human_premise",
							source: "forge://human-premise",
							title: "使用者前提",
							content: [`目標：${workflow.goal}`, `問題：${current.waitUser?.question ?? ""}`, `回答：${answer}`].join("\n"),
							metadata: {
								needsDiscoveryCount: sourceRoundIds.length,
								sourceRoundIds,
							},
						};
					}
					if (!pi.sendUserMessage) {
						return { kind: "handled", state: answeredState };
					}
					if (waitUserKind === "deep_discovery_fallback") {
					const nextState = sessionState.beginDeepKnowledge(answeredState.decisionSummary, "KNOWLEDGE_UNDERSTANDING");
					const nextAttempt = sessionState.currentDeepAttempt();
					if (!nextAttempt) {
						return { kind: "handled", state: nextState };
					}
					activateDeepUnderstandingTools();
					const invocation = `請依使用者決定 ${JSON.stringify(answer)} 繼續 Forge Deep ${nextAttempt.phase}。attemptId=${nextAttempt.attemptId} sourceRoundId=${nextAttempt.sourceRoundId} phase=${nextAttempt.phase}`;
					return { kind: "handled", state: nextState, invocation };
				}
				const retryState = sessionState.retryDeepKnowledge(answeredState.decisionSummary);
			const retryAttempt = sessionState.currentDeepAttempt();
			if (!retryAttempt) {
				return { kind: "handled", state: retryState };
			}
			if (retryAttempt.phase === "DEEP_KNOWLEDGE_RETRIEVAL") activateDeepRetrievalTools();
			else activateDeepUnderstandingTools();
			const invocation = `請依使用者決定 ${JSON.stringify(answer)} 繼續 Forge Deep ${retryAttempt.phase}。attemptId=${retryAttempt.attemptId} sourceRoundId=${retryAttempt.sourceRoundId} phase=${retryAttempt.phase}`;
			return { kind: "handled", state: retryState, invocation };
		};
		const resumeWaitUserAnswer = async (answer: string, ctx: CommandContext): Promise<boolean> => {
			const current = sessionState.current();
				if (
					current.stage === "WAIT_USER" &&
					(current.waitUser?.kind === "deep_decision" || current.waitUser?.kind === "deep_discovery_fallback") &&
					!requireDeepToolBoundary(ctx)
				) {
				return true;
			}
			const deepAnswer = prepareDeepKnowledgeAnswer(answer);
			if (deepAnswer.kind === "handled") {
				await publishState(pi, ctx, deepAnswer.state);
				if (deepAnswer.invocation) {
					pendingReplayInvocation = deepAnswer.invocation;
					await pi.sendUserMessage?.(deepAnswer.invocation, { deliverAs: "followUp" });
				}
				return true;
			}
			if (!pi.sendUserMessage) {
				return false;
			}
			const invocation = await resumeGrillWithAnswer(answer, ctx);
			if (invocation) {
				pendingReplayInvocation = invocation;
				await pi.sendUserMessage(invocation, { deliverAs: "followUp" });
			}
			return true;
		};
		const restartLightDiscoveryAndGrill = async (workflow: ActiveWorkflowContext, ctx: CommandContext): Promise<string> => {
			await publishState(pi, ctx, sessionState.beginLightDiscovery(workflow.goal));
			const discovery = runLightDiscovery(workflow.rootDir, workflow.goal);
			const lightDiscovery = buildGrillCompatibleDiscovery(workflow.rootDir, discovery, workflow.goal);
			const round = sessionState.startGrillRound(workflow.goal, lightDiscovery.snapshot);
			activeWorkflow = { ...workflow, lightDiscovery, seeds: extractDeepDiscoverySeeds(workflow.goal), snapshot: round.snapshot };
			pendingGrillRun = true;
			activateGrillTools();
			await publishState(pi, ctx, sessionState.beginGrill(workflow.goal));
			return buildGrillingSkillInvocation(
				[workflow.goal, lightDiscovery.summary].filter((value) => value.length > 0).join("\n\n"),
				round.roundId,
				round.snapshot.manifest,
			);
		};
			const queueDiscoveryRestart = (toolCallId: string, toolName: string, identity: DeepAttemptIdentity, state: ForgeUiState) => {
					if (state.stage === "LIGHT_DISCOVERY") {
						pendingDiscoveryRestart = { toolCallId, toolName, identity };
					}
				};
			const recordAcceptedNeedsDiscovery = (
				completion: ReturnType<typeof sessionState.handleDeepResult>,
				outcome: { kind: string },
			) => {
				if (completion.kind === "accepted" && outcome.kind === "needs_discovery") {
					acceptedNeedsDiscoverySourceRoundIds.push(completion.identity.sourceRoundId);
				}
			};

	pi.registerTool?.({
		name: "forge_grill_evidence",
			label: "Forge Grill 證據",
			description: "讀取目前 Forge Grill 回合的證據。",
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
			if (candidate.metadata.rejection?.reason === "evidence_too_large") {
				return {
					content: [{ type: "text", text: `Grill 證據過大，單筆上限為 ${DEEP_EVIDENCE_MAX_BYTES} bytes，已拒絕讀取。` }],
					details: {
						status: "rejected",
						reason: "evidence_too_large",
						byteSize: candidate.metadata.rejection.byteSize,
						limit: candidate.metadata.rejection.limit,
						evidence: [],
					},
				};
			}
				if (Buffer.byteLength(candidate.content, "utf8") > DEEP_EVIDENCE_MAX_BYTES) {
					return {
					content: [{ type: "text", text: `Grill 證據過大，單筆上限為 ${DEEP_EVIDENCE_MAX_BYTES} bytes，已拒絕讀取。` }],
					details: {
						status: "rejected",
						reason: "evidence_too_large",
						limit: DEEP_EVIDENCE_MAX_BYTES,
						evidence: [],
					},
					};
				}
				const fetchedCandidates = [...sessionState.getFetchedEvidenceIds()]
					.map((evidenceId) => activeWorkflow?.snapshot.candidates[evidenceId])
					.filter((fetched): fetched is GrillEvidenceCandidate => Boolean(fetched));
					const roundEvidenceBytes = getDeepEvidenceContentBytes(
						[...fetchedCandidates, candidate].map((evidence) => ({
							content: evidence.content,
							evidenceId: evidence.candidateId,
							source: evidence.source,
						})),
					);
				if (roundEvidenceBytes > DEEP_EVIDENCE_ROUND_MAX_BYTES) {
					return {
						content: [
							{
								type: "text",
								text: `Deep Search 本輪證據總量超過 ${DEEP_EVIDENCE_ROUND_MAX_BYTES} bytes，已拒絕這次搜尋。`,
							},
						],
						details: {
							status: "rejected",
							reason: "evidence_round_too_large",
							limit: DEEP_EVIDENCE_ROUND_MAX_BYTES,
							evidence: [],
						},
					};
					}
					sessionState.recordEvidenceFetch(candidate.candidateId);
					rememberFetchedEvidence(fetchedGrillEvidence, {
						content: candidate.content,
						evidenceId: candidate.candidateId,
						kind: candidate.kind,
						metadata: candidate.metadata,
						source: candidate.source,
						title: candidate.title,
					});
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
			label: "Forge Grill 完成",
			description: "提交目前 Forge Grill 回合的結構化結果。",
			parameters: GrillCompletionSchema,
			async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, ctx: unknown) {
				if (!hasActiveGrillAttempt()) {
					return { block: true };
				}
				const completion = parseActiveGrillCompletion(params);
				let deepInvocation: string | undefined;
					if (completion.requiresUserConfirmation) {
						const waitUser = toWaitUserPayload(completion);
							void publishWaitUser(waitUser, ctx as CommandContext, { deliverAs: "displayOnly" }).catch((error: unknown) => {
						(ctx as CommandContext).ui?.notify?.(
							`Forge WAIT_USER UI 失敗：${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
					});
				} else {
					const enteredDeep = await continueDeepKnowledge(
						pi,
						ctx as CommandContext,
						sessionState,
							activeWorkflow,
							publishWaitUser,
							requireDeepToolBoundary,
							(invocation) => {
								pendingReplayInvocation = invocation;
							},
							completion.recommendation.reason,
							completion,
							activateDeepRetrievalTools,
							"settled",
					);
					if (!enteredDeep.entered) {
						return {
							content: [{ type: "text", text: "Forge 無法安全限制 Deep 工具面，已拒絕進入 Deep。" }],
							details: { status: "rejected", reason: "deep_tool_boundary_unavailable" },
						};
					}
					deepInvocation = enteredDeep.invocation;
					const deepIdentity = sessionState.currentDeepAttempt();
					if (!activeWorkflow || !deepInvocation || !deepIdentity) {
						return {
							content: [{ type: "text", text: "Forge 無法安全準備 Deep 交接，已拒絕進入 Deep。" }],
							details: { status: "rejected", reason: "deep_settled_invocation_unavailable" },
						};
					}
					pendingSettledDeepInvocation = {
						activeWorkflow,
						invocation: deepInvocation,
						identity: deepIdentity,
					};
				}
				pendingGrillRun = ["GRILL", "WAIT_USER"].includes(sessionState.current().stage);
				return {
					content: [{ type: "text", text: "Forge Grill 完成結果已接受。" }],
					details: { roundId: completion.roundId, status: completion.status },
					terminate: true,
				};
		},
	});

	pi.registerTool?.({
		name: "forge_deep_search",
			label: "Forge Deep 搜尋",
			description: "在目前的 Deep Retrieval 嘗試中搜尋允許的知識來源。",
			parameters: Type.Union([
				Type.Object(
					{
						attemptId: Type.String(),
						sourceRoundId: Type.String(),
						phase: Type.Literal("DEEP_KNOWLEDGE_RETRIEVAL"),
						query: Type.String({ minLength: 1 }),
						source: Type.Union([Type.Literal("wiki"), Type.Literal("code_base")]),
					},
					{ additionalProperties: false },
				),
				Type.Object(
					{
						attemptId: Type.String(),
						sourceRoundId: Type.String(),
						phase: Type.Literal("DEEP_KNOWLEDGE_RETRIEVAL"),
						query: Type.String({ minLength: 1 }),
						source: Type.Literal("target"),
						targetSource: Type.String({ minLength: 1 }),
					},
					{ additionalProperties: false },
				),
			]),
		async execute(
			_toolCallId: string,
			params: {
				attemptId: string;
				sourceRoundId: string;
				phase: "DEEP_KNOWLEDGE_RETRIEVAL";
				query: string;
				source: "wiki" | "code_base" | "target";
				targetSource?: string;
			},
			_signal: unknown,
			_onUpdate: unknown,
			ctx: unknown,
		) {
			const identity = {
				attemptId: params.attemptId,
				sourceRoundId: params.sourceRoundId,
				phase: params.phase,
			} as const;
			const attempt = sessionState.currentDeepAttempt();
			if (
				!attempt ||
				attempt.attemptId !== identity.attemptId ||
				attempt.sourceRoundId !== identity.sourceRoundId ||
				attempt.phase !== identity.phase
			) {
				return {
					content: [{ type: "text", text: "過期的 Deep Retrieval 嘗試已忽略。" }],
					details: { status: "stale", evidence: [] },
					terminate: true,
				};
			}
			if (!activeWorkflow) {
				return { block: true };
			}
				const workflow = activeWorkflow;

				const trimmedQuery = params.query.trim();
				if (trimmedQuery.length === 0) {
					return {
							content: [{ type: "text", text: "Deep Search 查詢不得為空白。" }],
							details: { status: "invalid", errors: ["Deep Search 查詢不得為空白。"] },
							terminate: true,
					};
				}
				if (Array.from(trimmedQuery).length > DEEP_SEARCH_MAX_QUERY_CODE_POINTS) {
					return {
							content: [{ type: "text", text: `Deep Search 查詢最多 ${DEEP_SEARCH_MAX_QUERY_CODE_POINTS} 個字元。` }],
						details: { status: "rejected", reason: "query_too_long", limit: DEEP_SEARCH_MAX_QUERY_CODE_POINTS },
						terminate: true,
					};
				}
				const query = trimmedQuery.toLowerCase();
			let selectedTarget: GrillEvidenceCandidate | undefined;
			if (params.source === "target") {
				if (!params.targetSource?.trim()) {
					return {
						content: [{ type: "text", text: "Target source 不得為空白。" }],
						details: { status: "invalid", retryable: true, reason: "target_source_required" },
						terminate: true,
					};
				}
				if (!Object.values(workflow.snapshot.candidates).some((candidate) => candidate.kind === "target")) {
					return {
						content: [{ type: "text", text: "Target manifest 為空，請改用 wiki 或 code_base。" }],
						details: { status: "invalid", retryable: true, reason: "target_manifest_empty" },
						terminate: true,
					};
				}
				const targetCandidates = Object.values(workflow.snapshot.candidates).filter(
					(candidate) =>
						candidate.kind === "target" &&
						`${candidate.source}\n${candidate.content}`.toLowerCase().includes(query),
				);
				const options = [
					...new Set(
						targetCandidates.map(
							(candidate) => candidate.metadata.relativePath ?? candidate.source.replace(/^target\//, ""),
						),
					),
				].sort();
				const matchingTargets = params.targetSource
					? targetCandidates.filter(
							(candidate) =>
								candidate.source === params.targetSource ||
								candidate.metadata.relativePath === params.targetSource ||
								candidate.source === `target/${params.targetSource}`,
						)
					: [];
				if (matchingTargets.length !== 1) {
					const question = "Target source 不明確，請選擇一個明確的 target 檔案。";
					const evidenceIds = [...sessionState.getFetchedEvidenceIds()];
					const decision = sessionState.handleDeepResult(identity, {
						kind: "needs_decision",
						decisionId: `${identity.attemptId}-target-source`,
						question,
						options,
						recommendation: options[0] ?? "補充明確的 targetSource",
						evidenceIds,
					});
					if (decision.kind === "stale") {
						return {
							content: [{ type: "text", text: "過期的 Deep Retrieval 嘗試已忽略。" }],
							details: { status: "stale", evidence: [] },
							terminate: true,
						};
					}
					restoreActiveTools();
					await publishState(pi, ctx as CommandContext, decision.state);
					return {
						content: [{ type: "text", text: question }],
						details: { status: "needs_decision", question, options, evidenceIds },
						terminate: true,
					};
				}
				selectedTarget = matchingTargets[0];
			}
			const fetchedCandidates = [...sessionState.getFetchedEvidenceIds()]
				.map((evidenceId) => workflow.snapshot.candidates[evidenceId])
				.filter((candidate): candidate is GrillEvidenceCandidate => Boolean(candidate));
			const reusedEvidenceIds = new Set(
				fetchedCandidates
					.filter(
						(candidate) =>
							candidate.kind === params.source &&
							`${candidate.source}\n${candidate.content}`.toLowerCase().includes(query),
					)
					.map((candidate) => candidate.candidateId),
			);
				if (reusedEvidenceIds.size > 0) {
				return {
						content: [{ type: "text", text: "已重用 Grill 快照中的證據。" }],
						details: {
							status: "accepted",
							...identity,
							evidence: [],
							reusedEvidenceIds: [...reusedEvidenceIds],
						},
						terminate: true,
				};
			}
			const reusedSupplementalEvidence = sessionState.getDeepSupplementalEvidence().filter(
				(evidence) => evidence.kind === params.source && `${evidence.source}\n${evidence.content}`.toLowerCase().includes(query),
			);
			if (reusedSupplementalEvidence.length > 0) {
				return {
						content: [{ type: "text", text: "已重用目前 Deep 嘗試中的證據。" }],
						details: {
							status: "accepted",
							...identity,
							evidence: [],
							reusedEvidenceIds: reusedSupplementalEvidence.map((evidence) => evidence.evidenceId),
						},
						terminate: true,
				};
			}
			const searchBudget = sessionState.reserveDeepSearchBudget(identity);
			if (searchBudget === "stale") {
				return {
					content: [{ type: "text", text: "過期的 Deep Retrieval 嘗試已忽略。" }],
					details: { status: "stale", evidence: [] },
					terminate: true,
				};
			}
			if (searchBudget === "limit") {
				return {
					content: [{ type: "text", text: `本輪 Deep Search 最多搜尋 ${DEEP_SEARCH_MAX_PER_SOURCE_ROUND} 次，已拒絕這次搜尋。` }],
					details: { status: "rejected", reason: "search_budget_exhausted", limit: DEEP_SEARCH_MAX_PER_SOURCE_ROUND },
					terminate: true,
				};
			}
			let evidence: Array<{
				content: string;
				evidenceId: string;
				kind: string;
				metadata: Record<string, unknown>;
				source: string;
				title: string;
			}>;
			try {
				evidence =
					params.source === "wiki"
						? loadWikiDiscoverySources(workflow.rootDir)
								.filter((document) => `${document.path}\n${document.content}`.toLowerCase().includes(query))
								.slice(0, 3)
								.map((document) => ({
									content: document.content,
									evidenceId: createEvidenceId("wiki", document.path, document.content),
									kind: "wiki",
									metadata: { rejection: document.rejection },
									source: document.path,
									title: document.path,
								}))
						: params.source === "code_base"
							? findCodeBaseCandidates(workflow.rootDir, [params.query], 3).map((candidate) => ({
										content: candidate.content,
										evidenceId: createEvidenceId("code_base", candidate.relativePath, candidate.content),
										kind: "code_base",
										metadata: {
											matches: candidate.matches,
											relativePath: candidate.relativePath,
											score: candidate.score,
											whyRelevant: candidate.whyRelevant,
											rejection: candidate.rejection,
										},
										source: candidate.relativePath,
										title: candidate.relativePath,
									}))
							: selectedTarget
								? [
											{
												content: selectedTarget.content,
												evidenceId: selectedTarget.candidateId,
												kind: "target",
												metadata: { ...selectedTarget.metadata },
												source: selectedTarget.source,
												title: selectedTarget.title,
											},
										]
								: [];
			} catch (error) {
				sessionState.releaseDeepSearchBudget(identity);
				throw error;
			}
			const supplementalEvidence = evidence.filter((item) => {
				const itemSource = item.source.replace(/\\/g, "/");
				const reused = fetchedCandidates.find((candidate) => {
					if (candidate.kind !== item.kind) {
						return false;
					}
					return [candidate.source, candidate.metadata.relativePath]
						.filter((source): source is string => Boolean(source))
						.map((source) => source.replace(/\\/g, "/"))
						.some(
							(source) =>
								itemSource === source || itemSource.endsWith(`/${source}`) || source.endsWith(`/${itemSource}`),
						);
				});
				if (reused) {
					reusedEvidenceIds.add(reused.candidateId);
					return false;
				}
				return true;
			});
			const oversizedEvidence = supplementalEvidence.find(
				(item) => {
					return isEvidenceTooLargeRejection(item.metadata["rejection"])
						|| Buffer.byteLength(item.content, "utf8") > DEEP_EVIDENCE_MAX_BYTES;
				},
			);
			if (oversizedEvidence) {
				sessionState.releaseDeepSearchBudget(identity);
				const rejection = oversizedEvidence.metadata["rejection"];
				const validatedRejection = isEvidenceTooLargeRejection(rejection) ? rejection : undefined;
				return {
					content: [
						{
							type: "text",
							text: `Deep Search 證據過大，單筆上限為 ${DEEP_EVIDENCE_MAX_BYTES} bytes，已拒絕這次搜尋。`,
						},
					],
					details: {
						status: "rejected",
						reason: validatedRejection?.reason ?? "evidence_too_large",
						byteSize: validatedRejection?.byteSize,
						limit: validatedRejection?.limit ?? DEEP_EVIDENCE_MAX_BYTES,
						evidence: [],
					},
					terminate: true,
				};
			}
			const roundEvidenceBytes = getDeepEvidenceContentBytes([
				...fetchedCandidates.map((candidate) => ({
					evidenceId: candidate.candidateId,
					source: candidate.source,
					content: candidate.content,
				})),
				...sessionState.getDeepSupplementalEvidence(),
				...supplementalEvidence,
			]);
			if (roundEvidenceBytes > DEEP_EVIDENCE_ROUND_MAX_BYTES) {
				sessionState.releaseDeepSearchBudget(identity);
				return {
					content: [
						{
							type: "text",
							text: `Deep Search 本輪證據總量超過 ${DEEP_EVIDENCE_ROUND_MAX_BYTES} bytes，已拒絕這次搜尋。`,
						},
					],
					details: {
						status: "rejected",
						reason: "evidence_round_too_large",
						limit: DEEP_EVIDENCE_ROUND_MAX_BYTES,
						evidence: [],
					},
					terminate: true,
				};
			}
			const committed = sessionState.commitDeepSearchBudget(identity);
			if (committed === "stale") {
				return {
					content: [{ type: "text", text: "過期的 Deep Retrieval 嘗試已忽略。" }],
					details: { status: "stale", evidence: [] },
					terminate: true,
				};
			}

			for (const item of supplementalEvidence) {
				const recorded = sessionState.recordDeepSupplementalEvidence(identity, item.evidenceId, item);
				if (recorded.kind === "accepted") rememberFetchedEvidence(fetchedDeepSupplementalEvidence, item);
			}
			return {
				content: [{ type: "text", text: supplementalEvidence.map((item) => item.content).join("\n\n") }],
				details: {
					status: "accepted",
					...identity,
					evidence: supplementalEvidence,
					reusedEvidenceIds: [...reusedEvidenceIds],
				},
				terminate: true,
			};
		},
	});

	pi.registerTool?.({
		name: "forge_deep_retrieval_complete",
		label: "Forge Deep Retrieval 完成",
		description: "鎖定執行期間收集的所有證據，並繼續進入 Knowledge Understanding。",
		parameters: Type.Object(
			{
				attemptId: Type.String(),
				sourceRoundId: Type.String(),
				phase: Type.Literal("DEEP_KNOWLEDGE_RETRIEVAL"),
				outcome: Type.Union([
					Type.Object({ kind: Type.Literal("completed") }, { additionalProperties: false }),
					Type.Object(
						{
							kind: Type.Literal("needs_decision"),
							decisionId: Type.String(),
							question: Type.String(),
							options: Type.Array(Type.String()),
							recommendation: Type.String(),
							evidenceIds: Type.Array(Type.String()),
							decisionSummary: Type.Optional(Type.String()),
						},
						{ additionalProperties: false },
					),
					Type.Object(
						{
							kind: Type.Literal("needs_discovery"),
							decisionSummary: Type.Optional(Type.String()),
						},
						{ additionalProperties: false },
					),
				]),
			},
			{ additionalProperties: false },
		),
		async execute(
			toolCallId: string,
			params: {
				attemptId: string;
				sourceRoundId: string;
				phase: "DEEP_KNOWLEDGE_RETRIEVAL";
				outcome:
					| { kind: "completed" }
					| {
							kind: "needs_decision";
							decisionId: string;
							question: string;
							options: string[];
							recommendation: string;
							evidenceIds: string[];
							decisionSummary?: string;
					  }
					| { kind: "needs_discovery"; decisionSummary?: string };
			},
			_signal: unknown,
			_onUpdate: unknown,
				ctx: unknown,
			) {
				const identity = {
					attemptId: params.attemptId,
					sourceRoundId: params.sourceRoundId,
					phase: params.phase,
				} as const;
				if (deepRetrievalBatch?.mixed && deepRetrievalBatch.completionCallIds.has(toolCallId)) {
					return {
						content: [{ type: "text", text: "同一批次仍有 Deep Search，完成結果將於搜尋結束後重試。" }],
						details: {
							status: "rejected",
							reason: "mixed_search_completion_batch",
							retryable: true,
							...identity,
						},
						terminate: true,
					};
				}
						if (!isCurrentDeepAttempt(identity)) {
						return {
							content: [{ type: "text", text: "過期的 Deep Retrieval 完成結果已忽略。" }],
							details: { status: "stale", lockedEvidenceIds: [] },
							terminate: true,
						};
				}
				if (!activeWorkflow) {
					return { block: true };
				}
				if (!requireDeepToolBoundary(ctx as CommandContext)) {
					return {
						content: [{ type: "text", text: "Forge 無法安全限制 Deep 工具面，已拒絕處理。" }],
						details: { status: "rejected", reason: "deep_tool_boundary_unavailable" },
					};
				}
			if (params.outcome.kind !== "completed") {
				if (params.outcome.kind === "needs_decision") {
					const knownEvidenceIds = new Set([
						...sessionState.getFetchedEvidenceIds(),
						...sessionState.getDeepSupplementalEvidenceIds(),
					]);
					if (hasUnknownEvidenceIds(params.outcome.evidenceIds, knownEvidenceIds)) {
						return {
							content: [{ type: "text", text: "Deep Retrieval 的 needs_decision 引用了未知的 Evidence ID。" }],
							details: { status: "invalid", errors: ["Deep Retrieval 的 needs_decision 引用了未知的 Evidence ID。"] },
						};
					}
				}
				const completion = sessionState.handleDeepResult(identity, params.outcome);
					if (completion.kind === "stale") {
						return {
							content: [{ type: "text", text: "過期的 Deep Retrieval 完成結果已忽略。" }],
							details: { status: "stale", lockedEvidenceIds: [] },
								terminate: true,
						};
					}
					recordAcceptedNeedsDiscovery(completion, params.outcome);
				if (completion.state.stage === "LIGHT_DISCOVERY") {
					queueDiscoveryRestart(toolCallId, "forge_deep_retrieval_complete", identity, completion.state);
				}
				restoreActiveTools();
				if (completion.state.stage === "WAIT_USER" && completion.state.waitUser) {
					await publishWaitUser(completion.state.waitUser, ctx as CommandContext, { deliverAs: "displayOnly" }).catch((error: unknown) => {
						(ctx as CommandContext).ui?.notify?.(
							`Forge WAIT_USER UI 失敗：${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
					});
				} else {
					await publishState(pi, ctx as CommandContext, completion.state);
				}
				return {
					content: [{ type: "text", text: `Forge Deep Retrieval 的 ${params.outcome.kind} 結果已接受。` }],
					details: { status: params.outcome.kind, payload: params.outcome },
					terminate: true,
				};
			}
			const inheritedEvidence = [...sessionState.getFetchedEvidenceIds()]
				.map((evidenceId) => activeWorkflow?.snapshot.candidates[evidenceId])
				.filter((candidate): candidate is GrillEvidenceCandidate => Boolean(candidate))
				.map((candidate) => ({
					content: candidate.content,
					evidenceId: candidate.candidateId,
					kind: candidate.kind,
					metadata: { ...candidate.metadata },
					source: candidate.source,
					title: candidate.title,
				}));
			const completion = sessionState.completeDeepRetrieval(inheritedEvidence, undefined, identity);
				if (completion.kind === "stale") {
					return {
						content: [{ type: "text", text: "過期的 Deep Retrieval 完成結果已忽略。" }],
						details: { status: "stale", lockedEvidenceIds: [] },
						terminate: true,
					};
				}

			activateDeepUnderstandingTools();
			await publishState(pi, ctx as CommandContext, completion.state);
			const locked = sessionState.getLockedDeepEvidence();
			const lockedEvidenceIds = locked
				? [...locked.inherited, ...locked.supplemental].map((evidence) => evidence.evidenceId)
				: [];
			return {
				content: [{ type: "text", text: "Forge Deep Retrieval 完成結果已接受。" }],
				details: { status: "accepted", ...completion.identity, lockedEvidenceIds },
				terminate: true,
			};
		},
	});

	pi.registerTool?.({
		name: "forge_deep_complete",
		label: "Forge Deep 完成",
		description: "根據已鎖定的 Deep 證據建立並驗證 Evidence Package。",
		parameters: Type.Object(
			{
				attemptId: Type.String(),
				sourceRoundId: Type.String(),
				phase: Type.Literal("KNOWLEDGE_UNDERSTANDING"),
				outcome: Type.Union([
					Type.Object(
						{
							kind: Type.Literal("completed"),
							decisions: Type.Array(
								Type.Object(
									{
										decisionId: Type.String(),
										statement: Type.String(),
										evidenceIds: Type.Array(Type.String()),
									},
									{ additionalProperties: false },
								),
							),
							findings: Type.Array(
								Type.Object(
									{
										statement: Type.String(),
										evidenceIds: Type.Array(Type.String()),
									},
									{ additionalProperties: false },
								),
							),
							limitations: Type.Array(
								Type.Object(
									{
										statement: Type.String(),
										blocking: Type.Boolean(),
									},
									{ additionalProperties: false },
								),
							),
						},
						{ additionalProperties: false },
					),
					Type.Object(
						{
							kind: Type.Literal("needs_decision"),
							decisionId: Type.String(),
							question: Type.String(),
							options: Type.Array(Type.String()),
							recommendation: Type.String(),
							evidenceIds: Type.Array(Type.String()),
							decisionSummary: Type.Optional(Type.String()),
						},
						{ additionalProperties: false },
					),
					Type.Object(
						{
							kind: Type.Literal("needs_discovery"),
							decisionSummary: Type.Optional(Type.String()),
						},
						{ additionalProperties: false },
					),
				]),
			},
			{ additionalProperties: false },
		),
		async execute(
			_toolCallId: string,
			params: {
				attemptId: string;
				sourceRoundId: string;
				phase: "KNOWLEDGE_UNDERSTANDING";
				outcome:
					| {
							kind: "completed";
							decisions: EvidenceDecision[];
							findings: EvidenceFinding[];
							limitations: EvidenceLimitation[];
					  }
					| {
							kind: "needs_decision";
							decisionId: string;
							question: string;
							options: string[];
							recommendation: string;
							evidenceIds: string[];
							decisionSummary?: string;
					  }
					| { kind: "needs_discovery"; decisionSummary?: string };
			},
			_signal: unknown,
			_onUpdate: unknown,
				ctx: unknown,
			) {
			const identity = {
				attemptId: params.attemptId,
				sourceRoundId: params.sourceRoundId,
				phase: params.phase,
			} as const;
				if (!isCurrentDeepAttempt(identity)) {
					return {
						content: [{ type: "text", text: "過期的 Knowledge Understanding 完成結果已忽略。" }],
						details: { status: "stale" },
						terminate: true,
					};
			}
			if (!requireDeepToolBoundary(ctx as CommandContext)) {
				return {
					content: [{ type: "text", text: "Forge 無法安全限制 Deep 工具面，已拒絕處理。" }],
					details: { status: "rejected", reason: "deep_tool_boundary_unavailable" },
				};
			}
			if (params.outcome.kind !== "completed") {
				if (params.outcome.kind === "needs_decision") {
			const locked = sessionState.getLockedDeepEvidence();
			const knownEvidenceIds = new Set(
				locked
					? [...locked.inherited, ...locked.supplemental].map((evidence) => evidence.evidenceId)
					: [...fetchedGrillEvidence.keys(), ...fetchedDeepSupplementalEvidence.keys()],
			);
					if (hasUnknownEvidenceIds(params.outcome.evidenceIds, knownEvidenceIds)) {
						return {
							content: [{ type: "text", text: "Knowledge Understanding 的 needs_decision 引用了未知的 Evidence ID。" }],
							details: { status: "invalid", errors: ["Knowledge Understanding 的 needs_decision 引用了未知的 Evidence ID。"] },
						};
					}
				}
				const completion = sessionState.handleDeepResult(identity, params.outcome);
					if (completion.kind === "stale") {
						return {
							content: [{ type: "text", text: "過期的 Knowledge Understanding 完成結果已忽略。" }],
							details: { status: "stale" },
								terminate: true,
						};
					}
				recordAcceptedNeedsDiscovery(completion, params.outcome);
				if (completion.state.stage === "LIGHT_DISCOVERY") {
					queueDiscoveryRestart(_toolCallId, "forge_deep_complete", identity, completion.state);
				}
				restoreActiveTools();
				if (completion.state.stage === "WAIT_USER" && completion.state.waitUser) {
					await publishWaitUser(completion.state.waitUser, ctx as CommandContext, { deliverAs: "displayOnly" }).catch((error: unknown) => {
						(ctx as CommandContext).ui?.notify?.(
							`Forge WAIT_USER UI 失敗：${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
					});
				} else {
					await publishState(pi, ctx as CommandContext, completion.state);
				}
				return {
					content: [{ type: "text", text: `Forge Deep 的 ${params.outcome.kind} 結果已接受。` }],
					details: { status: params.outcome.kind, payload: params.outcome },
					terminate: true,
				};
			}

			const locked = sessionState.getLockedDeepEvidence();
			if (!locked && fetchedGrillEvidence.size === 0) {
				return {
					content: [{ type: "text", text: "Deep 證據尚未鎖定。" }],
					details: { status: "invalid", errors: ["Deep evidence 尚未鎖定"] },
				};
			}

			const decisions = [...sessionState.getHumanDecisions(), ...params.outcome.decisions].map((decision) =>
				decision.decisionId === fallbackHumanDecisionId && fallbackHumanPremise
					? {
							...decision,
							evidenceIds: [...new Set([...decision.evidenceIds, fallbackHumanPremise.evidenceId])],
						}
					: decision,
			);
			const evidencePackage = createEvidencePackage({
				inherited: locked ? [...locked.inherited] : [...fetchedGrillEvidence.values()],
				supplemental: locked ? [...locked.supplemental] : [...fetchedDeepSupplementalEvidence.values()],
				humanPremise: fallbackHumanPremise ? [fallbackHumanPremise] : [],
				decisions,
				findings: params.outcome.findings,
				limitations: params.outcome.limitations,
			});
			const validation = validateEvidencePackage(evidencePackage);
			if (!validation.ok) {
				const hasDuplicateDecisionError = validation.errors.some((error) => error.startsWith("決策 ID 重複："));
				return {
					content: [{ type: "text", text: validation.errors.join("\n") }],
					details: {
						status: "invalid",
						...(hasDuplicateDecisionError ? { retryable: true } : {}),
						errors: validation.errors,
						evidencePackage,
					},
				};
			}

			const completion = sessionState.handleDeepResult(identity, {
				kind: "completed",
				evidenceIds: evidencePackage.evidence.map((evidence) => evidence.evidenceId),
			});
				if (completion.kind === "stale") {
					return {
						content: [{ type: "text", text: "過期的 Knowledge Understanding 完成結果已忽略。" }],
						details: { status: "stale", evidencePackage },
						terminate: true,
					};
				}

			restoreActiveTools();
			await publishState(pi, ctx as CommandContext, completion.state);
			return {
				content: [{ type: "text", text: "Forge Deep 完成結果已接受。" }],
				details: { status: "accepted", evidencePackage },
				terminate: true,
			};
		},
	});

	pi.on?.("message_start", (event: UserMessageEvent) => {
		if (event.message?.role !== "user" || !pendingReplayInvocation) {
			return;
		}
		const messageText = event.message.content?.map((block) => block.text).join("") ?? "";
		if (messageText.trim() !== pendingReplayInvocation) {
			return;
		}
		pendingReplayInvocation = undefined;
	});

		pi.on?.("message_end", async (event: AssistantMessageEvent | UserMessageEvent, ctx) => {
			if (event.message?.role === "toolResult" && "toolCallId" in event.message) {
				const batch = deepRetrievalBatch;
				const toolCallId = event.message.toolCallId;
				if (!batch || !toolCallId || !batch.searchCallIds.has(toolCallId)) {
					return;
				}
				batch.settledSearchCallIds.add(toolCallId);
				if (
					batch.followUpQueued ||
					batch.settledSearchCallIds.size !== batch.searchCallIds.size ||
					!isCurrentDeepAttempt(batch.identity) ||
					!activeWorkflow
				) {
					return;
				}
				batch.followUpQueued = true;
				const targetSources = [
					...new Set(
						Object.values(activeWorkflow.snapshot.candidates)
							.filter((candidate) => candidate.kind === "target")
							.map((candidate) => candidate.metadata.relativePath ?? candidate.source),
					),
				].sort();
				const invocation = `Deep Search 批次已完成。\n${DEEP_RESULT_GUIDANCE}\nTarget source manifest：${JSON.stringify(targetSources)}\n請使用相同 runtime-issued identity 繼續，並在搜尋完成後另送 completion-only batch：${JSON.stringify(batch.identity)}`;
				pendingReplayInvocation = invocation;
				await pi.sendUserMessage?.(invocation, { deliverAs: "followUp" });
				return;
			}
			if (event.message?.role !== "assistant" || !("content" in event.message)) {
				return;
			}
			if (hasActiveDeepAttempt()) {
				const content: Array<AssistantTextBlock | AssistantThinkingBlock | AssistantToolCallBlock> =
					event.message.content ?? [];
				const toolCalls = content.filter(
					(block): block is AssistantToolCallBlock => block.type === "toolCall",
				);
				const searchCallIds = toolCalls
					.filter((block) => block.name === "forge_deep_search")
					.map((block) => block.id)
					.filter((id): id is string => typeof id === "string");
				const completionCallIds = toolCalls
					.filter((block) => block.name === "forge_deep_retrieval_complete")
					.map((block) => block.id)
					.filter((id): id is string => typeof id === "string");
				const identity = sessionState.currentDeepAttempt();
				deepRetrievalBatch = identity && searchCallIds.length + completionCallIds.length > 0
					? {
							identity,
							searchCallIds: new Set(searchCallIds),
							completionCallIds: new Set(completionCallIds),
							settledSearchCallIds: new Set(),
							mixed: searchCallIds.length > 0 && completionCallIds.length > 0,
							followUpQueued: false,
						}
					: undefined;
				return {
					message: {
						...event.message,
						content: event.message.content?.filter((block) => block.type === "toolCall") ?? [],
					},
				};
			}
			if (!hasActiveGrillAttempt()) {
				return;
			}

			if (event.message.content?.some((block) => block.type === "toolCall")) {
				return;
			}

				const firstOmission = sessionState.recordCompletionOmission();
					if (firstOmission) {
						await publishState(pi, ctx ?? {}, sessionState.current(), { deliverAs: "displayOnly" });
						await pi.sendMessage?.({
							content: "GRILL_COMPLETION_REQUIRED\n請輸入 /forge-runtime retry、/forge-runtime cancel，或 /forge-runtime switch <request>。",
							customType: "forge-grill-error",
							display: true,
						}, { triggerTurn: false });
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

	pi.on?.("tool_result", async (event: ToolResultEvent, ctx?: CommandContext) => {
		const pendingRestart = pendingDiscoveryRestart;
		if (!pendingRestart || event.toolCallId !== pendingRestart.toolCallId || event.toolName !== pendingRestart.toolName) {
			return undefined;
		}
		pendingDiscoveryRestart = undefined;
		if (event.isError !== false) {
			return undefined;
		}

		const current = sessionState.current();
		let currentRoundId: string | undefined;
		try {
			currentRoundId = sessionState.continueGrillRound().roundId;
		} catch {
			currentRoundId = undefined;
		}
		if (
			!activeWorkflow ||
			current.stage !== "LIGHT_DISCOVERY" ||
			currentRoundId !== pendingRestart.identity.sourceRoundId ||
			!requireGrillToolBoundary(ctx ?? {})
		) {
			return undefined;
		}

		const invocation = await restartLightDiscoveryAndGrill(activeWorkflow, ctx ?? {});
		return {
			content: [...event.content, { type: "text", text: invocation }],
		};
	});

	pi.on?.("agent_settled", async () => {
		const pending = pendingSettledDeepInvocation;
		if (!pending || pendingSettledDeepInvocationTimer) {
			return;
		}
		pendingSettledDeepInvocation = undefined;
		pendingSettledDeepInvocationTimer = setTimeout(async () => {
			pendingSettledDeepInvocationTimer = undefined;
			const current = sessionState.current();
			const currentAttempt = sessionState.currentDeepAttempt();
			const requiredTool = currentAttempt?.phase === "DEEP_KNOWLEDGE_RETRIEVAL"
				? "forge_deep_retrieval_complete"
				: currentAttempt?.phase === "KNOWLEDGE_UNDERSTANDING"
					? "forge_deep_complete"
					: undefined;
			const activeTools = pi.getActiveTools?.();
			if (
				activeWorkflow !== pending.activeWorkflow ||
				!currentAttempt ||
				currentAttempt.attemptId !== pending.identity.attemptId ||
				currentAttempt.sourceRoundId !== pending.identity.sourceRoundId ||
				currentAttempt.phase !== pending.identity.phase ||
				!hasActiveDeepAttempt() ||
				!requiredTool ||
				!activeTools?.includes(requiredTool) ||
				!pi.sendUserMessage
			) {
				return;
			}
			pendingReplayInvocation = pending.invocation;
			await pi.sendUserMessage(pending.invocation);
		}, 0);
	});

		pi.on?.("message_update", async (event: AssistantMessageEvent) => {
			if ((!pendingGrillRun && !hasActiveDeepAttempt()) || event.message?.role !== "assistant") {
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
		if (deepRetrievalToolNames.includes(event.toolName) || deepUnderstandingToolNames.includes(event.toolName)) {
				return !pendingReplayInvocation && !pendingSettledDeepInvocation && hasActiveDeepAttempt()
					? undefined
					: { block: true };
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

		const rawText = typeof event.text === "string" ? event.text : "";
		const routingText = rawText.trim();
		if (routingText === pendingReplayInvocation) {
			if (sessionState.currentDeepAttempt()?.phase === "DEEP_KNOWLEDGE_RETRIEVAL") {
				activateDeepRetrievalTools();
			} else if (sessionState.currentDeepAttempt()?.phase === "KNOWLEDGE_UNDERSTANDING") {
				activateDeepUnderstandingTools();
			}
			return { action: "continue" as const };
		}
			const grillRun = routingText === "/grill-run" || routingText.startsWith("/grill-run ");
			const grillRunRequest = grillRun ? routingText.slice("/grill-run".length).trim() : "";
			const canonicalRequest = grillRun ? grillRunRequest : rawText;
			const rootDir = ctx?.cwd ?? process.cwd();
		if (routingText.startsWith("/") && !grillRun) {
			return { action: "continue" as const };
		}

		if (pendingKnowledgeRequest) {
			if (!isApproval(routingText)) {
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
			clearFallbackWorkflowState();
			await publishState(pi, ctx ?? {}, sessionState.beginIntent(approvedRequest));
			await publishState(pi, ctx ?? {}, sessionState.beginLightDiscovery(approvedRequest));
			pendingGrillRun = true;
				const discovery = runLightDiscovery(approvedRootDir, approvedRequest);
					const lightDiscovery = buildGrillCompatibleDiscovery(approvedRootDir, discovery, approvedRequest);
			const round = sessionState.startGrillRound(approvedRequest, lightDiscovery.snapshot);
			activeWorkflow = {
				goal: approvedRequest,
				lightDiscovery,
				rootDir: approvedRootDir,
				seeds: extractDeepDiscoverySeeds(approvedRequest),
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
			if (currentState.stage === "WAIT_USER") {
						if (!requireGrillToolBoundary(ctx ?? {})) {
							return { action: "handled" as const };
						}
						const waitUser = currentState.waitUser;
			const normalized = routingText.toLowerCase();
						const selectedOption = waitUser?.options.find(
							(option) => option.trim().toLowerCase() === normalized,
						);
						const answer =
							selectedOption ??
							(waitUser?.recommendation &&
								(isApproval(routingText) || waitUser.recommendation.trim().toLowerCase() === normalized)
								? waitUser.recommendation
							: routingText);
						if (["deep_decision", "deep_discovery_fallback"].includes(waitUser?.kind ?? "")) {
							if (!requireDeepToolBoundary(ctx ?? {})) {
								return { action: "handled" as const };
							}
							const deepAnswer = prepareDeepKnowledgeAnswer(answer);
							if (deepAnswer.kind === "handled") {
								await publishState(pi, ctx ?? {}, deepAnswer.state);
								return deepAnswer.invocation
									? { action: "transform" as const, text: deepAnswer.invocation }
									: { action: "handled" as const };
							}
						}
						const invocation = await resumeGrillWithAnswer(answer, ctx ?? {});
					if (!invocation) {
						return { action: "handled" as const };
					}
					return { action: "transform" as const, text: invocation };
		}

		if (currentState.stage !== "RECEIVE") {
			// ponytail: v1 先硬擋雙開；真的需要換題/排隊，再補 explicit switch 或 queue。
			ctx?.ui?.notify?.(
				"Forge 已有進行中的 workflow。請用 /forge-runtime continue、/forge-runtime cancel，或 /forge-runtime switch <request>。",
				"warn",
			);
			return { action: "handled" as const };
		}

		const intent = grillRun
			? { route: "start_forge" as const }
			: await understandIntent(
					{ hasSlashCommand: false, sessionState: "idle", userMessage: rawText },
					ctx ?? {},
			  );

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
					request: canonicalRequest,
					rootDir,
				};
			ctx?.ui?.notify?.(
				`目前缺少 ${knowledgeAssets.missingAssets.join(" / ")}。若接受在沒有完整知識庫或代碼庫的情況下繼續，請明確回覆同意。`,
				"warn",
			);
			return { action: "handled" as const };
		}

			clearFallbackWorkflowState();
			await publishState(pi, ctx ?? {}, sessionState.beginIntent(canonicalRequest));
			await publishState(pi, ctx ?? {}, sessionState.beginLightDiscovery(canonicalRequest));
			pendingGrillRun = true;
			const discovery = runLightDiscovery(rootDir, canonicalRequest);
				const lightDiscovery = buildGrillCompatibleDiscovery(rootDir, discovery, canonicalRequest);
			const round = sessionState.startGrillRound(canonicalRequest, lightDiscovery.snapshot);
			activeWorkflow = {
				goal: canonicalRequest,
			lightDiscovery,
			rootDir,
			seeds: extractDeepDiscoverySeeds(canonicalRequest),
			snapshot: round.snapshot,
		};
		activateGrillTools();
			await publishState(pi, ctx ?? {}, sessionState.beginGrill(canonicalRequest));
		return {
			action: "transform" as const,
				text: buildGrillingSkillInvocation(
					[canonicalRequest, lightDiscovery.summary].filter((value) => value.length > 0).join("\n\n"),
				round.roundId,
				lightDiscovery.snapshot.manifest,
			),
		};
	});

	pi.registerCommand("forge-runtime", {
		description: "操作 Forge workflow：grill ambiguous <json>｜grill-result <json>｜confirm｜reject",
			handler: async (args, ctx) => {
				const command = args.trim();
				if (command.startsWith("grill ambiguous ")) {
					await publishWaitUser(parseWaitUserPayload(command.slice(16)), ctx);
					return;
				}

				if (command.startsWith("grill-result ")) {
					const state = sessionState.current();
					const stage = state.stage;
					const isWaitUserReplay = pendingGrillRun && stage === "WAIT_USER";
					if (!hasActiveGrillAttempt() && !isWaitUserReplay) {
						return;
					}
					const grillResult = parseActiveGrillCompletion(command.slice("grill-result ".length));
				const isSameConfirmationReplay =
					state.waitUser?.kind === "grill_confirmation" &&
					state.waitUser.roundId === grillResult.roundId &&
					grillResult.requiresUserConfirmation &&
					grillResult.questions[0]?.id === state.waitUser.decisionId;
				const isSameRelevanceReplay =
					state.waitUser?.kind === "relevance_clarification" &&
					grillResult.status === "READY_FOR_DEEP" &&
					grillResult.roundId === state.waitUser.roundId &&
					grillResult.roundId === state.waitUser.decisionId;
					if (isWaitUserReplay && !isSameConfirmationReplay && !isSameRelevanceReplay) {
						return;
					}
					if (!grillResult.requiresUserConfirmation) {
						const enteredDeep = await continueDeepKnowledge(
							pi,
							ctx,
							sessionState,
							activeWorkflow,
							publishWaitUser,
							requireDeepToolBoundary,
			(invocation) => {
				pendingReplayInvocation = invocation;
			},
			grillResult.recommendation.reason,
			grillResult,
			activateDeepRetrievalTools,
		);
						if (!enteredDeep.entered) {
							return;
						}
						pendingGrillRun = ["GRILL", "WAIT_USER"].includes(sessionState.current().stage);
						return;
					}
					await publishWaitUser(toWaitUserPayload(grillResult), ctx);
					return;
				}

				if (command === "continue") {
					if (sessionState.current().validationRepair?.rootCause === "RECOVERY_REQUIRED") {
						ctx.ui?.notify?.("目前需要 recovery action；請使用 /forge-runtime retry、cancel 或 switch <request>。", "warn");
						await publishState(pi, ctx, sessionState.current());
						return;
					}
					const stage = sessionState.current().stage;
					if (stage === "LIGHT_DISCOVERY" && activeWorkflow) {
						if (!pi.sendUserMessage || !requireGrillToolBoundary(ctx)) {
							await publishState(pi, ctx, sessionState.current());
							return;
						}
						const invocation = await restartLightDiscoveryAndGrill(activeWorkflow, ctx);
						pendingReplayInvocation = invocation;
						await pi.sendUserMessage(invocation, { deliverAs: "followUp" });
						return;
					}
					if (stage === "DEEP_KNOWLEDGE_RETRIEVAL" || stage === "KNOWLEDGE_UNDERSTANDING" || (stage === "WAIT_USER" && sessionState.current().waitUser?.kind === "deep_decision")) {
						if (!pi.sendUserMessage || !requireDeepToolBoundary(ctx)) {
							await publishState(pi, ctx, sessionState.current());
							return;
						}
						const currentAttempt = sessionState.currentDeepAttempt();
						const retryState = currentAttempt
							? sessionState.beginDeepKnowledge(undefined, currentAttempt.phase)
							: sessionState.retryDeepKnowledge();
						const retryAttempt = sessionState.currentDeepAttempt();
						if (!retryAttempt) return;
						if (retryAttempt.phase === "DEEP_KNOWLEDGE_RETRIEVAL") activateDeepRetrievalTools();
						else activateDeepUnderstandingTools();
						const invocation = `請繼續 Forge Deep ${retryAttempt.phase}。attemptId=${retryAttempt.attemptId} sourceRoundId=${retryAttempt.sourceRoundId} phase=${retryAttempt.phase}`;
						pendingReplayInvocation = invocation;
						await pi.sendUserMessage(invocation, { deliverAs: "followUp" });
						await publishState(pi, ctx, retryState);
						return;
					}
					const canResumeCancelledDeep = stage === "GRILL" && activeWorkflow && !pendingGrillRun;
					if ((!pendingGrillRun && !canResumeCancelledDeep) || (stage !== "GRILL" && stage !== "WAIT_USER")) {
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
					const current = sessionState.current();
					const deepCancel =
						current.stage === "DEEP_KNOWLEDGE_RETRIEVAL" ||
						current.stage === "KNOWLEDGE_UNDERSTANDING" ||
						(current.stage === "WAIT_USER" &&
							(current.waitUser?.kind === "deep_decision" || current.waitUser?.kind === "deep_discovery_fallback"));
					clearPendingState();
					clearFallbackWorkflowState();
					restoreActiveTools();
					if (deepCancel) {
						pendingGrillRun = false;
						await publishState(pi, ctx, sessionState.cancelDeepKnowledge());
						return;
					}
					activeWorkflow = undefined;
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
				clearFallbackWorkflowState();
				clearPendingState();
				restoreActiveTools();
				sessionState.reset();
				return;
			}

			if (command === "confirm") {
				const state = sessionState.current();
				if (state.stage === "WAIT_USER" && state.waitUser) {
					if (state.waitUser.kind === "relevance_clarification") {
						ctx.ui?.notify?.("目前等待相關性澄清，請補充可信來源或縮小需求範圍。", "warn");
						await publishState(pi, ctx, state);
						return;
					}
					if (await resumeWaitUserAnswer(state.waitUser.recommendation, ctx)) {
						return;
					}
					await publishState(pi, ctx, state);
					return;
				}
				await confirmAndContinueDeepKnowledge(
					pi,
					ctx,
					sessionState,
						activeWorkflow,
						publishWaitUser,
						requireDeepToolBoundary,
						(invocation) => {
							pendingReplayInvocation = invocation;
						},
						releaseGrillBoundary,
					);
				return;
			}

			if (command === "reject") {
				const state = sessionState.current();
				if (state.stage === "WAIT_USER" && state.waitUser) {
					if (await resumeWaitUserAnswer("reject", ctx)) {
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
					if (await resumeWaitUserAnswer(answer, ctx)) {
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

function extractDeepDiscoverySeeds(message: string): string[] {
	const tokens = message.match(/[\w./-]+\.[A-Za-z0-9]+|`([^`]+)`|[A-Z]{2,}-\d+/g) ?? [];
	const words = message.split(/\s+/).flatMap((token) => token.trim().split(/(?<=[\u4e00-\u9fff])(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])(?=[\u4e00-\u9fff])/));
	return [...new Set([...tokens, ...words].map((value) => value.replaceAll("`", "").trim()))]
		.filter((value) => value.length >= 2)
		.slice(0, 8);
}

function buildGrillCompatibleDiscovery(rootDir: string, discovery: LightDiscoveryResult, rawMessage: string): GrillCompatibleDiscovery {
	const candidates: CodeBaseCandidate[] = [];
	const evidence: GrillEvidenceCandidate[] = [];
	const seeds = extractDeepDiscoverySeeds(rawMessage);
	for (const match of discovery.matches) {
		const contentPath = resolve(rootDir, match.source, match.relativePath);
		let content: string;
		let rejection: { reason: "evidence_too_large"; byteSize: number; limit: number } | undefined;
		try {
			const readResult = readEvidenceSource(contentPath);
			content = readResult.content;
			rejection = readResult.rejection;
		} catch {
			continue;
		}
		const source = `${match.source}/${match.relativePath}`;
		const candidateId = createEvidenceId(match.source, source, content);
		const metadata = { relativePath: match.relativePath, matches: ["path"], rejection };
			evidence.push({ candidateId, content, kind: match.source, metadata, source, title: match.fileName });
			if (match.source === "code_base") {
				const targetPath = resolve(rootDir, match.relativePath);
				try {
					const targetReadResult = readEvidenceSource(targetPath);
					const targetContent = targetReadResult.content;
					const targetSource = `target/${match.relativePath}`;
					evidence.push({
						candidateId: createEvidenceId("target", targetSource, targetContent),
						content: targetContent,
						kind: "target",
						metadata: { relativePath: match.relativePath, matches: ["path"], rejection: targetReadResult.rejection },
						source: targetSource,
						title: match.fileName,
					});
				} catch {
					// 沒有對應且可讀的 target 時，不把它加入 snapshot。
				}
				const lowerPath = match.relativePath.toLowerCase();
				const lowerContent = content.toLowerCase();
				const pathScore = scoreDiscoverySeeds(match.relativePath, seeds);
				const contentScore = scoreDiscoverySeeds(content, seeds);
				const matches = [pathScore > 0 ? "path" : undefined, contentScore > 0 ? "content" : undefined].filter(
					(value): value is string => Boolean(value),
				);
				if (matches.length < 2) {
					continue;
				}
				const matchedSeeds = seeds.filter((seed) => {
					const normalizedSeed = seed.trim().toLowerCase();
					return normalizedSeed.length > 0 && (lowerPath.includes(normalizedSeed) || lowerContent.includes(normalizedSeed));
				});
				candidates.push({
					content,
					matches,
					matchedSeeds,
					path: contentPath,
					pathScore,
					relativePath: match.relativePath,
					score: pathScore + contentScore,
					whyRelevant: `已於 ${match.relativePath} 命中 ${matches.join(" + ")} 訊號。`,
				});
			}
	}
		const snapshot = deepFreeze({
			candidates: Object.fromEntries(evidence.map((item) => [item.candidateId, item])),
			manifest: evidence.map((item) => ({
				candidateId: item.candidateId,
				kind: item.kind,
				...(item.metadata.rejection?.reason ? { rejection: item.metadata.rejection.reason } : {}),
				source: item.source,
				title: item.title,
			})),
		}) as GrillEvidenceSnapshot;
	const summary = [
		...discovery.matches.map((match) => `- ${match.source}/${match.relativePath}`),
		...discovery.warnings.map((warning) => `警告：${warning}`),
	].join("\n");
	return { codeBaseCandidates: candidates, snapshot, summary };
}

function scoreDiscoverySeeds(haystack: string, seeds: string[]): number {
	const lowerHaystack = haystack.toLowerCase();
	return seeds.reduce((score, seed) => {
		const normalizedSeed = seed.trim().toLowerCase();
		return normalizedSeed.length > 0 && lowerHaystack.includes(normalizedSeed)
			? score + (normalizedSeed.includes(".") ? 3 : 1)
			: score;
	}, 0);
}

function createEvidenceId(kind: "wiki" | "code_base" | "target", source: string, content: string): `ev-${string}` {
	const normalized = content.replace(/\r\n?/g, "\n");
	return `ev-${createHash("sha256").update(JSON.stringify(["forge-grill-evidence-v1", kind, source, normalized])).digest("hex")}` as `ev-${string}`;
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}

async function handleWaitUserState(
	pi: ForgeExtensionApi,
	ctx: CommandContext,
	state: ForgeUiState,
	options?: { deliverAs?: "displayOnly" },
	resumeAnswer?: (answer: string, ctx: CommandContext) => Promise<boolean>,
): Promise<void> {
	const RUNTIME_OWNED_INPUT_LABEL = "自行輸入…";
	await publishState(pi, ctx, state, options);

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
				await resumeAnswer?.(trimmed, ctx);
			return;
		}
			await resumeAnswer?.(selection, ctx);
		return;
	}
}

async function confirmAndContinueDeepKnowledge(
	pi: ForgeExtensionApi,
	ctx: CommandContext,
	sessionState: ReturnType<typeof createForgeSessionState>,
		activeWorkflow: ActiveWorkflowContext | undefined,
		publishWaitUser: (payload: WaitUserPayload, ctx: CommandContext) => Promise<void>,
		requireDeepToolBoundary: (ctx: CommandContext) => boolean,
		setPendingReplayInvocation: (invocation: string) => void,
		onProceedToDeepKnowledge: () => void,
	): Promise<ForgeUiState> {
		const beforeConfirm = sessionState.current();
	const nextState = sessionState.confirm();
	await publishState(pi, ctx, nextState);

	if (beforeConfirm.stage !== "WAIT_USER" || !beforeConfirm.waitUser || nextState.stage !== "USER_CONFIRMED") {
		return nextState;
	}

	if (!requireDeepToolBoundary(ctx)) {
		return nextState;
	}

	await continueDeepKnowledge(
		pi,
		ctx,
		sessionState,
			activeWorkflow,
			publishWaitUser,
			requireDeepToolBoundary,
			setPendingReplayInvocation,
			beforeConfirm.decisionSummary,
			undefined,
			onProceedToDeepKnowledge,
	);
	return nextState;
}

async function continueDeepKnowledge(
	pi: ForgeExtensionApi,
	ctx: CommandContext,
	sessionState: ReturnType<typeof createForgeSessionState>,
		activeWorkflow: ActiveWorkflowContext | undefined,
		publishWaitUser: (payload: WaitUserPayload, ctx: CommandContext) => Promise<void>,
		requireDeepToolBoundary: (ctx: CommandContext) => boolean,
		setPendingReplayInvocation: (invocation: string) => void,
		decisionSummary?: string,
		_grillResult?: StructuredGrillResult,
			onProceedToDeepKnowledge?: () => void,
		deliveryMode: "settled" | "followUp" = "followUp",
		): Promise<{ entered: boolean; invocation?: string }> {
	const workflow = activeWorkflow;
	const candidates = workflow?.lightDiscovery.codeBaseCandidates ?? [];
	const relevance = evaluateCandidateRelevance(candidates);
	if (workflow && relevance.decision !== "proceed_deep") {
		const round = sessionState.continueGrillRound();
		const evidenceIds = [...sessionState.getFetchedEvidenceIds()];
		const waitUserPayload = {
			kind: "relevance_clarification" as const,
			roundId: round.roundId,
			decisionId: round.roundId,
			decisionSummary: relevance.reason,
			evidenceIds,
			options: ["補充可信來源", "縮小需求範圍"],
			question: `${relevance.reason}\n請選擇補充可信來源或縮小需求範圍。`,
			recommendation: "縮小需求範圍",
		};
			await publishWaitUser(waitUserPayload, ctx);
			return { entered: false };
		}

		if (!requireDeepToolBoundary(ctx)) {
			return { entered: false };
		}
			const nextState = sessionState.beginDeepKnowledge(decisionSummary);
			ctx.ui?.setStatus?.(buildWorkflowStatusText(nextState));
			const deepAttempt = sessionState.currentDeepAttempt();
			if (!deepAttempt) {
				throw new Error("Deep Knowledge attempt 未建立");
			}
			const targetSources = workflow
				? [
						...new Set(
							Object.values(workflow.snapshot.candidates)
								.filter((candidate) => candidate.kind === "target")
								.map((candidate) => candidate.metadata.relativePath ?? candidate.source),
						),
					].sort()
				: [];
			const invocation = `Deep Knowledge 已開始。\n${DEEP_RESULT_GUIDANCE}\nTarget source manifest：${JSON.stringify(targetSources)}\n請繼續執行搜尋，並在每次工具呼叫中原樣帶入 runtime-issued identity：${JSON.stringify(deepAttempt)}`;
		onProceedToDeepKnowledge?.();
		if (deliveryMode === "settled") {
			return { entered: true, invocation };
		}
		setPendingReplayInvocation(invocation);
		await pi.sendUserMessage?.(invocation, { deliverAs: "followUp" });
		return { entered: true };
	}

function parseWaitUserPayload(raw: string): WaitUserPayload {
	const parsed = JSON.parse(raw) as Partial<WaitUserPayload>;
	if (typeof parsed.question !== "string" || parsed.question.length === 0) {
		throw new Error("WAIT_USER payload 必須包含 question。");
	}
	if (typeof parsed.recommendation !== "string" || parsed.recommendation.length === 0) {
		throw new Error("WAIT_USER payload 必須包含 recommendation。");
	}
	if (!Array.isArray(parsed.options) || parsed.options.some((option) => typeof option !== "string" || option.length === 0)) {
		throw new Error("WAIT_USER payload 的 options 必須是非空字串陣列。");
	}
	if (
		!Array.isArray(parsed.evidenceIds) ||
		parsed.evidenceIds.some((evidenceId) => typeof evidenceId !== "string" || evidenceId.length === 0)
	) {
		throw new Error("WAIT_USER payload 的 evidenceIds 必須是非空字串陣列。");
	}
	if (typeof parsed.decisionId !== "string" || parsed.decisionId.trim().length === 0) {
		throw new Error("WAIT_USER payload 必須包含 decisionId。");
	}
	if (typeof parsed.roundId !== "string" || parsed.roundId.trim().length === 0) {
		throw new Error("WAIT_USER payload 必須包含 roundId。");
	}

	return {
		kind: "grill_confirmation",
		roundId: parsed.roundId,
		decisionId: parsed.decisionId,
		decisionSummary: typeof parsed.decisionSummary === "string" ? parsed.decisionSummary : undefined,
		evidenceIds: parsed.evidenceIds,
		options: parsed.options,
		question: parsed.question,
		recommendation: parsed.recommendation,
	};
}

async function publishState(
	pi: ForgeExtensionApi,
	ctx: CommandContext,
	state: ForgeUiState,
	options?: { deliverAs?: "displayOnly" },
): Promise<void> {
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
	if (options?.deliverAs === "displayOnly") return;
	await pi.sendMessage?.({ content: panelText, customType: "forge-stage", display: true }, options);
}
