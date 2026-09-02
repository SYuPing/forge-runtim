export type EvidenceOrigin = "grill" | "deep_retrieval" | "human_premise";

export interface EvidenceInput {
	readonly evidenceId: string;
	readonly kind: string;
	readonly source: string;
	readonly title: string;
	readonly content: string;
	readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Evidence extends EvidenceInput {
	readonly origin: EvidenceOrigin;
}

export interface EvidenceDecision {
	readonly decisionId: string;
	readonly statement: string;
	readonly evidenceIds: readonly string[];
}

export interface EvidenceFinding {
	readonly statement: string;
	readonly evidenceIds: readonly string[];
}

export type EvidenceVerificationLevel = "exploratory" | "black_box_verified" | "spec_verified";

export interface SpecGap {
	readonly target: string;
	readonly version?: string;
	readonly environment?: string;
	readonly scenarios?: readonly string[];
	readonly verifiedAt?: string;
	readonly reason: string;
	readonly missingEvidence: readonly string[];
	readonly impact: string;
}

export interface FormalSpecReference {
	readonly target: string;
	readonly version: string;
	readonly locator: string;
	readonly evidenceId: string;
}

export interface EvidenceLimitation {
	readonly statement: string;
	readonly blocking: boolean;
}

export interface EvidencePackage {
	/** 僅供人類閱讀的非權威摘要，不得新增主張或控制流程；正式事實以結構欄位與執行期產生的證據識別碼為準。 */
	readonly knowledgeSummary: string;
	readonly evidence: readonly Evidence[];
	readonly evidenceIds: readonly string[];
	readonly decisions: readonly EvidenceDecision[];
	readonly findings: readonly EvidenceFinding[];
	readonly limitations: readonly EvidenceLimitation[];
	readonly verificationLevel?: EvidenceVerificationLevel;
	readonly specGap?: SpecGap;
	readonly formalSpecReference?: FormalSpecReference;
}

export interface EvidencePackageInput {
	readonly inherited: readonly EvidenceInput[];
	readonly supplemental: readonly EvidenceInput[];
	readonly humanPremise?: readonly EvidenceInput[];
	readonly decisions: readonly EvidenceDecision[];
	readonly findings: readonly EvidenceFinding[];
	readonly limitations: readonly EvidenceLimitation[];
	readonly knowledgeSummary: string;
	readonly verificationLevel?: EvidenceVerificationLevel;
	readonly specGap?: SpecGap;
	readonly formalSpecReference?: FormalSpecReference;
}

export type EvidencePackageValidationResult = { ok: true } | { ok: false; errors: string[] };

export const EVIDENCE_PACKAGE_MAX_ITEMS = 50;
export const EVIDENCE_PACKAGE_MAX_STATEMENT_CODE_POINTS = 4000;

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
	if (value === null || typeof value !== "object" || seen.has(value)) return value;
	seen.add(value);
	for (const key of Reflect.ownKeys(value)) {
		deepFreeze(Reflect.get(value, key), seen);
	}
	return Object.freeze(value);
}

export function createEvidencePackage(input: EvidencePackageInput): EvidencePackage {
	const freezeEvidence = (item: EvidenceInput, origin: EvidenceOrigin): Evidence =>
		Object.freeze({ ...item, metadata: deepFreeze(structuredClone(item.metadata)), origin });
	const evidence = Object.freeze([
		...input.inherited.map((item) => freezeEvidence(item, "grill")),
		...input.supplemental.map((item) => freezeEvidence(item, "deep_retrieval")),
		...(input.humanPremise ?? []).map((item) => freezeEvidence(item, "human_premise")),
	]);
	const decisions = Object.freeze(
		input.decisions.map((item) => Object.freeze({ ...item, evidenceIds: Object.freeze([...item.evidenceIds]) })),
	);
	const findings = Object.freeze(
		input.findings.map((item) => Object.freeze({ ...item, evidenceIds: Object.freeze([...item.evidenceIds]) })),
	);
	const limitations = Object.freeze(input.limitations.map((item) => Object.freeze({ ...item })));
	const specGap = input.specGap
		? Object.freeze({
				...input.specGap,
				missingEvidence: Array.isArray(input.specGap.missingEvidence)
					? Object.freeze([...input.specGap.missingEvidence])
					: input.specGap.missingEvidence,
				...(input.specGap.scenarios !== undefined
					? {
							scenarios: Array.isArray(input.specGap.scenarios)
								? deepFreeze([...input.specGap.scenarios])
								: input.specGap.scenarios,
						}
					: {}),
			})
			: undefined;
	const formalSpecReference = input.formalSpecReference
		? Object.freeze({ ...input.formalSpecReference })
		: undefined;

	return Object.freeze({
		knowledgeSummary: input.knowledgeSummary,
		evidence,
		evidenceIds: Object.freeze(evidence.map((item) => item.evidenceId)),
		decisions,
		findings,
		limitations,
		...(input.verificationLevel ? { verificationLevel: input.verificationLevel } : {}),
		...(specGap ? { specGap } : {}),
		...(formalSpecReference ? { formalSpecReference } : {}),
	});
}

