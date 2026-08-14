import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStructuredGrillResult } from "../../src/grill/grill-result.ts";

test("Schema_WhenLoaded_ShouldDeclareStructuredGrillResultShape", () => {
	const schemaPath = resolve(import.meta.dirname, "../../schemas/grill-result.schema.json");
	assert.equal(existsSync(schemaPath), true, "Expected grill-result schema file to exist");

	const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
		additionalProperties?: boolean;
		required?: unknown;
	};
	assert.equal(
		schema.additionalProperties,
		false,
		"Expected root schema to reject unknown properties like the runtime schema",
	);
	assert.ok(Array.isArray(schema.required), "Expected schema.required to be an array");
	const requiredKeys = new Set(schema.required);
	for (const key of ["roundId", "status", "questions", "recommendation", "evidence", "requiresUserConfirmation"]) {
		assert.equal(requiredKeys.has(key), true, `Expected schema.required to include ${key}`);
	}
});

test("Schema_WhenQuestionOptionsDeclared_ShouldMatchRuntimeObjectBoundaries", () => {
	type SchemaNode = {
		additionalProperties?: boolean;
		anyOf?: SchemaNode[];
		minLength?: number;
		properties?: Record<string, SchemaNode>;
		required?: string[];
		type?: string;
	};
	type GrillResultSchema = {
		properties?: {
			questions?: {
				items?: {
					additionalProperties?: boolean;
					properties?: {
						options?: { items?: SchemaNode };
					};
				};
			};
		};
	};

	const schemaPath = resolve(import.meta.dirname, "../../schemas/grill-result.schema.json");
	const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as GrillResultSchema;
	const options = schema.properties?.questions?.items?.properties?.options?.items;
	const optionString = options?.anyOf?.find((option) => option.type === "string");
	const optionObject = options?.anyOf?.find((option) => option.type === "object");

	assert.equal(optionString?.minLength, 1, "Expected options to allow non-empty strings");
	assert.equal(optionObject?.properties?.value?.minLength, 1, "Expected object options to require non-empty value");
	assert.equal(optionObject?.required?.includes("value"), true, "Expected object options to require value");
	assert.equal(optionObject?.required?.includes("id"), false, "Expected object option id to be optional");
	assert.equal(
		schema.properties?.questions?.items?.additionalProperties,
		false,
		"Expected question objects to reject unknown properties like the runtime schema",
	);
});

test("Schema_WhenRecommendationConfidenceDeclared_ShouldMatchRuntimeNumber", () => {
	type GrillResultSchema = {
		properties?: {
			recommendation?: {
				properties?: {
					confidence?: { type?: string };
				};
			};
		};
	};

	const schemaPath = resolve(import.meta.dirname, "../../schemas/grill-result.schema.json");
	const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as GrillResultSchema;
	assert.equal(
		schema.properties?.recommendation?.properties?.confidence?.type,
		"number",
		"Expected recommendation confidence to be a number like the runtime schema",
	);
});

test("Schema_WhenStatusChanges_ShouldConstrainQuestionCardinality", () => {
	type StatusRule = {
		if?: { properties?: { status?: { const?: string } } };
		then?: {
			properties?: {
				questions?: { maxItems?: number; minItems?: number };
				requiresUserConfirmation?: { const?: boolean };
			};
		};
	};
	type GrillResultSchema = {
		allOf?: StatusRule[];
		properties?: {
			questions?: {
				items?: {
					properties?: {
						id?: { minLength?: number };
						options?: { minItems?: number };
						question?: { minLength?: number };
					};
				};
			};
		};
	};

	const schemaPath = resolve(import.meta.dirname, "../../schemas/grill-result.schema.json");
	const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as GrillResultSchema;
	const ruleFor = (status: string) => schema.allOf?.find((rule) => rule.if?.properties?.status?.const === status);

	const needsConfirmation = ruleFor("NEEDS_CONFIRMATION");
	assert.equal(needsConfirmation?.then?.properties?.questions?.minItems, 1);
	assert.equal(needsConfirmation?.then?.properties?.questions?.maxItems, 1);
	assert.equal(needsConfirmation?.then?.properties?.requiresUserConfirmation?.const, true);

	const readyForDeep = ruleFor("READY_FOR_DEEP");
	assert.equal(readyForDeep?.then?.properties?.questions?.maxItems, 0);
	assert.equal(readyForDeep?.then?.properties?.requiresUserConfirmation?.const, false);

	const question = schema.properties?.questions?.items?.properties;
	assert.equal(question?.id?.minLength, 1);
	assert.equal(question?.question?.minLength, 1);
	assert.equal(question?.options?.minItems, 1);
});

