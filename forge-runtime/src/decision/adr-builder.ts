import type { ContextItem } from "../knowledge/context-builder.ts";

const OBVIOUS_SECRET_PATTERNS = [
	/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
	/\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token)\s*[:=]\s*\S+/i,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
	/\bsk-[A-Za-z0-9_-]{8,}/,
];

export interface AdrRecord {
	citations: string[];
	decision: string;
	rationale: string;
}

export interface BuildAdrRequest {
	contextItems: ContextItem[];
	decision: string;
	rationale: string;
}

export interface AdrBuildIdentity {
	readonly attemptId: string;
	readonly sourceRoundId: string;
}

export interface AdrCandidateRecord {
	readonly citations: readonly string[];
	readonly consequences: readonly string[];
	readonly decision: string;
	readonly rationale: string;
}

export interface HandoffCandidate {
	readonly summary: string;
	readonly nextSessionFocus: string;
	readonly references: readonly string[];
	readonly suggestedSkills: readonly string[];
}

export interface AdrBuildCandidate {
	readonly records: readonly AdrCandidateRecord[];
	readonly handoff: HandoffCandidate;
}

export function freezeAdrBuildCandidate(candidate: AdrBuildCandidate): AdrBuildCandidate {
	return Object.freeze({
		records: Object.freeze(
			candidate.records.map((record) =>
				Object.freeze({
					...record,
					consequences: Object.freeze([...record.consequences]),
					citations: Object.freeze([...record.citations]),
				}),
		),
		),
		handoff: Object.freeze({
			...candidate.handoff,
			references: Object.freeze([...candidate.handoff.references]),
			suggestedSkills: Object.freeze([...candidate.handoff.suggestedSkills]),
		}),
	});
}

export function validateAdrBuildCandidate(
	candidate: AdrBuildCandidate,
	evidenceIds: readonly string[],
): { ok: true } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	const knownEvidenceIds = new Set(evidenceIds);
	if (!candidate || !Array.isArray(candidate.records) || candidate.records.length === 0) {
		errors.push("ADR candidate 至少需要一筆決策");
	} else {
		for (const record of candidate.records) {
			if (typeof record?.decision !== "string" || record.decision.trim().length === 0) {
				errors.push("ADR decision 不得為空");
			}
			if (typeof record?.rationale !== "string" || record.rationale.trim().length === 0) {
				errors.push("ADR rationale 不得為空");
			}
			if (
				!Array.isArray(record?.consequences) ||
				record.consequences.length === 0 ||
				record.consequences.some(
					(consequence: unknown) => typeof consequence !== "string" || consequence.trim().length === 0,
				)
			) {
				errors.push(`ADR ${JSON.stringify(record?.decision ?? "unknown")} 缺少 consequence`);
			}
			if (!Array.isArray(record?.citations) || record.citations.length === 0) {
				errors.push(`ADR ${JSON.stringify(record?.decision ?? "unknown")} 缺少 Evidence ID`);
			} else {
				for (const evidenceId of record.citations) {
					if (!knownEvidenceIds.has(evidenceId)) {
						errors.push(`ADR 引用不存在的 Evidence ID：${evidenceId}`);
					}
				}
			}
		}
	}

	const handoff = candidate?.handoff;
	if (typeof handoff?.summary !== "string" || handoff.summary.trim().length === 0) {
		errors.push("handoff summary 不得為空");
	}
	if (typeof handoff?.nextSessionFocus !== "string" || handoff.nextSessionFocus.trim().length === 0) {
		errors.push("handoff nextSessionFocus 不得為空");
	}
	if (
		!Array.isArray(handoff?.references) ||
		!handoff.references.includes("Documents/CONTEXT.md") ||
		!handoff.references.includes("Documents/ADR.md")
	) {
		errors.push("handoff references 必須包含 Documents/CONTEXT.md 與 Documents/ADR.md");
	}
	if (
		!Array.isArray(handoff?.suggestedSkills) ||
		handoff.suggestedSkills.length === 0 ||
		handoff.suggestedSkills.some((skill) => typeof skill !== "string" || skill.trim().length === 0)
	) {
		errors.push("handoff 至少需要一個 suggested skill");
	}
	const handoffText = [
		handoff?.summary,
		handoff?.nextSessionFocus,
		...(Array.isArray(handoff?.references) ? handoff.references : []),
		...(Array.isArray(handoff?.suggestedSkills) ? handoff.suggestedSkills : []),
	]
		.filter((value): value is string => typeof value === "string")
		.join("\n");
	if (OBVIOUS_SECRET_PATTERNS.some((pattern) => pattern.test(handoffText))) {
		errors.push("handoff 包含疑似敏感資訊");
	}

	return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function buildAdrRecord(request: BuildAdrRequest): AdrRecord {
	return {
		citations: request.contextItems.map((item) => item.evidenceId),
		decision: request.decision,
		rationale: request.rationale,
	};
}
