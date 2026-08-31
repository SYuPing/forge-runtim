import { createOrchestrator, type Orchestrator } from "../workflow/orchestrator.ts";
import { createForgeUiState, type ForgeUiState, type WaitUserState } from "../ui/ui-state.ts";
import {
	validateEvidencePackage,
	type EvidenceDecision,
	type EvidenceInput,
	type EvidencePackage,
} from "../evidence/evidence-engine.ts";

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
	readonly rejection?: "evidence_too_large";
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
		rejection?: Readonly<{
			reason: "evidence_too_large";
			byteSize: number;
			limit: number;
		}>;
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

export type DeepAttemptPhase = "DEEP_KNOWLEDGE_RETRIEVAL" | "KNOWLEDGE_UNDERSTANDING";
export const DEEP_SEARCH_MAX_QUERY_CODE_POINTS = 1500;
export const DEEP_SEARCH_MAX_PER_SOURCE_ROUND = 8;
export const DEEP_EVIDENCE_MAX_BYTES = 256 * 1024;
export const DEEP_EVIDENCE_ROUND_MAX_BYTES = 2 * 1024 * 1024;

export function getDeepEvidenceContentBytes(
	evidence: readonly Pick<EvidenceInput, "evidenceId" | "source" | "content">[],
): number {
	const seen = new Set<string>();
	let total = 0;
	for (const item of evidence) {
		const key = `${item.evidenceId}\u0000${item.source}`;
		if (seen.has(key)) continue;
		seen.add(key);
		total += Buffer.byteLength(item.content, "utf8");
	}
	return total;
}

export interface DeepAttemptIdentity {
	readonly attemptId: string;
	readonly sourceRoundId: string;
	readonly phase: DeepAttemptPhase;
}

export type DeepCallResult =
	| {
			readonly kind: "accepted";
			readonly state: ForgeUiState;
			readonly identity: DeepAttemptIdentity;
	  }
	| {
			readonly kind: "stale";
			readonly expected?: DeepAttemptIdentity;
		readonly received: DeepAttemptIdentity;
	  }
	| {
			readonly kind: "invalid";
			readonly state: ForgeUiState;
			readonly errors: readonly string[];
	};

export interface LockedDeepEvidence {
	readonly inherited: readonly EvidenceInput[];
	readonly supplemental: readonly EvidenceInput[];
}

function copyEvidenceDecision(decision: EvidenceDecision): EvidenceDecision {
	return { ...decision, evidenceIds: [...decision.evidenceIds] };
}

export type DeepCompletedResult =
	| {
			readonly kind: "completed";
			readonly evidenceIds: string[];
			readonly decisionSummary?: string;
			readonly evidencePackage?: never;
	  }
	| {
			readonly kind: "completed";
			readonly evidencePackage: EvidencePackage;
			readonly evidenceIds?: never;
			readonly decisionSummary?: never;
	  };

export interface DeepNeedsDecisionResult {
	readonly kind: "needs_decision";
	readonly decisionId: string;
	readonly question: string;
	readonly options: string[];
	readonly recommendation: string;
	readonly evidenceIds: string[];
	readonly decisionSummary?: string;
}

export interface DeepNeedsDiscoveryResult {
	readonly kind: "needs_discovery";
	readonly decisionSummary?: string;
}

export type DeepResult = DeepCompletedResult | DeepNeedsDecisionResult | DeepNeedsDiscoveryResult;

