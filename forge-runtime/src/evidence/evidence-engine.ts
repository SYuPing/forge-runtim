export type EvidenceOrigin = "grill" | "deep_retrieval" | "human_premise";

export interface EvidenceInput {
	evidenceId: string;
	kind: string;
	source: string;
	title: string;
	content: string;
	metadata: Record<string, unknown>;
}

export interface Evidence extends EvidenceInput {
	origin: EvidenceOrigin;
}

export interface EvidenceDecision {
	decisionId: string;
	statement: string;
	evidenceIds: string[];
}

export interface EvidenceFinding {
	statement: string;
	evidenceIds: string[];
}

export interface EvidenceLimitation {
	statement: string;
	blocking: boolean;
}

export interface EvidencePackage {
	evidence: Evidence[];
	decisions: EvidenceDecision[];
	findings: EvidenceFinding[];
	limitations: EvidenceLimitation[];
}

export interface EvidencePackageInput {
	inherited: EvidenceInput[];
	supplemental: EvidenceInput[];
	humanPremise?: EvidenceInput[];
	decisions: EvidenceDecision[];
	findings: EvidenceFinding[];
	limitations: EvidenceLimitation[];
}

export type EvidencePackageValidationResult = { ok: true } | { ok: false; errors: string[] };

export const EVIDENCE_PACKAGE_MAX_ITEMS = 50;
export const EVIDENCE_PACKAGE_MAX_STATEMENT_CODE_POINTS = 4000;

export function createEvidencePackage(input: EvidencePackageInput): EvidencePackage {
	return {
		evidence: [
			...input.inherited.map((evidence) => ({ ...evidence, origin: "grill" as const })),
			...input.supplemental.map((evidence) => ({ ...evidence, origin: "deep_retrieval" as const })),
			...(input.humanPremise ?? []).map((evidence) => ({ ...evidence, origin: "human_premise" as const })),
		],
		decisions: input.decisions,
		findings: input.findings,
		limitations: input.limitations,
	};
}

export function validateEvidencePackage(evidencePackage: EvidencePackage): EvidencePackageValidationResult {
	const evidenceIds = new Set<string>();
	const evidenceOrigins = new Map<string, EvidenceOrigin>();

	for (const [label, items] of [
		["決策（Decision）", evidencePackage.decisions],
		["發現（Finding）", evidencePackage.findings],
		["限制（Limitation）", evidencePackage.limitations],
	] as const) {
		if (items.length > EVIDENCE_PACKAGE_MAX_ITEMS) {
			return { ok: false, errors: [`${label} 數量超過上限 ${EVIDENCE_PACKAGE_MAX_ITEMS}`] };
		}
	}

	for (const [label, items] of [
		["決策（Decision）", evidencePackage.decisions],
		["發現（Finding）", evidencePackage.findings],
		["限制（Limitation）", evidencePackage.limitations],
	] as const) {
		for (const item of items) {
			if (Array.from(item.statement).length > EVIDENCE_PACKAGE_MAX_STATEMENT_CODE_POINTS) {
				return {
					ok: false,
					errors: [`${label} 內容超過 ${EVIDENCE_PACKAGE_MAX_STATEMENT_CODE_POINTS} 個 Unicode 字元`],
				};
			}
		}
	}

	for (const evidence of evidencePackage.evidence) {
		if (evidenceIds.has(evidence.evidenceId)) {
			return { ok: false, errors: [`Evidence ID 重複：${evidence.evidenceId}`] };
		}

		evidenceIds.add(evidence.evidenceId);
		evidenceOrigins.set(evidence.evidenceId, evidence.origin);
	}

	for (const finding of evidencePackage.findings) {
		if (finding.evidenceIds.length === 0) {
			return { ok: false, errors: ["Finding 至少需要一個 Evidence ID"] };
		}

		const unknownEvidenceId = finding.evidenceIds.find((evidenceId) => !evidenceIds.has(evidenceId));

		if (unknownEvidenceId) {
			return { ok: false, errors: [`Finding 引用不存在的 Evidence ID：${unknownEvidenceId}`] };
		}

		if (
			finding.evidenceIds.length > 0 &&
			finding.evidenceIds.every((evidenceId) => evidenceOrigins.get(evidenceId) === "human_premise") &&
			!finding.statement.startsWith("推論：")
		) {
			return { ok: false, errors: ["Finding 僅引用 human_premise 時，內容必須以「推論：」開頭"] };
		}
	}

	for (const decision of evidencePackage.decisions) {
		const unknownEvidenceId = decision.evidenceIds.find((evidenceId) => !evidenceIds.has(evidenceId));

		if (unknownEvidenceId) {
			return { ok: false, errors: [`Decision 引用不存在的 Evidence ID：${unknownEvidenceId}`] };
		}
	}

	const decisionIds = new Set<string>();

	for (const decision of evidencePackage.decisions) {
		if (decisionIds.has(decision.decisionId)) {
			return { ok: false, errors: [`決策 ID 重複：${decision.decisionId}`] };
		}

		decisionIds.add(decision.decisionId);
	}

	const blockingLimitation = evidencePackage.limitations.find((limitation) => limitation.blocking);

	if (blockingLimitation) {
		return { ok: false, errors: [`存在阻擋性問題：${blockingLimitation.statement}`] };
	}

	return { ok: true };
}
