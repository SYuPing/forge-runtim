import type { IntentInput, IntentOutput } from "./intent-types.ts";

const AFFIRMATIVE_REPLIES = new Set(["好", "可以", "照做", "同意", "確認", "yes", "ok", "okay", "y"]);

export function checkForResume(input: IntentInput): IntentOutput | undefined {
	if (input.sessionState === "wait_user") {
		const normalized = normalize(input.userMessage);
		const options = input.resumeSelectionOptions ?? [];
		const recommended = normalize(input.recommendedOption);
		const matchedOption = options.find((option) => normalize(option) === normalized);

		return {
			ambiguities: [],
			goal: input.openWorkflowGoal ?? input.userMessage.trim(),
			lightDiscoverySeeds: [],
			route: "resume_wait_user",
			resumeSelection:
				matchedOption ??
				(AFFIRMATIVE_REPLIES.has(normalized) || normalized === recommended ? input.recommendedOption : undefined),
			taskKind: "unknown",
		};
	}

	if (input.sessionState === "open_workflow") {
		return {
			ambiguities: ["new-topic-conflict"],
			goal: input.openWorkflowGoal ?? input.userMessage.trim(),
			lightDiscoverySeeds: [],
			route: "resume_open_workflow",
			taskKind: "unknown",
		};
	}

	return undefined;
}

function normalize(value?: string): string {
	return (value ?? "").trim().toLowerCase();
}
