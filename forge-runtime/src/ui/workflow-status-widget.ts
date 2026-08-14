import type { ForgeUiState } from "./ui-state.ts";

export function buildWorkflowStatusText(state: ForgeUiState): string {
	const waiting = state.waitUser ? "waiting-user" : "active";
	return `Forge ${state.stage} [${waiting}]`;
}
