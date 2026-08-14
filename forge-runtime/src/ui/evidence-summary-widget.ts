import type { ForgeUiState } from "./ui-state.ts";

export function buildEvidenceSummaryText(state: ForgeUiState): string | undefined {
	if (state.lastEvidenceIds.length === 0 && !state.decisionSummary) return undefined;
	const lines = [];
	if (state.decisionSummary) lines.push(`Decision: ${state.decisionSummary}`);
	if (state.lastEvidenceIds.length > 0) lines.push(`Evidence: ${state.lastEvidenceIds.join(", ")}`);
	return lines.join("\n");
}