export interface ForgeSessionState {
	beginGrill(decisionSummary?: string): ForgeUiState;
	beginIntent(decisionSummary?: string): ForgeUiState;
	beginLightDiscovery(decisionSummary?: string): ForgeUiState;
	beginDeepKnowledge(decisionSummary?: string, phase?: DeepAttemptPhase): ForgeUiState;
	cancelDeepKnowledge(): ForgeUiState;
	completeDeepKnowledge(
		evidenceIds: string[],
		decisionSummary: string | undefined,
		identity: DeepAttemptIdentity,
	): DeepCallResult;
	retryDeepKnowledge(decisionSummary?: string): ForgeUiState;
	completeDeepRetrieval(
		inheritedEvidence: readonly EvidenceInput[],
		decisionSummary: string | undefined,
		identity: DeepAttemptIdentity,
	): DeepCallResult;
	confirm(): ForgeUiState;
		current(): ForgeUiState;
		currentDeepAttempt(): DeepAttemptIdentity | undefined;
		continueGrillRound(): GrillRound;
		retryGrillRound(): GrillRound | undefined;
		getDeepSupplementalEvidenceIds(): ReadonlySet<string>;
		getDeepSupplementalEvidence(): readonly EvidenceInput[];
	getFetchedEvidenceIds(): ReadonlySet<string>;
	getLockedDeepEvidence(): LockedDeepEvidence | undefined;
	getHumanDecisions(): readonly EvidenceDecision[];
	getKnowledgeUnderstandingPackage(): EvidencePackage | undefined;
		handleDeepResult(identity: DeepAttemptIdentity, result: DeepResult): DeepCallResult;
	isFirstGrillRoundOfSnapshot(): boolean;
	recordCompletionOmission(): boolean;
	recordDeepSupplementalEvidence(
			identity: DeepAttemptIdentity,
			evidenceId: string,
			evidence?: EvidenceInput,
		): DeepCallResult;
			consumeDeepSearchBudget(identity: DeepAttemptIdentity): "accepted" | "stale" | "limit";
			reserveDeepSearchBudget(identity: DeepAttemptIdentity): "reserved" | "stale" | "limit";
			commitDeepSearchBudget(identity: DeepAttemptIdentity): "accepted" | "stale";
			releaseDeepSearchBudget(identity: DeepAttemptIdentity): "released" | "stale";
	recordEvidenceFetch(candidateId: string): void;
	recordAnswer(answer: string): ForgeUiState;
	reset(): ForgeUiState;
	requireGrillResult(payload: WaitUserPayload): ForgeUiState;
	reject(selection?: string): ForgeUiState;
	requireWaitUser(payload: WaitUserPayload): ForgeUiState;
	startGrillRound(request: string, snapshot: GrillEvidenceSnapshot): GrillRound;
}

function copyEvidenceInput(evidence: EvidenceInput): EvidenceInput {
	return { ...evidence, metadata: { ...evidence.metadata } };
}

