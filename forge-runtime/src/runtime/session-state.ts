import { createOrchestrator, type Orchestrator } from "../workflow/orchestrator.ts";
import { createForgeUiState, type ForgeUiState, type WaitUserState } from "../ui/ui-state.ts";

export interface WaitUserPayload extends WaitUserState {
	decisionSummary?: string;
}

export function waitUserDecisionKey(waitUser: WaitUserState): string {
	return JSON.stringify([waitUser.roundId, waitUser.kind, waitUser.decisionId]);
}

export type GrillEvidenceKind = "wiki" | "code_base" | "target";

export interface GrillEvidenceManifestEntry {
	readonly candidateId: `ev-${string}`;
	readonly kind: GrillEvidenceKind;
	readonly source: string;
	readonly title: string;
}

export interface GrillEvidenceCandidate extends GrillEvidenceManifestEntry {
	readonly content: string;
	readonly metadata: Readonly<{
		discoveryEvidenceId?: string;
		matches?: readonly string[];
		relativePath?: string;
		score?: number;
		whyRelevant?: string;
	}>;
}

export type GrillEvidenceSnapshot = Readonly<{
	candidates: Readonly<Record<string, GrillEvidenceCandidate>>;
	manifest: readonly GrillEvidenceManifestEntry[];
}>;

export interface GrillRound {
	isFirstRoundOfSnapshot: boolean;
	roundId: string;
	request: string;
	snapshot: GrillEvidenceSnapshot;
}

export interface ForgeSessionState {
	beginGrill(decisionSummary?: string): ForgeUiState;
	beginIntent(decisionSummary?: string): ForgeUiState;
	beginLightDiscovery(decisionSummary?: string): ForgeUiState;
	beginDeepKnowledge(decisionSummary?: string): ForgeUiState;
	completeDeepKnowledge(evidenceIds: string[], decisionSummary?: string): ForgeUiState;
	confirm(): ForgeUiState;
		current(): ForgeUiState;
		continueGrillRound(): GrillRound;
		retryGrillRound(): GrillRound | undefined;
		getFetchedEvidenceIds(): ReadonlySet<string>;
	isFirstGrillRoundOfSnapshot(): boolean;
	recordCompletionOmission(): boolean;
	recordEvidenceFetch(candidateId: string): void;
	recordAnswer(answer: string): ForgeUiState;
	reset(): ForgeUiState;
	requireGrillResult(payload: WaitUserPayload): ForgeUiState;
	reject(selection?: string): ForgeUiState;
	requireWaitUser(payload: WaitUserPayload): ForgeUiState;
	startGrillRound(request: string, snapshot: GrillEvidenceSnapshot): GrillRound;
}