export function validateEvidencePackage(evidencePackage: EvidencePackage): EvidencePackageValidationResult {
	const knowledgeSummary = evidencePackage.knowledgeSummary?.trim();
	if (!knowledgeSummary) {
		return { ok: false, errors: ["knowledgeSummary 不可為空白"] };
	}
	if (
		evidencePackage.verificationLevel !== undefined &&
		!(["exploratory", "black_box_verified", "spec_verified"] as const).includes(evidencePackage.verificationLevel)
	) {
		return { ok: false, errors: ["verificationLevel 不合法"] };
	}
		if (evidencePackage.verificationLevel !== undefined || evidencePackage.specGap !== undefined) {
			const specGap = evidencePackage.specGap;
			if (!specGap || typeof specGap !== "object") return { ok: false, errors: ["verificationLevel 需要完整 Spec Gap"] };
			if (!nonEmptyString(specGap.target)) return { ok: false, errors: ["Spec Gap target 不可為空白"] };
		if (!nonEmptyString(specGap.reason)) return { ok: false, errors: ["Spec Gap reason 不可為空白"] };
		if (!nonEmptyString(specGap.impact)) return { ok: false, errors: ["Spec Gap impact 不可為空白"] };
		if (specGap.version !== undefined && !nonEmptyString(specGap.version)) {
			return { ok: false, errors: ["Spec Gap version 不可為空白"] };
		}
		if (specGap.environment !== undefined && !nonEmptyString(specGap.environment)) {
			return { ok: false, errors: ["Spec Gap environment 不可為空白"] };
		}
		if (specGap.verifiedAt !== undefined && !nonEmptyString(specGap.verifiedAt)) {
			return { ok: false, errors: ["Spec Gap verifiedAt 不可為空白"] };
		}
			if (
				!Array.isArray(specGap.missingEvidence) ||
				specGap.missingEvidence.length === 0 ||
				specGap.missingEvidence.some((item) => !nonEmptyString(item))
			) {
				return { ok: false, errors: ["Spec Gap missingEvidence 不可為空白"] };
			}
			if (specGap.scenarios !== undefined && (!Array.isArray(specGap.scenarios) || specGap.scenarios.some((item) => typeof item !== "string"))) {
				return { ok: false, errors: ["Spec Gap scenarios 必須是字串陣列"] };
			}
			if (evidencePackage.verificationLevel === "black_box_verified") {
			if (!nonEmptyString(specGap.version)) return { ok: false, errors: ["black_box_verified 需要 Spec Gap version"] };
			if (!nonEmptyString(specGap.environment)) return { ok: false, errors: ["black_box_verified 需要 Spec Gap environment"] };
			if (
				!Array.isArray(specGap.scenarios) ||
				specGap.scenarios.length === 0 ||
				specGap.scenarios.some((item) => !nonEmptyString(item))
			) {
				return { ok: false, errors: ["black_box_verified 需要非空 Spec Gap scenarios"] };
			}
			if (!nonEmptyString(specGap.verifiedAt)) return { ok: false, errors: ["black_box_verified 需要 Spec Gap verifiedAt"] };
		}
	}
	if (evidencePackage.verificationLevel === "spec_verified") {
			const reference = evidencePackage.formalSpecReference;
			if (!reference) return { ok: false, errors: ["spec_verified 需要 formalSpecReference"] };
				if (!nonEmptyString(reference.target)) return { ok: false, errors: ["formalSpecReference target 不可為空白"] };
				if (!nonEmptyString(reference.version)) return { ok: false, errors: ["formalSpecReference version 不可為空白"] };
				if (!nonEmptyString(reference.locator)) return { ok: false, errors: ["formalSpecReference locator 不可為空白"] };
				if (!nonEmptyString(reference.evidenceId)) return { ok: false, errors: ["formalSpecReference evidenceId 不可為空白"] };
			// 尚無 runtime trusted formal-spec importer；caller 提供的同形狀物件不具授權能力。
			return { ok: false, errors: ["spec_verified 需要受信任的 formal spec context"] };
		}
	if (Array.from(knowledgeSummary).length > EVIDENCE_PACKAGE_MAX_STATEMENT_CODE_POINTS) {
		return {
			ok: false,
			errors: [`knowledgeSummary 內容超過 ${EVIDENCE_PACKAGE_MAX_STATEMENT_CODE_POINTS} 個 Unicode 字元`],
		};
	}
	const derivedEvidenceIds = evidencePackage.evidence.map((item) => item.evidenceId);
	if (
		!Array.isArray(evidencePackage.evidenceIds) ||
		evidencePackage.evidenceIds.length !== derivedEvidenceIds.length ||
		evidencePackage.evidenceIds.some((evidenceId, index) => evidenceId !== derivedEvidenceIds[index])
	) {
		return { ok: false, errors: ["evidenceIds 必須由 evidence 衍生且順序一致"] };
	}

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