test("parseStructuredGrillResult_WhenQuestionOptionsUseIdValueObjects_ShouldNormalizeToStrings", () => {
	const result = parseStructuredGrillResult(
		JSON.stringify({
			status: "NEEDS_CONFIRMATION",
			questions: [
				{
					id: "q-1",
					question: "要走哪個方案？",
					options: [
						{ id: "accept", value: "accept" },
						{ id: "revise", value: "revise" },
					],
				},
			],
			recommendation: {
				value: "accept",
			},
			evidence: ["EV-1"],
			requiresUserConfirmation: true,
		}),
	);

	assert.deepEqual(result.questions[0]?.options, ["accept", "revise"]);
});

test("parseStructuredGrillResult_WhenReadyForDeep_ShouldAllowEmptyQuestions", () => {
	const result = parseStructuredGrillResult(
		JSON.stringify({
			status: "READY_FOR_DEEP",
			questions: [],
			recommendation: {
				value: "proceed",
			},
			evidence: ["EV-2"],
			requiresUserConfirmation: false,
		}),
	);

	assert.equal(result.status, "READY_FOR_DEEP");
	assert.equal(result.requiresUserConfirmation, false);
	assert.deepEqual(result.questions, []);
});
import { strict as assertForGrillCompletion } from "node:assert";
import { test as testGrillCompletion } from "node:test";
import * as grillResultForCompletion from "../../src/grill/grill-result.ts";

testGrillCompletion("GrillCompletion_WhenRoundMatchesAndEvidenceFetched_ShouldParse", () => {
	const payload = JSON.stringify({
		evidence: ["EV-1"],
		questions: [{ id: "Q-1", options: ["A"], question: "Proceed?" }],
		recommendation: { reason: "R-1 is ready.", value: "A" },
		requiresUserConfirmation: true,
		roundId: "R-1",
		status: "NEEDS_CONFIRMATION",
	});

	const result = grillResultForCompletion.parseGrillCompletion(payload, {
		expectedRoundId: "R-1",
		fetchedEvidenceIds: new Set(["EV-1"]),
	});

	assertForGrillCompletion.equal(result.roundId, "R-1");
	assertForGrillCompletion.deepEqual(result.evidence, ["EV-1"]);
});

testGrillCompletion("GrillCompletion_WhenRoundIsStale_ShouldReject", () => {
	const payload = JSON.stringify({
		evidence: ["EV-1"],
		questions: [{ id: "Q-1", options: ["A"], question: "Proceed?" }],
		recommendation: { reason: "R-1 is ready.", value: "A" },
		requiresUserConfirmation: true,
		roundId: "R-stale",
		status: "NEEDS_CONFIRMATION",
	});

	assertForGrillCompletion.throws(
		() =>
			grillResultForCompletion.parseGrillCompletion(payload, {
				expectedRoundId: "R-1",
				fetchedEvidenceIds: new Set(["EV-1"]),
			}),
		{ message: "grill completion roundId does not match the active round" },
	);
});

testGrillCompletion("GrillCompletion_WhenEvidenceWasNotFetched_ShouldReject", () => {
	const payload = JSON.stringify({
		evidence: ["EV-unknown"],
		questions: [{ id: "Q-1", options: ["A"], question: "Proceed?" }],
		recommendation: { reason: "R-1 is ready.", value: "A" },
		requiresUserConfirmation: true,
		roundId: "R-1",
		status: "NEEDS_CONFIRMATION",
	});

	assertForGrillCompletion.throws(
		() =>
			grillResultForCompletion.parseGrillCompletion(payload, {
				expectedRoundId: "R-1",
				fetchedEvidenceIds: new Set(["EV-1"]),
			}),
		{ message: "grill completion references evidence that was not fetched" },
	);
});