export function createForgeSessionState(): ForgeSessionState {
		const answeredDecisionKeys = new Set<string>();
		const fetchedEvidenceIds = new Set<string>();
		let currentGrillRound: GrillRound | undefined;
		let orchestrator: Orchestrator | undefined;
		let nextRoundId = 1;
		let completionOmissionRecorded = false;
		let uiState = createForgeUiState("RECEIVE");

	return {
		beginGrill(decisionSummary) {
			orchestrator = !orchestrator || orchestrator.getStage() === "RECEIVE" ? createOrchestrator({ initialStage: "GRILL" }) : orchestrator;
			uiState = {
				...uiState,
				decisionSummary: decisionSummary ?? uiState.decisionSummary,
				stage: orchestrator.getStage() === "GRILL" ? "GRILL" : orchestrator.transitionTo("GRILL"),
			};
			return uiState;
		},
		beginIntent(decisionSummary) {
			orchestrator = ensureOrchestrator(orchestrator);
			uiState = {
				...uiState,
				decisionSummary: decisionSummary ?? uiState.decisionSummary,
				stage:
					orchestrator.getStage() === "INTENT_UNDERSTANDING"
						? "INTENT_UNDERSTANDING"
						: orchestrator.transitionTo("INTENT_UNDERSTANDING"),
			};
			return uiState;
		},
		beginLightDiscovery(decisionSummary) {
			orchestrator = ensureOrchestrator(orchestrator);
			uiState = {
				...uiState,
				decisionSummary: decisionSummary ?? uiState.decisionSummary,
				stage:
					orchestrator.getStage() === "LIGHT_DISCOVERY"
						? "LIGHT_DISCOVERY"
						: orchestrator.transitionTo("LIGHT_DISCOVERY"),
			};
			return uiState;
		},
		beginDeepKnowledge(decisionSummary) {
			orchestrator =
				!orchestrator || orchestrator.getStage() === "RECEIVE"
					? createOrchestrator({ initialStage: "DEEP_KNOWLEDGE_RETRIEVAL" })
					: orchestrator;
			uiState = {
				...uiState,
				decisionSummary: decisionSummary ?? uiState.decisionSummary,
				stage:
					orchestrator.getStage() === "DEEP_KNOWLEDGE_RETRIEVAL"
						? "DEEP_KNOWLEDGE_RETRIEVAL"
						: orchestrator.transitionTo("DEEP_KNOWLEDGE_RETRIEVAL"),
				waitUser: undefined,
			};
			return uiState;
		},
		completeDeepKnowledge(evidenceIds, decisionSummary) {
			orchestrator =
				!orchestrator || orchestrator.getStage() === "RECEIVE"
					? createOrchestrator({ initialStage: "KNOWLEDGE_UNDERSTANDING" })
					: orchestrator;
			uiState = {
				...uiState,
				decisionSummary: decisionSummary ?? uiState.decisionSummary,
				lastEvidenceIds: evidenceIds,
				stage:
					orchestrator.getStage() === "KNOWLEDGE_UNDERSTANDING"
						? "KNOWLEDGE_UNDERSTANDING"
						: orchestrator.transitionTo("KNOWLEDGE_UNDERSTANDING"),
				waitUser: undefined,
			};
			return uiState;
		},
		confirm() {
			if (!orchestrator || orchestrator.getStage() !== "WAIT_USER") {
				uiState = {
					...uiState,
					stage: "CONFIRM_REJECTED_WAIT_USER_REQUIRED",
				};
				return uiState;
			}

			uiState = {
				...uiState,
				stage: orchestrator.handleUserConfirmation(),
				waitUser: undefined,
			};
			return uiState;
		},
		current() {
			return uiState;
		},
			continueGrillRound() {
				if (!currentGrillRound) {
					throw new Error("No active Grill round to continue");
				}

				return currentGrillRound;
			},
			retryGrillRound() {
				if (!currentGrillRound || uiState.validationRepair?.rootCause !== "RECOVERY_REQUIRED") {
					return undefined;
				}

				completionOmissionRecorded = false;
				uiState = {
					...uiState,
					stage: "GRILL",
					validationRepair: undefined,
				};
				return currentGrillRound;
			},
			getFetchedEvidenceIds() {
			return new Set(fetchedEvidenceIds);
		},
			isFirstGrillRoundOfSnapshot() {
				return currentGrillRound?.isFirstRoundOfSnapshot ?? false;
			},
			recordCompletionOmission() {
				if (completionOmissionRecorded) {
					return false;
				}
				completionOmissionRecorded = true;
				uiState = {
					...uiState,
					stage: "GRILL",
					validationRepair: {
						rootCause: "RECOVERY_REQUIRED",
						rollbackTarget: "GRILL",
					},
				};
				return true;
			},
			recordEvidenceFetch(candidateId) {
			if (!currentGrillRound) {
				throw new Error("No active Grill round for evidence fetch");
			}
			fetchedEvidenceIds.add(candidateId);
		},
		recordAnswer(answer) {
			if (!orchestrator || orchestrator.getStage() !== "WAIT_USER") {
				uiState = {
					...uiState,
					stage: "ANSWER_REJECTED_WAIT_USER_REQUIRED",
				};
				return uiState;
			}

			if (!uiState.waitUser) {
				throw new Error("WAIT_USER requires a pending decision");
			}
			const decisionId = uiState.waitUser.decisionId;
			const decisionKey = waitUserDecisionKey(uiState.waitUser);
			const isRelevanceClarification = uiState.waitUser.kind === "relevance_clarification";
			if (answeredDecisionKeys.has(decisionKey)) {
				return uiState;
			}

			orchestrator.handleUserConfirmation();
			answeredDecisionKeys.add(decisionKey);
			uiState = {
				...uiState,
				decisionSummary: `User answered decision ${JSON.stringify(decisionId)} with ${JSON.stringify(answer)}.`,
				stage: isRelevanceClarification ? orchestrator.getStage() : orchestrator.transitionTo("GRILL"),
				waitUser: undefined,
			};
			return uiState;
		},
		reset() {
			answeredDecisionKeys.clear();
			fetchedEvidenceIds.clear();
			currentGrillRound = undefined;
			orchestrator = undefined;
			completionOmissionRecorded = false;
				uiState = createForgeUiState("RECEIVE");
			return uiState;
		},
		requireGrillResult(payload) {
			return this.requireWaitUser(payload);
		},
		reject(selection) {
			const recommended = uiState.waitUser?.recommendation;
			const rejectedTo = selection ?? "reject";
			uiState = {
				...uiState,
				decisionSummary: `User rejected recommendation ${JSON.stringify(recommended ?? "unknown")} and selected ${JSON.stringify(rejectedTo)}.`,
				stage: "GRILL",
				validationRepair: {
					rollbackTarget: "GRILL",
					rootCause: "user_rejected_recommendation",
				},
				waitUser: undefined,
			};
			return uiState;
		},
		requireWaitUser(payload) {
			if (typeof payload.decisionId !== "string" || payload.decisionId.trim().length === 0) {
				throw new Error("wait user payload requires decisionId");
			}
			if (typeof payload.roundId !== "string" || payload.roundId.trim().length === 0) {
				throw new Error("wait user payload requires roundId");
			}
			const decisionKey = waitUserDecisionKey(payload);
			if (payload.roundId !== currentGrillRound?.roundId && !answeredDecisionKeys.has(decisionKey)) {
				throw new Error("wait user payload roundId was not issued by runtime");
			}
			if (!orchestrator || orchestrator.getStage() === "RECEIVE") {
				orchestrator = createOrchestrator({ initialStage: "GRILL" });
			}
			uiState = {
				decisionSummary: payload.decisionSummary,
				lastEvidenceIds: payload.evidenceIds,
				stage: orchestrator.handleGrillResult({ requiresUserConfirmation: true }),
				waitUser: {
					kind: payload.kind,
					roundId: payload.roundId,
					decisionId: payload.decisionId,
					evidenceIds: payload.evidenceIds,
					options: payload.options,
					question: payload.question,
					recommendation: payload.recommendation,
				},
			};
			return uiState;
		},
		startGrillRound(request, snapshot) {
			completionOmissionRecorded = false;
			const isFirstRoundOfSnapshot = currentGrillRound?.snapshot !== snapshot;
			if (isFirstRoundOfSnapshot) {
				fetchedEvidenceIds.clear();
			}
			currentGrillRound = {
				isFirstRoundOfSnapshot,
				roundId: `grill-${nextRoundId++}`,
				request,
				snapshot,
			};
			return currentGrillRound;
		},
	};
}

function ensureOrchestrator(current: Orchestrator | undefined): Orchestrator {
	return current ?? createOrchestrator({ initialStage: "RECEIVE" });
}
