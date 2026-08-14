export interface DiscoveryDocument {
	content: string;
	source: string;
	summary: string;
	title: string;
}

export interface DiscoveryRequest {
	documents: DiscoveryDocument[];
	mode: "deep" | "light";
}

export interface LightDiscoveryEvidence {
	evidenceId: string;
	source: string;
	summary: string;
	title: string;
}

export interface DeepDiscoveryEvidence extends LightDiscoveryEvidence {
	content: string;
}

export async function discoverEvidence(
	request: DiscoveryRequest,
): Promise<DeepDiscoveryEvidence[] | LightDiscoveryEvidence[]> {
	if (request.mode === "deep") {
		return request.documents.map((document, index) => ({
			content: document.content,
			evidenceId: toEvidenceId(index),
			source: document.source,
			summary: document.summary,
			title: document.title,
		}));
	}

	return request.documents.map((document, index) => ({
		evidenceId: toEvidenceId(index),
		source: document.source,
		summary: document.summary,
		title: document.title,
	}));
}

function toEvidenceId(index: number): string {
	return `EV-${String(index + 1).padStart(4, "0")}`;
}
