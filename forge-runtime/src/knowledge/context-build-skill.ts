import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EvidenceDecision, EvidencePackage } from "../evidence/evidence-engine.ts";
import type { AdrBuildIdentity } from "../decision/adr-builder.ts";
import type { ContextBuildIdentity, ContextCandidate } from "./context-builder.ts";

const FRONTMATTER_PATTERN = /^---\s*\n[\s\S]*?\n---\s*\n?/;
const CONTEXT_BUILD_SKILL_PATH = fileURLToPath(new URL("../../skills/context-build/SKILL.md", import.meta.url));

export interface ContextBuildSkillInvocationRequest {
	readonly stage: "CONTEXT_BUILD";
	readonly identity: ContextBuildIdentity;
	readonly knowledgePackage: EvidencePackage;
	readonly humanDecisions?: readonly EvidenceDecision[];
}

export interface AdrBuildSkillInvocationRequest {
	readonly stage: "ADR_BUILD";
	readonly identity: AdrBuildIdentity;
	readonly knowledgePackage: EvidencePackage;
	readonly contextCandidate: ContextCandidate;
	readonly humanDecisions?: readonly EvidenceDecision[];
}

export function buildContextBuildSkillInvocation(
	request: ContextBuildSkillInvocationRequest | AdrBuildSkillInvocationRequest,
): string {
	const skillContent = readFileSync(CONTEXT_BUILD_SKILL_PATH, "utf8").replace(FRONTMATTER_PATTERN, "").trim();
	const knowledge = {
		evidence: request.knowledgePackage.evidence.map(({ evidenceId, kind, title, origin }) => ({
			evidenceId,
			kind,
			title,
			origin,
		})),
		decisions: request.knowledgePackage.decisions,
		humanDecisions: request.humanDecisions ?? [],
		findings: request.knowledgePackage.findings,
		limitations: request.knowledgePackage.limitations,
		verificationLevel: request.knowledgePackage.verificationLevel,
		specGap: request.knowledgePackage.specGap,
		formalSpecReference: request.knowledgePackage.formalSpecReference,
	};

	return [
		`<skill name="context-build" location="${CONTEXT_BUILD_SKILL_PATH.replace(/\\/g, "/")}">`,
		skillContent,
		"</skill>",
		"",
		`目前階段：${request.stage}`,
		`完成工具：${request.stage === "CONTEXT_BUILD" ? "forge_context_complete" : "forge_adr_complete"}`,
		"attemptId 與 sourceRoundId 必須原樣回傳。",
		"Runtime input:",
		JSON.stringify(
			{
				identity: request.identity,
				knowledge,
				...(request.stage === "ADR_BUILD" ? { contextCandidate: request.contextCandidate } : {}),
			},
			null,
			2,
		),
	].join("\n");
}
