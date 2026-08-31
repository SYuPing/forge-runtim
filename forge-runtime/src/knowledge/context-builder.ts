import type { LightDiscoveryEvidence } from "./discovery-engine.ts";
import type { EvidencePackage } from "../evidence/evidence-engine.ts";

export interface ContextItem extends LightDiscoveryEvidence {
	statement: string;
}

export interface ContextBuilderRequest {
	readonly evidence: readonly LightDiscoveryEvidence[];
	readonly knowledgeUnderstanding: EvidencePackage;
}

export interface ContextBuildResult {
	readonly items: readonly ContextItem[];
	readonly knowledgeUnderstanding: EvidencePackage;
}

export async function buildContextItems(request: ContextBuilderRequest): Promise<ContextBuildResult> {
	return {
		items: request.evidence.map((item) => ({
			evidenceId: item.evidenceId,
			source: item.source,
			statement: item.summary,
			summary: item.summary,
			title: item.title,
		})),
		knowledgeUnderstanding: request.knowledgeUnderstanding,
	};
}
