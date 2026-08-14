import assert from "node:assert/strict";
import test from "node:test";
import {
	evaluateCandidateRelevance,
	type CodeBaseCandidate,
} from "../../src/discovery/discovery-sources.ts";

type CandidateWithMatchedSeeds = CodeBaseCandidate & { matchedSeeds: string[] };

test("evaluateCandidateRelevance_WhenCandidateHasOnlyOneSignal_ShouldNeedMoreClues", () => {
	const candidate: CandidateWithMatchedSeeds = {
		content: "AuthService",
		matchedSeeds: ["AuthService"],
		matches: ["content"],
		path: "/code_base/src/unrelated.ts",
		pathScore: 0,
		relativePath: "src/unrelated.ts",
		score: 1,
		whyRelevant: "Matched content signal.",
	};

	assert.equal(evaluateCandidateRelevance([candidate]).decision, "needs_more_clues");
});

test("evaluateCandidateRelevance_WhenDualSignalCandidatesHaveNoSharedSeed_ShouldNeedMoreClues", () => {
	const candidates: CandidateWithMatchedSeeds[] = [
		{
			content: "AuthService",
			matchedSeeds: ["AuthService"],
			matches: ["path", "content"],
			path: "/code_base/src/auth-service.ts",
			pathScore: 1,
			relativePath: "src/auth-service.ts",
			score: 2,
			whyRelevant: "Matched path + content signals.",
		},
		{
			content: "PaymentService",
			matchedSeeds: ["PaymentService"],
			matches: ["path", "content"],
			path: "/code_base/src/payment-service.ts",
			pathScore: 1,
			relativePath: "src/payment-service.ts",
			score: 2,
			whyRelevant: "Matched path + content signals.",
		},
	];

	assert.equal(evaluateCandidateRelevance(candidates).decision, "needs_more_clues");
});
