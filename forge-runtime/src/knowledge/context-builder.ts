import type { LightDiscoveryEvidence } from "./discovery-engine.ts";
import type { EvidencePackage } from "../evidence/evidence-engine.ts";

export interface ContextItem extends LightDiscoveryEvidence {
	statement: string;
}

export interface ContextBuilderRequest {
	readonly evidence: readonly LightDiscoveryEvidence[];
	readonly knowledgeUnderstanding: EvidencePackage;
}

export interface ContextBuildResult {
	readonly items: readonly ContextItem[];
	readonly knowledgeUnderstanding: EvidencePackage;
}

export interface ContextGlossaryEntry {
	readonly term: string;
	readonly definition: string;
	readonly evidenceIds: readonly string[];
}

export interface ContextCandidate {
	readonly glossary: readonly ContextGlossaryEntry[];
}

export interface ContextBuildIdentity {
	readonly attemptId: string;
	readonly sourceRoundId: string;
}

export interface ContextAmbiguity {
	readonly decisionId: string;
	readonly question: string;
	readonly options: readonly string[];
	readonly recommendation: string;
	readonly evidenceIds: readonly string[];
}

export type ContextBuildCompletion =
	| Readonly<{
			kind: "completed";
			candidate: ContextCandidate;
	  }>
	| Readonly<{
			kind: "ambiguous";
			ambiguity: ContextAmbiguity;
	  }>;

export function freezeContextCandidate(candidate: ContextCandidate): ContextCandidate {
	return Object.freeze({
		glossary: Object.freeze(
			candidate.glossary.map((entry) =>
				Object.freeze({
					...entry,
					evidenceIds: Object.freeze([...entry.evidenceIds]),
				}),
			),
		),
	});
}

export function validateContextCandidate(
	candidate: ContextCandidate,
	evidenceIds: readonly string[],
): { ok: true } | { ok: false; errors: string[] } {
	if (!candidate || !Array.isArray(candidate.glossary)) {
		return { ok: false, errors: ["Context candidate 缺少 glossary"] };
	}

	const knownEvidenceIds = new Set(evidenceIds);
	const errors: string[] = [];
	for (const entry of candidate.glossary) {
		if (typeof entry?.term !== "string" || entry.term.trim().length === 0) {
			errors.push("Context glossary term 不得為空");
		}
		if (typeof entry?.definition !== "string" || entry.definition.trim().length === 0) {
			errors.push("Context glossary definition 不得為空");
		}
		if (!Array.isArray(entry?.evidenceIds) || entry.evidenceIds.length === 0) {
			errors.push(`Context glossary ${JSON.stringify(entry?.term ?? "unknown")} 缺少 Evidence ID`);
			continue;
		}
		for (const evidenceId of entry.evidenceIds) {
			if (!knownEvidenceIds.has(evidenceId)) {
				errors.push(`Context glossary 引用不存在的 Evidence ID：${evidenceId}`);
			}
		}
	}

	return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function validateContextAmbiguity(
	ambiguity: ContextAmbiguity,
	evidenceIds: readonly string[],
): { ok: true } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	if (typeof ambiguity?.decisionId !== "string" || ambiguity.decisionId.trim().length === 0) {
		errors.push("Context ambiguity decisionId 不得為空");
	}
	if (typeof ambiguity?.question !== "string" || ambiguity.question.trim().length === 0) {
		errors.push("Context ambiguity question 不得為空");
	}
	if (
		!Array.isArray(ambiguity?.options) ||
		ambiguity.options.length < 2 ||
		ambiguity.options.some((option) => typeof option !== "string" || option.trim().length === 0)
	) {
		errors.push("Context ambiguity 至少需要兩個非空選項");
	}
	if (
		typeof ambiguity?.recommendation !== "string" ||
		ambiguity.recommendation.trim().length === 0 ||
		!Array.isArray(ambiguity.options) ||
		!ambiguity.options.includes(ambiguity.recommendation)
	) {
		errors.push("Context ambiguity recommendation 必須是其中一個選項");
	}
	if (!Array.isArray(ambiguity?.evidenceIds) || ambiguity.evidenceIds.length === 0) {
		errors.push("Context ambiguity 缺少 Evidence ID");
	} else {
		const knownEvidenceIds = new Set(evidenceIds);
		for (const evidenceId of ambiguity.evidenceIds) {
			if (!knownEvidenceIds.has(evidenceId)) {
				errors.push(`Context ambiguity 引用不存在的 Evidence ID：${evidenceId}`);
			}
		}
	}

	return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export async function buildContextItems(request: ContextBuilderRequest): Promise<ContextBuildResult> {
	return {
		items: request.evidence.map((item) => ({
			evidenceId: item.evidenceId,
			source: item.source,
			statement: item.summary,
			summary: item.summary,
			title: item.title,
		})),
		knowledgeUnderstanding: request.knowledgeUnderstanding,
	};
}