export function createForgeSessionState(): ForgeSessionState {
		const answeredDecisionKeys = new Set<string>();
		const humanDecisions = new Map<string, EvidenceDecision>();
	const deepSupplementalEvidenceIds = new Set<string>();
	const deepSupplementalEvidence = new Map<string, EvidenceInput>();
	const fetchedEvidenceIds = new Set<string>();
		let currentGrillRound: GrillRound | undefined;
		let orchestrator: Orchestrator | undefined;
	let nextRoundId = 1;
	let nextDeepAttemptId = 1;
		let deepAttempt: DeepAttemptIdentity | undefined;
		let needsDiscoveryCount = 0;
		let deepSearchBudgetRoundId: string | undefined;
		let deepSearchCount = 0;
		const deepSearchReservations = new Map<string, number>();
	let deepRetryPhase: DeepAttemptPhase | undefined;
	let resumableDeepPhase: DeepAttemptPhase | undefined;
	let lockedDeepEvidence: LockedDeepEvidence | undefined;
	let knowledgeUnderstandingPackage: EvidencePackage | undefined;
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
		beginDeepKnowledge(decisionSummary, phase: DeepAttemptPhase = "DEEP_KNOWLEDGE_RETRIEVAL") {
			if (!currentGrillRound) {
				throw new Error("Deep Knowledge 需要目前的 Grill 回合。");
			}

			orchestrator =
				!orchestrator || orchestrator.getStage() === "RECEIVE"
					? createOrchestrator({ initialStage: phase })
					: orchestrator;
			uiState = {
				...uiState,
				decisionSummary: decisionSummary ?? uiState.decisionSummary,
					stage: orchestrator.getStage() === phase ? phase : orchestrator.transitionTo(phase),
				waitUser: undefined,
			};
		deepAttempt = Object.freeze({
			attemptId: `deep-${nextDeepAttemptId++}`,
			sourceRoundId: currentGrillRound.roundId,
			phase,
		});
		deepSearchReservations.clear();
		deepRetryPhase = undefined;
		resumableDeepPhase = undefined;
		return uiState;
	},
	completeDeepRetrieval(inheritedEvidence, decisionSummary, identity) {
		const supplemental = [...deepSupplementalEvidence.values()];
		const result = this.completeDeepKnowledge(
			[...inheritedEvidence, ...supplemental].map((evidence) => evidence.evidenceId),
			decisionSummary,
			identity,
		);
		if (result.kind === "accepted") {
			lockedDeepEvidence = Object.freeze({
				inherited: Object.freeze(inheritedEvidence.map(copyEvidenceInput)),
				supplemental: Object.freeze(supplemental.map(copyEvidenceInput)),
			});
		}
		return result;
	},
			cancelDeepKnowledge() {
				const phase = deepAttempt?.phase ?? deepRetryPhase ?? (uiState.stage === "KNOWLEDGE_UNDERSTANDING" ? "KNOWLEDGE_UNDERSTANDING" : "DEEP_KNOWLEDGE_RETRIEVAL");
				deepAttempt = undefined;
				deepRetryPhase = undefined;
				needsDiscoveryCount = 0;
				knowledgeUnderstandingPackage = undefined;
				resumableDeepPhase = phase;
			orchestrator = createOrchestrator({ initialStage: phase });
			uiState = { ...uiState, stage: phase, waitUser: undefined };
			return uiState;
		},
		retryDeepKnowledge(decisionSummary) {
			if (!currentGrillRound) return uiState;
			const phase = deepRetryPhase ?? resumableDeepPhase;
			if (!phase) return uiState;
			orchestrator = createOrchestrator({ initialStage: phase });
			uiState = { ...uiState, decisionSummary: decisionSummary ?? uiState.decisionSummary, stage: phase, waitUser: undefined };
				deepAttempt = Object.freeze({
					attemptId: `deep-${nextDeepAttemptId++}`,
					sourceRoundId: currentGrillRound.roundId,
					phase,
				});
				deepSearchReservations.clear();
			deepRetryPhase = undefined;
			resumableDeepPhase = undefined;
			return uiState;
		},
		completeDeepKnowledge(evidenceIds, decisionSummary, identity) {
			if (
				!deepAttempt ||
				deepAttempt.attemptId !== identity.attemptId ||
				deepAttempt.sourceRoundId !== identity.sourceRoundId ||
				deepAttempt.phase !== identity.phase
			) {
				return { kind: "stale", expected: deepAttempt, received: identity };
			}

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
			deepAttempt = Object.freeze({ ...deepAttempt, phase: "KNOWLEDGE_UNDERSTANDING" });
			return { kind: "accepted", state: uiState, identity: deepAttempt };
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
		currentDeepAttempt() {
			return deepAttempt;
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
		getDeepSupplementalEvidenceIds() {
			return new Set(deepSupplementalEvidenceIds);
		},
		getDeepSupplementalEvidence() {
			return [...deepSupplementalEvidence.values()].map(copyEvidenceInput);
		},
	getFetchedEvidenceIds() {
		return new Set(fetchedEvidenceIds);
	},
		getLockedDeepEvidence() {
			return lockedDeepEvidence;
		},
		getHumanDecisions() {
			return [...humanDecisions.values()].map(copyEvidenceDecision);
		},
		getKnowledgeUnderstandingPackage() {
			return knowledgeUnderstandingPackage;
		},
		handleDeepResult(identity, result) {
			if (result.kind === "needs_decision") {
				if (
					!deepAttempt ||
					deepAttempt.attemptId !== identity.attemptId ||
					deepAttempt.sourceRoundId !== identity.sourceRoundId ||
					deepAttempt.phase !== identity.phase
				) {
					return { kind: "stale", expected: deepAttempt, received: identity };
				}

				orchestrator = ensureOrchestrator(orchestrator);
				uiState = {
					...uiState,
					decisionSummary: result.decisionSummary ?? uiState.decisionSummary,
					lastEvidenceIds: result.evidenceIds,
					stage: orchestrator.transitionTo("WAIT_USER"),
					waitUser: {
						kind: "deep_decision",
						roundId: identity.attemptId,
						decisionId: result.decisionId,
						evidenceIds: result.evidenceIds,
						options: result.options,
						question: result.question,
						recommendation: result.recommendation,
					},
				};
				deepRetryPhase = identity.phase;
				deepAttempt = undefined;
				return { kind: "accepted", state: uiState, identity };
			}

			if (result.kind === "needs_discovery") {
				if (
					!deepAttempt ||
					deepAttempt.attemptId !== identity.attemptId ||
					deepAttempt.sourceRoundId !== identity.sourceRoundId ||
					deepAttempt.phase !== identity.phase
				) {
					return { kind: "stale", expected: deepAttempt, received: identity };
				}

				orchestrator = ensureOrchestrator(orchestrator);
				needsDiscoveryCount += 1;
				if (needsDiscoveryCount >= 2) {
					uiState = {
						...uiState,
						decisionSummary: result.decisionSummary ?? uiState.decisionSummary,
						stage: orchestrator.transitionTo("WAIT_USER"),
						waitUser: {
							kind: "deep_discovery_fallback",
							roundId: identity.sourceRoundId,
							decisionId: `${identity.attemptId}-deep-discovery-fallback`,
							evidenceIds: [...fetchedEvidenceIds],
							options: ["確認", "同意"],
							question: "此專案資料來源不足，將以前次grill/ 資料來源所得之證據進行後續開發，請確認",
							recommendation: "確認",
						},
					};
					deepAttempt = undefined;
					return { kind: "accepted", state: uiState, identity };
				}
				uiState = {
					...uiState,
					decisionSummary: result.decisionSummary ?? uiState.decisionSummary,
					stage: orchestrator.transitionTo("LIGHT_DISCOVERY"),
					waitUser: undefined,
				};
				deepAttempt = undefined;
				return { kind: "accepted", state: uiState, identity };
			}

			if (identity.phase === "DEEP_KNOWLEDGE_RETRIEVAL") {
				if (!("evidenceIds" in result) || !result.evidenceIds) {
					return { kind: "invalid", state: uiState, errors: ["Deep Retrieval 完成結果缺少 evidenceIds"] };
				}
				return this.completeDeepKnowledge(result.evidenceIds, result.decisionSummary, identity);
			}

			if (
				!deepAttempt ||
				deepAttempt.attemptId !== identity.attemptId ||
				deepAttempt.sourceRoundId !== identity.sourceRoundId ||
				deepAttempt.phase !== identity.phase
			) {
				return { kind: "stale", expected: deepAttempt, received: identity };
			}
			if (!("evidencePackage" in result) || !result.evidencePackage) {
				return { kind: "invalid", state: uiState, errors: ["Knowledge Understanding 完成結果缺少 Evidence Package"] };
			}
			const validation = validateEvidencePackage(result.evidencePackage);
			if (!validation.ok) {
				return { kind: "invalid", state: uiState, errors: validation.errors };
			}

		orchestrator = ensureOrchestrator(orchestrator);
		const previousPackage = knowledgeUnderstandingPackage;
		knowledgeUnderstandingPackage = result.evidencePackage;
		const nextStage = (() => {
			try {
				return orchestrator.transitionTo("CONTEXT_BUILD");
			} catch (error) {
				knowledgeUnderstandingPackage = previousPackage;
				throw error;
			}
		})();
			uiState = {
				...uiState,
				lastEvidenceIds: [...result.evidencePackage.evidenceIds],
				stage: nextStage,
				waitUser: undefined,
			};
			deepAttempt = undefined;
			return { kind: "accepted", state: uiState, identity };
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
		recordDeepSupplementalEvidence(identity, evidenceId, evidence) {
				if (
					!deepAttempt ||
					deepAttempt.attemptId !== identity.attemptId ||
					deepAttempt.sourceRoundId !== identity.sourceRoundId ||
					deepAttempt.phase !== identity.phase
				) {
					return { kind: "stale", expected: deepAttempt, received: identity };
				}

				const existing = deepSupplementalEvidence.get(evidenceId);
				if (existing) {
					if (evidence && existing.content === evidence.content) {
						return { kind: "accepted", state: uiState, identity: deepAttempt };
					}
					throw new Error("evidence_id_content_conflict");
				}

		deepSupplementalEvidenceIds.add(evidenceId);
		if (evidence) {
			deepSupplementalEvidence.set(evidenceId, copyEvidenceInput(evidence));
		}
			return { kind: "accepted", state: uiState, identity: deepAttempt };
			},
			consumeDeepSearchBudget(identity) {
				const reservation = this.reserveDeepSearchBudget(identity);
				if (reservation === "stale") return "stale";
				if (reservation === "limit") return "limit";
				return this.commitDeepSearchBudget(identity);
			},
			reserveDeepSearchBudget(identity) {
					if (
					!deepAttempt ||
					deepAttempt.attemptId !== identity.attemptId ||
					deepAttempt.sourceRoundId !== identity.sourceRoundId ||
					deepAttempt.phase !== identity.phase ||
					!currentGrillRound ||
					currentGrillRound.roundId !== identity.sourceRoundId
				) {
					return "stale";
				}
					if (deepSearchBudgetRoundId !== identity.sourceRoundId) {
						deepSearchBudgetRoundId = identity.sourceRoundId;
						deepSearchCount = 0;
						deepSearchReservations.clear();
					}
					const reservationKey = `${identity.attemptId}:${identity.sourceRoundId}:${identity.phase}`;
					if (
						!deepSearchReservations.has(reservationKey) &&
						deepSearchCount + [...deepSearchReservations.values()].reduce((total, count) => total + count, 0) >=
							DEEP_SEARCH_MAX_PER_SOURCE_ROUND
					)
						return "limit";
					deepSearchReservations.set(reservationKey, (deepSearchReservations.get(reservationKey) ?? 0) + 1);
					return "reserved";
				},
			commitDeepSearchBudget(identity) {
					if (
						!deepAttempt ||
						deepAttempt.attemptId !== identity.attemptId ||
						deepAttempt.sourceRoundId !== identity.sourceRoundId ||
						deepAttempt.phase !== identity.phase ||
						!currentGrillRound ||
						currentGrillRound.roundId !== identity.sourceRoundId
					)
						return "stale";
					const reservationKey = `${identity.attemptId}:${identity.sourceRoundId}:${identity.phase}`;
					const reservations = deepSearchReservations.get(reservationKey) ?? 0;
					if (reservations > 0) {
						if (reservations === 1) deepSearchReservations.delete(reservationKey);
						else deepSearchReservations.set(reservationKey, reservations - 1);
						deepSearchCount += 1;
					}
					return "accepted";
				},
				releaseDeepSearchBudget(identity) {
					if (
						!deepAttempt ||
						deepAttempt.attemptId !== identity.attemptId ||
						deepAttempt.sourceRoundId !== identity.sourceRoundId ||
						deepAttempt.phase !== identity.phase ||
						!currentGrillRound ||
						currentGrillRound.roundId !== identity.sourceRoundId
					)
						return "stale";
					const reservationKey = `${identity.attemptId}:${identity.sourceRoundId}:${identity.phase}`;
					const reservations = deepSearchReservations.get(reservationKey) ?? 0;
					if (reservations === 1) deepSearchReservations.delete(reservationKey);
					else if (reservations > 1) deepSearchReservations.set(reservationKey, reservations - 1);
					return "released";
				},
				recordEvidenceFetch(candidateId) {
			if (!currentGrillRound) {
				throw new Error("目前沒有可讀取證據的 Grill 回合。");
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
				if (uiState.waitUser.kind === "deep_discovery_fallback" && !["同意", "確認"].includes(answer.trim())) {
					return uiState;
				}
				const decisionId = uiState.waitUser.decisionId;
			const decisionKey = waitUserDecisionKey(uiState.waitUser);
			const isDeepDiscoveryFallback = uiState.waitUser.kind === "deep_discovery_fallback";
			const isRelevanceClarification = uiState.waitUser.kind === "relevance_clarification";
			if (answeredDecisionKeys.has(decisionKey)) {
				return uiState;
			}

			orchestrator.handleUserConfirmation();
			answeredDecisionKeys.add(decisionKey);
			if (!humanDecisions.has(decisionId)) {
				humanDecisions.set(
					decisionId,
					copyEvidenceDecision({
						decisionId,
						statement: `問題：${uiState.waitUser.question}；決定：${answer}`,
						evidenceIds: [...uiState.waitUser.evidenceIds],
					}),
				);
			}
			uiState = {
				...uiState,
				decisionSummary: `使用者已回答決策 ${JSON.stringify(decisionId)}：${JSON.stringify(answer)}。`,
					stage: isDeepDiscoveryFallback || isRelevanceClarification ? orchestrator.getStage() : orchestrator.transitionTo("GRILL"),
				waitUser: undefined,
			};
			return uiState;
		},
	reset() {
		answeredDecisionKeys.clear();
		humanDecisions.clear();
		deepSupplementalEvidenceIds.clear();
		deepSupplementalEvidence.clear();
		fetchedEvidenceIds.clear();
			currentGrillRound = undefined;
			deepSearchBudgetRoundId = undefined;
			deepSearchCount = 0;
			deepSearchReservations.clear();
			deepAttempt = undefined;
			needsDiscoveryCount = 0;
			deepRetryPhase = undefined;
		resumableDeepPhase = undefined;
		lockedDeepEvidence = undefined;
		knowledgeUnderstandingPackage = undefined;
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
				deepSearchBudgetRoundId = undefined;
				deepSearchCount = 0;
			const isFirstRoundOfSnapshot = currentGrillRound?.snapshot !== snapshot;
			deepAttempt = undefined;
		if (isFirstRoundOfSnapshot) {
			humanDecisions.clear();
			deepSupplementalEvidenceIds.clear();
			deepSupplementalEvidence.clear();
			fetchedEvidenceIds.clear();
			lockedDeepEvidence = undefined;
			knowledgeUnderstandingPackage = undefined;
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
