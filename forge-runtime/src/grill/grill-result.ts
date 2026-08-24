import type { WaitUserPayload } from "../runtime/session-state.ts";
import Type from "typebox";
import { Compile } from "typebox/compile";

export interface GrillQuestion {
	id: string;
	options: string[];
	question: string;
}

interface GrillOptionObject {
	id?: string;
	value?: string;
}

export interface GrillRecommendation {
	confidence?: number;
	reason?: string;
	value: string;
}

export interface StructuredGrillResult {
	evidence: string[];
	questions: GrillQuestion[];
	recommendation: GrillRecommendation;
	requiresUserConfirmation: boolean;
	status: "NEEDS_CONFIRMATION" | "READY_FOR_DEEP";
}

export interface GrillCompletionPayload extends StructuredGrillResult {
	roundId: string;
}

export interface GrillCompletionContext {
	expectedRoundId: string;
	fetchedEvidenceIds: ReadonlySet<string>;
	isFirstRoundOfSnapshot?: boolean;
	snapshotManifest?: readonly unknown[];
}

export const GrillCompletionSchema = Type.Object(
	{
		evidence: Type.Array(Type.String({ minLength: 1 })),
		questions: Type.Array(
			Type.Object(
				{
					id: Type.String({ minLength: 1 }),
					options: Type.Array(
						Type.Union([
							Type.String({ minLength: 1 }),
							Type.Object(
								{
									id: Type.Optional(Type.String()),
									value: Type.String({ minLength: 1 }),
								},
								{ additionalProperties: false },
							),
						]),
						{ minItems: 1 },
					),
					question: Type.String({ minLength: 1 }),
				},
				{ additionalProperties: false },
			),
		),
		recommendation: Type.Object({
			confidence: Type.Optional(Type.Number()),
			reason: Type.Optional(Type.String()),
			value: Type.String({ minLength: 1 }),
		}),
		requiresUserConfirmation: Type.Boolean(),
		roundId: Type.String({ minLength: 1 }),
		status: Type.Union([Type.Literal("NEEDS_CONFIRMATION"), Type.Literal("READY_FOR_DEEP")]),
	},
	{ additionalProperties: false },
);

const grillCompletionValidator = Compile(GrillCompletionSchema);

export function parseStructuredGrillResult(raw: string): StructuredGrillResult {
	const parsed = JSON.parse(raw) as Partial<StructuredGrillResult>;
	if (parsed.status !== "NEEDS_CONFIRMATION" && parsed.status !== "READY_FOR_DEEP") {
		throw new Error("structured grill result requires status NEEDS_CONFIRMATION or READY_FOR_DEEP");
	}
	if (typeof parsed.requiresUserConfirmation !== "boolean") {
		throw new Error("structured grill result must include requiresUserConfirmation");
	}
	if (!Array.isArray(parsed.questions)) {
		throw new Error("structured grill result requires questions array");
	}
	if (parsed.status === "NEEDS_CONFIRMATION") {
		if (parsed.requiresUserConfirmation !== true || parsed.questions.length !== 1) {
			throw new Error("structured grill result needs one blocking confirmation question");
		}
	} else if (parsed.requiresUserConfirmation !== false || parsed.questions.length !== 0) {
		throw new Error("READY_FOR_DEEP must set requiresUserConfirmation to false with no questions");
	}

	const firstQuestion = parsed.questions[0];
	const normalizedQuestions = parsed.status === "NEEDS_CONFIRMATION" ? [normalizeQuestion(firstQuestion)] : [];
	const questions = normalizedQuestions.filter((question): question is GrillQuestion => Boolean(question));
	if (parsed.status === "NEEDS_CONFIRMATION" && questions.length === 0) {
		throw new Error("structured grill result contains an invalid question");
	}
	if (
		!parsed.recommendation ||
		typeof parsed.recommendation.value !== "string" ||
		parsed.recommendation.value.length === 0
	) {
		throw new Error("structured grill result requires recommendation value");
	}
	if (!Array.isArray(parsed.evidence) || parsed.evidence.some((item) => typeof item !== "string" || item.length === 0)) {
		throw new Error("structured grill result requires evidence ids");
	}

	return {
		evidence: parsed.evidence,
		questions,
		recommendation: {
			confidence: parsed.recommendation.confidence,
			reason: parsed.recommendation.reason,
			value: parsed.recommendation.value,
		},
		requiresUserConfirmation: parsed.requiresUserConfirmation,
		status: parsed.status,
	};
}

export function parseGrillCompletion(payload: unknown, context: GrillCompletionContext): GrillCompletionPayload {
	const input = typeof payload === "string" ? JSON.parse(payload) : payload;
	if (!grillCompletionValidator.Check(input)) {
		throw new Error("invalid grill completion payload");
	}

	const completion = input as GrillCompletionPayload;
	if (completion.roundId !== context.expectedRoundId) {
		throw new Error("grill completion roundId does not match the active round");
	}

	const result = parseStructuredGrillResult(JSON.stringify(completion));
	const emptySnapshotFirstRoundNeedsConfirmation =
		context.isFirstRoundOfSnapshot === true &&
		context.snapshotManifest?.length === 0 &&
		result.status === "NEEDS_CONFIRMATION" &&
		result.requiresUserConfirmation === true &&
		result.questions.length === 1;
	if (context.isFirstRoundOfSnapshot && result.evidence.length === 0 && !emptySnapshotFirstRoundNeedsConfirmation) {
		throw new Error("grill completion requires at least one fetched evidence in the first snapshot round");
	}
	if (result.evidence.some((candidateId) => !context.fetchedEvidenceIds.has(candidateId))) {
		throw new Error("grill completion references evidence that was not fetched");
	}

	return { ...result, roundId: completion.roundId };
}

function normalizeQuestion(question: Partial<GrillQuestion> | undefined): GrillQuestion | undefined {
	const normalizedOptions = normalizeQuestionOptions(question?.options);
	if (!question || typeof question.id !== "string" || typeof question.question !== "string" || normalizedOptions === undefined) {
		return undefined;
	}

	return {
		id: question.id,
		options: normalizedOptions,
		question: question.question,
	};
}

function normalizeQuestionOptions(options: unknown): string[] | undefined {
	if (!Array.isArray(options) || options.length === 0) {
		return undefined;
	}

	const normalized = options.map((option) => normalizeQuestionOption(option));
	if (normalized.some((option) => option === undefined)) {
		return undefined;
	}

	return normalized as string[];
}

function normalizeQuestionOption(option: unknown): string | undefined {
	if (typeof option === "string" && option.length > 0) {
		return option;
	}
	if (!option || typeof option !== "object") {
		return undefined;
	}
	const objectOption = option as GrillOptionObject;
	return typeof objectOption.value === "string" && objectOption.value.length > 0 ? objectOption.value : undefined;
}

export function toWaitUserPayload(result: GrillCompletionPayload): WaitUserPayload {
	const question = result.questions[0];
	return {
		kind: "grill_confirmation",
		roundId: result.roundId,
		decisionId: question.id,
		decisionSummary: result.recommendation.reason,
		evidenceIds: result.evidence,
		options: question.options,
		question: question.question,
		recommendation: result.recommendation.value,
	};
}
