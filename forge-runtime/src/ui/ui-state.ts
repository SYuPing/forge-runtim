export interface WaitUserState {
	kind: "grill_confirmation" | "relevance_clarification";
	roundId: string;
	decisionId: string;
	evidenceIds: string[];
	options: string[];
	question: string;
	recommendation: string;
}

export interface ValidationRepairState {
	rollbackTarget?: string;
	rootCause?: string;
}

export interface ForgeUiState {
	decisionSummary?: string;
	lastEvidenceIds: string[];
	stage: string;
	validationRepair?: ValidationRepairState;
	waitUser?: WaitUserState;
}

export function createForgeUiState(stage: string): ForgeUiState {
	return {
		lastEvidenceIds: [],
		stage,
	};
}
