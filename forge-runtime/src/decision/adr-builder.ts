import type { ContextItem } from "../knowledge/context-builder.ts";

export interface AdrRecord {
	citations: string[];
	decision: string;
	rationale: string;
}

export interface BuildAdrRequest {
	contextItems: ContextItem[];
	decision: string;
	rationale: string;
}

export function buildAdrRecord(request: BuildAdrRequest): AdrRecord {
	return {
		citations: request.contextItems.map((item) => item.evidenceId),
		decision: request.decision,
		rationale: request.rationale,
	};
}
