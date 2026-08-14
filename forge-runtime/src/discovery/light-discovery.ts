import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { discoverEvidence, type LightDiscoveryEvidence } from "../knowledge/discovery-engine.ts";
import type { GrillEvidenceCandidate, GrillEvidenceKind, GrillEvidenceSnapshot } from "../runtime/session-state.ts";
import { detectTargetMismatch, findCodeBaseCandidates, loadWikiDiscoverySources, type CodeBaseCandidate } from "./discovery-sources.ts";

export interface LightDiscoveryResult {
	codeBaseCandidates: CodeBaseCandidate[];
	snapshot: GrillEvidenceSnapshot;
	summary: string;
}

export async function buildLightDiscoverySummary(rootDir: string, seeds: string[]): Promise<string> {
	return (await runLightDiscovery(rootDir, seeds)).summary;
}

export async function runLightDiscovery(rootDir: string, seeds: string[]): Promise<LightDiscoveryResult> {
	if (seeds.length === 0) {
		return { codeBaseCandidates: [], snapshot: createGrillEvidenceSnapshot([]), summary: "" };
	}

	const sourceMatches = loadWikiDiscoverySources(rootDir)
		.filter((source) => matchesAnySeed(source.content, seeds) || matchesAnySeed(source.path, seeds))
		.map((source) => ({
			content: source.content,
			source: source.path,
			summary: summarize(source.content),
			title: basename(source.path),
		}));
	const codeBaseCandidates = findCodeBaseCandidates(rootDir, seeds);
	const selectedWikiSources = sourceMatches.slice(0, 3);

	if (sourceMatches.length === 0 && codeBaseCandidates.length === 0) {
		return {
			codeBaseCandidates,
			snapshot: createGrillEvidenceSnapshot([]),
			summary: `Light discovery seeds: ${seeds.join(", ")}`,
		};
	}

	const evidence = (await discoverEvidence({ documents: selectedWikiSources, mode: "light" })) as LightDiscoveryEvidence[];
	return {
		codeBaseCandidates,
		snapshot: createGrillEvidenceSnapshot([
			...selectedWikiSources.map((source, index) =>
				createGrillEvidenceCandidate(
					"wiki",
					`wiki/${relative(resolve(rootDir, "wiki"), source.source).replaceAll("\\", "/")}`,
					source.title,
					source.content,
					{ discoveryEvidenceId: evidence[index]?.evidenceId },
				),
			),
			...codeBaseCandidates.flatMap((candidate) => createCodeBaseEvidenceCandidates(rootDir, candidate)),
		]),
		summary: [
			`Light discovery seeds: ${seeds.join(", ")}`,
			...evidence.map((item) => `- ${item.title}: ${item.summary} [${item.evidenceId}]`),
			...codeBaseCandidates.map(
				(candidate) =>
					[
						`- code_base/${candidate.relativePath}: ${summarize(candidate.content)} [code-base-candidate score=${candidate.score}]`,
						`  Signals Matched: ${candidate.matches.join(", ")}`,
						`  Why Relevant: ${candidate.whyRelevant}`,
					].join("\n"),
			),
			...(codeBaseCandidates[0] ? [buildPatternCard(rootDir, codeBaseCandidates[0])] : []),
		].join("\n"),
	};
}

function createCodeBaseEvidenceCandidates(rootDir: string, candidate: CodeBaseCandidate): GrillEvidenceCandidate[] {
	const metadata = {
		matches: [...candidate.matches],
		relativePath: candidate.relativePath,
		score: candidate.score,
		whyRelevant: candidate.whyRelevant,
	};
	const evidenceCandidates = [
		createGrillEvidenceCandidate(
			"code_base",
			`code_base/${candidate.relativePath}`,
			basename(candidate.relativePath),
			candidate.content,
			metadata,
		),
	];
	const targetSourcePath = resolve(rootDir, candidate.relativePath);
	if (existsSync(targetSourcePath) && statSync(targetSourcePath).isFile()) {
		evidenceCandidates.push(
			createGrillEvidenceCandidate(
				"target",
				`target/${candidate.relativePath}`,
				basename(candidate.relativePath),
				readFileSync(targetSourcePath, "utf8"),
				metadata,
			),
		);
	}
	return evidenceCandidates;
}

function createGrillEvidenceSnapshot(candidates: GrillEvidenceCandidate[]): GrillEvidenceSnapshot {
	return deepFreeze({
		candidates: Object.fromEntries(candidates.map((candidate) => [candidate.candidateId, candidate])) as Record<
			string,
			GrillEvidenceCandidate
		>,
		manifest: candidates.map(({ candidateId, kind, source, title }) => ({ candidateId, kind, source, title })),
	});
}

function createGrillEvidenceCandidate(
	kind: GrillEvidenceKind,
	source: string,
	title: string,
	content: string,
	metadata: GrillEvidenceCandidate["metadata"],
): GrillEvidenceCandidate {
	const normalizedContent = content.replace(/\r\n?/g, "\n");
	const candidateId = `ev-${createHash("sha256")
		.update(JSON.stringify(["forge-grill-evidence-v1", kind, source, normalizedContent]))
		.digest("hex")}` as GrillEvidenceCandidate["candidateId"];
	return { candidateId, content, kind, metadata, source, title };
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const nestedValue of Object.values(value as Record<string, unknown>)) {
			deepFreeze(nestedValue);
		}
		Object.freeze(value);
	}
	return value;
}

function matchesAnySeed(content: string, seeds: string[]): boolean {
	const lower = content.toLowerCase();
	return seeds.some((seed) => lower.includes(seed.toLowerCase()));
}

function summarize(content: string): string {
	return content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"))
		.slice(0, 2)
		.join(" ")
		.slice(0, 220);
}


function buildPatternCard(
	rootDir: string,
	candidate: { content: string; matches: string[]; path: string; relativePath: string; whyRelevant: string },
): string {
	const mismatch = detectTargetMismatch(rootDir, candidate);
	return [
		"Pattern Card",
		`Pattern Name: ${toPatternName(candidate.relativePath)}`,
		`Why Relevant: ${candidate.whyRelevant}`,
		`Signals Matched: ${candidate.matches.join(", ")}`,
		`Key File: code_base/${candidate.relativePath}`,
		`Core Structure: ${summarize(candidate.content)}`,
		`Mismatch Against Target: ${mismatch.status}`,
		`Target File: ${mismatch.targetSourcePath}`,
	].join("\n");
}

function toPatternName(relativePath: string): string {
	return basename(relativePath)
		.replace(/\.[^.]+$/, "")
		.split(/[-_.]+/)
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ");
}
