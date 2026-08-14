import type { ForgeUiState } from "./ui-state.ts";

export function buildValidationRepairText(state: ForgeUiState): string | undefined {
	if (!state.validationRepair?.rootCause && !state.validationRepair?.rollbackTarget) return undefined;
	return [
		`Root Cause: ${state.validationRepair.rootCause ?? "unknown"}`,
		`Rollback Target: ${state.validationRepair.rollbackTarget ?? "unknown"}`,
	].join("\n");
}
