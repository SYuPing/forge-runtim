import { createHash } from "node:crypto";

import { createOrchestrator, type Orchestrator } from "../workflow/orchestrator.ts";
import { createForgeUiState, type ForgeUiState, type WaitUserState } from "../ui/ui-state.ts";
import {
	validateEvidencePackage,
	type EvidenceDecision,
	type EvidenceInput,
	type EvidencePackage,
} from "../evidence/evidence-engine.ts";
import {
	freezeContextCandidate,
	validateContextAmbiguity,
	validateContextCandidate,
	type ContextBuildCompletion,
	type ContextBuildIdentity,
	type ContextCandidate,
	type ContextAmbiguity,
} from "../knowledge/context-builder.ts";
import {
	freezeAdrBuildCandidate,
	validateAdrBuildCandidate,
	type AdrBuildCandidate,
	type AdrBuildIdentity,
} from "../decision/adr-builder.ts";
import type { CommitDocumentsResult } from "../artifacts/documents-writer.ts";

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
const GRILL_ANSWER_CHECKPOINT = 8;

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

export type ContextBuildCallResult =
	| {
			readonly kind: "accepted";
			readonly state: ForgeUiState;
			readonly identity: ContextBuildIdentity;
	  }
	| {
			readonly kind: "ambiguous";
			readonly state: ForgeUiState;
			readonly identity: ContextBuildIdentity;
	  }
	| {
			readonly kind: "stale";
			readonly expected?: ContextBuildIdentity;
			readonly received: ContextBuildIdentity;
	  }
	| {
			readonly kind: "invalid";
			readonly state: ForgeUiState;
			readonly errors: readonly string[];
	  };

