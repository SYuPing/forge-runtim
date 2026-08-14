import type { LightDiscoveryEvidence } from "../knowledge/discovery-engine.ts";

export interface EvidencePackage {
	citations: string[];
	items: LightDiscoveryEvidence[];
}

export function createEvidencePackage(items: LightDiscoveryEvidence[]): EvidencePackage {
	return {
		citations: items.map((item) => item.evidenceId),
		items,
	};
}
