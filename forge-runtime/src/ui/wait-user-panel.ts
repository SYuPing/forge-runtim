import type { ForgeUiState } from "./ui-state.ts";

export function buildWaitUserPanel(state: ForgeUiState): string | undefined {
	if (!state.waitUser) return undefined;
	return [
		`Stage: ${state.stage}`,
		`Question: ${state.waitUser.question}`,
		`Recommendation: ${state.waitUser.recommendation}`,
		`Options: ${state.waitUser.options.join(", ")}`,
		`Evidence: ${state.waitUser.evidenceIds.join(", ")}`,
		"Confirm: /forge-runtime confirm",
		"Reject: /forge-runtime reject",
	].join("\n");
}