export type AdrBuildCallResult =
	| {
			readonly kind: "accepted";
			readonly state: ForgeUiState;
			readonly identity: AdrBuildIdentity;
	  }
	| {
			readonly kind: "ambiguous";
			readonly state: ForgeUiState;
			readonly identity: AdrBuildIdentity;
	  }
	| {
			readonly kind: "stale";
			readonly expected?: AdrBuildIdentity;
			readonly received: AdrBuildIdentity;
	  }
	| {
			readonly kind: "invalid";
			readonly state: ForgeUiState;
			readonly errors: readonly string[];
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
	completeContextBuild(identity: ContextBuildIdentity, completion: ContextBuildCompletion): ContextBuildCallResult;
	confirm(): ForgeUiState;
		current(): ForgeUiState;
		currentContextBuildAttempt(): ContextBuildIdentity | undefined;
		currentAdrBuildAttempt(): AdrBuildIdentity | undefined;
		currentDeepAttempt(): DeepAttemptIdentity | undefined;
		continueGrillRound(): GrillRound;
		retryGrillRound(): GrillRound | undefined;
		getDeepSupplementalEvidenceIds(): ReadonlySet<string>;
		getDeepSupplementalEvidence(): readonly EvidenceInput[];
	getFetchedEvidenceIds(): ReadonlySet<string>;
	getLockedDeepEvidence(): LockedDeepEvidence | undefined;
	getHumanDecisions(): readonly EvidenceDecision[];
	getHumanPremises(): readonly EvidenceInput[];
	getContextCandidate(): ContextCandidate | undefined;
	getAdrBuildCandidate(): AdrBuildCandidate | undefined;
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
	prepareAdrBuild(identity: AdrBuildIdentity, candidate: AdrBuildCandidate): AdrBuildCallResult;
	requireAdrDecision(identity: AdrBuildIdentity, ambiguity: ContextAmbiguity): AdrBuildCallResult;
	finalizeAdrBuild(identity: AdrBuildIdentity, commit: CommitDocumentsResult): AdrBuildCallResult;
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
	const humanPremises = new Map<string, EvidenceInput>();
	const deepSupplementalEvidenceIds = new Set<string>();
	const deepSupplementalEvidence = new Map<string, EvidenceInput>();
	const fetchedEvidenceIds = new Set<string>();
			let currentGrillRound: GrillRound | undefined;
			let grillAcceptedAnswerCount = 0;
			let continueGrillCheckpointPending = false;
			let orchestrator: Orchestrator | undefined;
	let nextRoundId = 1;
	let nextDeepAttemptId = 1;
	let nextContextBuildAttemptId = 1;
	let nextAdrBuildAttemptId = 1;
		let deepAttempt: DeepAttemptIdentity | undefined;
	let contextBuildAttempt: ContextBuildIdentity | undefined;
	let adrBuildAttempt: AdrBuildIdentity | undefined;
	let adrBuildCandidate: AdrBuildCandidate | undefined;
	let contextCandidate: ContextCandidate | undefined;
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
		currentContextBuildAttempt() {
			return contextBuildAttempt ? { ...contextBuildAttempt } : undefined;
		},
		currentAdrBuildAttempt() {
			return adrBuildAttempt ? { ...adrBuildAttempt } : undefined;
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
		getHumanPremises() {
			return [...humanPremises.values()].map(copyEvidenceInput);
		},
		getContextCandidate() {
			return contextCandidate;
		},
		getAdrBuildCandidate() {
			return adrBuildCandidate;
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
							options: ["確認", "取消"],
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
			contextBuildAttempt = {
				attemptId: `context-${nextContextBuildAttemptId++}`,
				sourceRoundId: identity.sourceRoundId,
			};
			uiState = {
				...uiState,
				lastEvidenceIds: [...result.evidencePackage.evidenceIds],
				stage: nextStage,
				waitUser: undefined,
			};
			deepAttempt = undefined;
			return { kind: "accepted", state: uiState, identity };
		},
		completeContextBuild(identity, completion) {
			if (
				!contextBuildAttempt ||
				contextBuildAttempt.attemptId !== identity.attemptId ||
				contextBuildAttempt.sourceRoundId !== identity.sourceRoundId
			) {
				return { kind: "stale", expected: contextBuildAttempt, received: identity };
			}
			if (!orchestrator || orchestrator.getStage() !== "CONTEXT_BUILD") {
				return { kind: "invalid", state: uiState, errors: ["Context Build completion 不合法"] };
			}
			if (!knowledgeUnderstandingPackage) {
				return { kind: "invalid", state: uiState, errors: ["Context Build 缺少 Knowledge Package"] };
			}
			if (completion.kind === "ambiguous") {
				const ambiguity = completion.ambiguity;
				const validation = validateContextAmbiguity(ambiguity, knowledgeUnderstandingPackage.evidenceIds);
				if (!validation.ok) {
					return { kind: "invalid", state: uiState, errors: validation.errors };
				}
				uiState = {
					...uiState,
					lastEvidenceIds: [...ambiguity.evidenceIds],
					stage: orchestrator.transitionTo("WAIT_USER"),
					waitUser: {
						kind: "context_ambiguity",
						roundId: identity.sourceRoundId,
						decisionId: ambiguity.decisionId,
						evidenceIds: [...ambiguity.evidenceIds],
						options: [...ambiguity.options],
						question: ambiguity.question,
						recommendation: ambiguity.recommendation,
					},
				};
				contextBuildAttempt = undefined;
				return { kind: "ambiguous", state: uiState, identity };
			}
			const validation = validateContextCandidate(completion.candidate, knowledgeUnderstandingPackage.evidenceIds);
			if (!validation.ok) {
				return { kind: "invalid", state: uiState, errors: validation.errors };
			}

			const candidate = freezeContextCandidate(completion.candidate);
			const previousCandidate = contextCandidate;
			contextCandidate = candidate;
			const nextStage = (() => {
				try {
					return orchestrator.transitionTo("ADR_BUILD");
				} catch (error) {
					contextCandidate = previousCandidate;
					throw error;
				}
			})();
			uiState = { ...uiState, stage: nextStage, waitUser: undefined };
			contextBuildAttempt = undefined;
			adrBuildAttempt = {
				attemptId: `adr-${nextAdrBuildAttemptId++}`,
				sourceRoundId: identity.sourceRoundId,
			};
			adrBuildCandidate = undefined;
			return { kind: "accepted", state: uiState, identity };
		},
		prepareAdrBuild(identity, candidate) {
			if (
				!adrBuildAttempt ||
				adrBuildAttempt.attemptId !== identity.attemptId ||
				adrBuildAttempt.sourceRoundId !== identity.sourceRoundId
			) {
				return { kind: "stale", expected: adrBuildAttempt, received: identity };
			}
			if (!orchestrator || orchestrator.getStage() !== "ADR_BUILD") {
				return { kind: "invalid", state: uiState, errors: ["ADR Build candidate 不合法"] };
			}
			if (!knowledgeUnderstandingPackage) {
				return { kind: "invalid", state: uiState, errors: ["ADR Build 缺少 Knowledge Package"] };
			}
			const validation = validateAdrBuildCandidate(candidate, knowledgeUnderstandingPackage.evidenceIds);
			if (!validation.ok) {
				return { kind: "invalid", state: uiState, errors: validation.errors };
			}

			adrBuildCandidate = freezeAdrBuildCandidate(candidate);
			return { kind: "accepted", state: uiState, identity };
		},
		requireAdrDecision(identity, ambiguity) {
			if (
				!adrBuildAttempt ||
				adrBuildAttempt.attemptId !== identity.attemptId ||
				adrBuildAttempt.sourceRoundId !== identity.sourceRoundId
			) {
				return { kind: "stale", expected: adrBuildAttempt, received: identity };
			}
			if (!orchestrator || orchestrator.getStage() !== "ADR_BUILD" || !knowledgeUnderstandingPackage) {
				return { kind: "invalid", state: uiState, errors: ["ADR Build ambiguity 不合法"] };
			}
			const validation = validateContextAmbiguity(ambiguity, knowledgeUnderstandingPackage.evidenceIds);
			if (!validation.ok) {
				return { kind: "invalid", state: uiState, errors: validation.errors };
			}

			uiState = {
				...uiState,
				lastEvidenceIds: [...ambiguity.evidenceIds],
				stage: orchestrator.transitionTo("WAIT_USER"),
				waitUser: {
					kind: "adr_ambiguity",
					roundId: identity.sourceRoundId,
					decisionId: ambiguity.decisionId,
					evidenceIds: [...ambiguity.evidenceIds],
					options: [...ambiguity.options],
					question: ambiguity.question,
					recommendation: ambiguity.recommendation,
				},
			};
			adrBuildAttempt = undefined;
			adrBuildCandidate = undefined;
			return { kind: "ambiguous", state: uiState, identity };
		},
		finalizeAdrBuild(identity, commit) {
			if (
				!adrBuildAttempt ||
				adrBuildAttempt.attemptId !== identity.attemptId ||
				adrBuildAttempt.sourceRoundId !== identity.sourceRoundId
			) {
				return { kind: "stale", expected: adrBuildAttempt, received: identity };
			}
			if (
				!orchestrator ||
				orchestrator.getStage() !== "ADR_BUILD" ||
				!adrBuildCandidate ||
				commit.kind !== "committed" ||
				!/^[a-f0-9]{64}$/.test(commit.baseHash)
			) {
				return { kind: "invalid", state: uiState, errors: ["ADR Build 尚未完成 Documents bundle commit"] };
			}

			uiState = { ...uiState, stage: orchestrator.transitionTo("TO_SPEC"), waitUser: undefined };
			adrBuildAttempt = undefined;
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
				const normalizedAnswer = answer.trim();
				if (normalizedAnswer.length === 0) {
					return uiState;
				}
					const pendingWaitUser = uiState.waitUser;
					if (
						(pendingWaitUser.kind === "grill_confirmation" || pendingWaitUser.kind === "grill_checkpoint") &&
						(!currentGrillRound || pendingWaitUser.roundId !== currentGrillRound.roundId)
					) {
						return uiState;
					}
					if (uiState.waitUser.kind === "deep_discovery_fallback" && !["同意", "確認"].includes(normalizedAnswer)) {
						return uiState;
					}
				const decisionId = uiState.waitUser.decisionId;
				const isGrillConfirmation = uiState.waitUser.kind === "grill_confirmation";
					const decisionKey = waitUserDecisionKey(uiState.waitUser);
					if (pendingWaitUser.kind === "grill_checkpoint") {
						if (normalizedAnswer !== "continue_one" && normalizedAnswer !== "converge") return uiState;
						orchestrator.handleUserConfirmation();
						continueGrillCheckpointPending = normalizedAnswer === "continue_one";
						uiState = { ...uiState, waitUser: undefined };
						return this.beginGrill();
					}
				const isDeepDiscoveryFallback = uiState.waitUser.kind === "deep_discovery_fallback";
			const isRelevanceClarification = uiState.waitUser.kind === "relevance_clarification";
			const isContextAmbiguity = uiState.waitUser.kind === "context_ambiguity";
			const isAdrAmbiguity = uiState.waitUser.kind === "adr_ambiguity";
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
			if (isGrillConfirmation && currentGrillRound) {
				const premiseContent = [
					`目標：${currentGrillRound.request}`,
					`問題：${pendingWaitUser.question}`,
					`回答：${normalizedAnswer}`,
				].join("\n");
				humanPremises.set(decisionKey, {
					evidenceId: `human-premise-${createHash("sha256")
						.update(
							[currentGrillRound.roundId, decisionId, currentGrillRound.request, pendingWaitUser.question, normalizedAnswer].join(
								"\u0000",
							),
						)
						.digest("hex")}`,
					kind: "human_premise",
					source: "forge://human-premise",
					title: "使用者前提",
					content: premiseContent,
					metadata: {
						roundId: currentGrillRound.roundId,
						decisionId,
					},
				});
			}
			if (isGrillConfirmation) {
				grillAcceptedAnswerCount += 1;
					if (grillAcceptedAnswerCount === GRILL_ANSWER_CHECKPOINT || continueGrillCheckpointPending) {
						const round = currentGrillRound;
					if (!round) throw new Error("Grill checkpoint requires an active round");
					orchestrator = createOrchestrator({ initialStage: "GRILL" });
					uiState = {
						...uiState,
						stage: orchestrator.handleGrillResult({ requiresUserConfirmation: true }),
						waitUser: {
							kind: "grill_checkpoint",
							roundId: round.roundId,
							decisionId: `grill-checkpoint-${round.roundId}`,
							evidenceIds: [...pendingWaitUser.evidenceIds],
							options: ["continue_one", "converge", "cancel"],
							question: "Grill 已完成 8 次使用者確認，請選擇下一步。",
							recommendation: "continue_one",
						},
					};
					continueGrillCheckpointPending = false;
					return uiState;
				}
			}
			if (isContextAmbiguity) {
				contextBuildAttempt = {
					attemptId: `context-${nextContextBuildAttemptId++}`,
					sourceRoundId: pendingWaitUser.roundId,
				};
				uiState = {
					...uiState,
					decisionSummary: `使用者已回答決策 ${JSON.stringify(decisionId)}：${JSON.stringify(answer)}。`,
					stage: orchestrator.transitionTo("CONTEXT_BUILD"),
					waitUser: undefined,
				};
				return uiState;
			}
			if (isAdrAmbiguity) {
				adrBuildAttempt = {
					attemptId: `adr-${nextAdrBuildAttemptId++}`,
					sourceRoundId: pendingWaitUser.roundId,
				};
				uiState = {
					...uiState,
					decisionSummary: `使用者已回答決策 ${JSON.stringify(decisionId)}：${JSON.stringify(answer)}。`,
					stage: orchestrator.transitionTo("ADR_BUILD"),
					waitUser: undefined,
				};
				return uiState;
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
		humanPremises.clear();
		deepSupplementalEvidenceIds.clear();
		deepSupplementalEvidence.clear();
		fetchedEvidenceIds.clear();
			currentGrillRound = undefined;
			grillAcceptedAnswerCount = 0;
			continueGrillCheckpointPending = false;
			deepSearchBudgetRoundId = undefined;
			deepSearchCount = 0;
			deepSearchReservations.clear();
			deepAttempt = undefined;
			needsDiscoveryCount = 0;
			deepRetryPhase = undefined;
		resumableDeepPhase = undefined;
		lockedDeepEvidence = undefined;
		knowledgeUnderstandingPackage = undefined;
		contextBuildAttempt = undefined;
		contextCandidate = undefined;
		adrBuildAttempt = undefined;
		adrBuildCandidate = undefined;
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
			if (orchestrator?.getStage() === "WAIT_USER") {
				orchestrator.handleUserConfirmation();
				orchestrator.transitionTo("GRILL");
			}
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
			if (answeredDecisionKeys.has(decisionKey) || humanDecisions.has(payload.decisionId)) {
				return uiState;
			}
			if (payload.roundId !== currentGrillRound?.roundId) {
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
			grillAcceptedAnswerCount = 0;
			continueGrillCheckpointPending = false;
			humanDecisions.clear();
			humanPremises.clear();
			deepSupplementalEvidenceIds.clear();
			deepSupplementalEvidence.clear();
			fetchedEvidenceIds.clear();
			lockedDeepEvidence = undefined;
			knowledgeUnderstandingPackage = undefined;
			contextBuildAttempt = undefined;
			contextCandidate = undefined;
			adrBuildAttempt = undefined;
			adrBuildCandidate = undefined;
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