testGrillCompletion("GrillCompletion_WhenEmptyManifestFirstSnapshotRoundNeedsConfirmationWithNoEvidence_ShouldParse", () => {
	const payload = JSON.stringify({
		evidence: [],
		questions: [{ id: "Q-scope", options: ["A"], question: "Which source or scope should be added?" }],
		recommendation: { reason: "R-1 needs a source or scope decision.", value: "A" },
		requiresUserConfirmation: true,
		roundId: "R-1",
		status: "NEEDS_CONFIRMATION",
	});

	const result = grillResultForCompletion.parseGrillCompletion(payload, {
		expectedRoundId: "R-1",
		fetchedEvidenceIds: new Set(),
		isFirstRoundOfSnapshot: true,
		snapshotManifest: [],
	});

	assertForGrillCompletion.equal(result.status, "NEEDS_CONFIRMATION");
	assertForGrillCompletion.equal(result.requiresUserConfirmation, true);
	assertForGrillCompletion.equal(result.questions.length, 1);
	assertForGrillCompletion.equal(result.questions[0]?.id, "Q-scope");
	assertForGrillCompletion.deepEqual(result.evidence, []);
});

testGrillCompletion("GrillCompletion_WhenNonEmptyManifestFirstSnapshotRoundHasNoEvidence_ShouldReject", () => {
	assertForGrillCompletion.throws(
		() =>
			grillResultForCompletion.parseGrillCompletion(
				{
					evidence: [],
					questions: [{ id: "Q-1", options: ["A"], question: "Proceed?" }],
					recommendation: { value: "A" },
					requiresUserConfirmation: true,
					roundId: "R-1",
					status: "NEEDS_CONFIRMATION",
				},
				{
					expectedRoundId: "R-1",
					fetchedEvidenceIds: new Set(),
					isFirstRoundOfSnapshot: true,
					snapshotManifest: ["ev-source-1"],
				},
			),
		{ message: "grill completion requires at least one fetched evidence in the first snapshot round" },
	);
});

testGrillCompletion("GrillCompletion_WhenNeedsConfirmationHasMultipleQuestions_ShouldReject", () => {
	assertForGrillCompletion.throws(() =>
		grillResultForCompletion.parseGrillCompletion(
			{
				evidence: ["EV-1"],
				questions: [
					{ id: "Q-1", options: ["A"], question: "Proceed?" },
					{ id: "Q-2", options: ["B"], question: "Choose scope?" },
				],
				recommendation: { value: "A" },
				requiresUserConfirmation: true,
				roundId: "R-1",
				status: "NEEDS_CONFIRMATION",
			},
			{
				expectedRoundId: "R-1",
				fetchedEvidenceIds: new Set(["EV-1"]),
				isFirstRoundOfSnapshot: false,
			},
		),
	);
});

testGrillCompletion("GrillCompletion_WhenReadyForDeepHasQuestion_ShouldReject", () => {
	assertForGrillCompletion.throws(() =>
		grillResultForCompletion.parseGrillCompletion(
			{
				evidence: ["EV-1"],
				questions: [{ id: "Q-1", options: ["A"], question: "Proceed?" }],
				recommendation: { value: "proceed" },
				requiresUserConfirmation: false,
				roundId: "R-1",
				status: "READY_FOR_DEEP",
			},
			{
				expectedRoundId: "R-1",
				fetchedEvidenceIds: new Set(["EV-1"]),
				isFirstRoundOfSnapshot: false,
			},
		),
	);
});

for (const [emptyField, question] of [
	["id", { id: "", options: ["A"], question: "Proceed?" }],
	["question", { id: "Q-1", options: ["A"], question: "" }],
] as const) {
	testGrillCompletion(`GrillCompletion_WhenQuestion${emptyField === "id" ? "Id" : "Text"}IsEmpty_ShouldReject`, () => {
		assertForGrillCompletion.throws(
			() =>
				grillResultForCompletion.parseGrillCompletion(
					{
						evidence: ["EV-1"],
						questions: [question],
						recommendation: { value: "A" },
						requiresUserConfirmation: true,
						roundId: "R-1",
						status: "NEEDS_CONFIRMATION",
					},
					{
						expectedRoundId: "R-1",
						fetchedEvidenceIds: new Set(["EV-1"]),
						isFirstRoundOfSnapshot: false,
					},
				),
			{ message: "invalid grill completion payload" },
		);
	});
}
