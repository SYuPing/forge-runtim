import type { LightDiscoveryEvidence } from "./discovery-engine.ts";

export interface ContextItem extends LightDiscoveryEvidence {
	statement: string;
}

export interface ContextBuilderRequest {
	evidence: LightDiscoveryEvidence[];
}

export async function buildContextItems(request: ContextBuilderRequest): Promise<ContextItem[]> {
	return request.evidence.map((item) => ({
		evidenceId: item.evidenceId,
		source: item.source,
		statement: item.summary,
		summary: item.summary,
		title: item.title,
	}));
}
