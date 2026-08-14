import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export interface DiscoverySource {
	path: string;
	content: string;
}

export interface CodeBaseCandidate extends DiscoverySource {
	matches: string[];
	matchedSeeds?: string[];
	pathScore: number;
	relativePath: string;
	score: number;
	whyRelevant: string;
}

export interface CandidateRelevanceGateResult {
	candidates: CodeBaseCandidate[];
	decision: "needs_more_clues" | "proceed_deep";
	reason: string;
}

export interface KnowledgeAssetStatus {
	codeBaseDir: string;
	missingAssets: string[];
	wikiDir: string;
}

export interface CodeBaseConflict {
	codeBasePath: string;
	relativePath: string;
	targetSourcePath: string;
}

export interface TargetMismatch {
	codeBasePath: string;
	relativePath: string;
	status: "Target Conflict" | "Target Gap";
	targetSourcePath: string;
}

export function getKnowledgeAssetStatus(rootDir: string): KnowledgeAssetStatus {
	const wikiDir = resolve(rootDir, "wiki");
	const codeBaseDir = resolve(rootDir, "code_base");
	return {
		codeBaseDir,
		missingAssets: [!existsSync(wikiDir) ? "wiki" : undefined, !existsSync(codeBaseDir) ? "code_base" : undefined].filter(
			(value): value is string => Boolean(value),
		),
		wikiDir,
	};
}

export function loadWikiDiscoverySources(rootDir: string): DiscoverySource[] {
	const { wikiDir } = getKnowledgeAssetStatus(rootDir);
	if (!existsSync(wikiDir)) {
		return [];
	}

	return walkFiles(wikiDir).map((filePath) => ({
		content: readFileSync(filePath, "utf8"),
		path: filePath,
	}));
}

export function findCodeBaseCandidates(rootDir: string, seeds: string[], limit = 3): CodeBaseCandidate[] {
	const { codeBaseDir } = getKnowledgeAssetStatus(rootDir);
	if (!existsSync(codeBaseDir) || seeds.length === 0) {
		return [];
	}

	return walkFiles(codeBaseDir)
		.map((filePath) => {
			const content = readFileSync(filePath, "utf8");
			const relativePath = filePath.slice(codeBaseDir.length + 1).replaceAll("\\", "/");
			const pathScore = scoreSeedMatches(relativePath, seeds);
			const contentScore = scoreSeedMatches(content, seeds);
			const matches = [pathScore > 0 ? "path" : undefined, contentScore > 0 ? "content" : undefined].filter(
				(value): value is string => Boolean(value),
			);
			const lowerPath = relativePath.toLowerCase();
			const lowerContent = content.toLowerCase();
			const matchedSeeds = seeds.filter((seed) => {
				const normalizedSeed = seed.trim().toLowerCase();
				return normalizedSeed.length > 0 && (lowerPath.includes(normalizedSeed) || lowerContent.includes(normalizedSeed));
			});
			return {
				content,
				matches,
				matchedSeeds,
				path: filePath,
				pathScore,
				relativePath,
				score: pathScore + contentScore,
				whyRelevant: buildWhyRelevant(relativePath, matches),
			};
		})
		// ponytail: 至少要有 path + content 兩種訊號，避免只靠單一字串把無關檔案帶進 deep 候選。
		.filter((candidate) => candidate.matches.length >= 2)
		.sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
		.slice(0, limit);
}

export function detectCodeBaseConflict(rootDir: string, seeds: string[]): CodeBaseConflict | undefined {
	const { codeBaseDir } = getKnowledgeAssetStatus(rootDir);
	for (const seed of seeds) {
		const relativePath = normalizeRelativeFilePath(seed);
		if (!relativePath) {
			continue;
		}

		const targetSourcePath = resolve(rootDir, relativePath);
		const codeBasePath = resolve(codeBaseDir, relativePath);
		if (!existsSync(targetSourcePath) || !existsSync(codeBasePath)) {
			continue;
		}

		if (readFileSync(targetSourcePath, "utf8") !== readFileSync(codeBasePath, "utf8")) {
			return { codeBasePath, relativePath, targetSourcePath };
		}
	}

	return undefined;
}

export function detectTargetMismatch(rootDir: string, candidate: Pick<CodeBaseCandidate, "relativePath" | "path">): TargetMismatch {
	const targetSourcePath = resolve(rootDir, candidate.relativePath);
	if (!existsSync(targetSourcePath)) {
		return {
			codeBasePath: candidate.path,
			relativePath: candidate.relativePath,
			status: "Target Gap",
			targetSourcePath,
		};
	}

	return {
		codeBasePath: candidate.path,
		relativePath: candidate.relativePath,
		status: readFileSync(targetSourcePath, "utf8") === readFileSync(candidate.path, "utf8") ? "Target Gap" : "Target Conflict",
		targetSourcePath,
	};
}

export function evaluateCandidateRelevance(candidates: CodeBaseCandidate[]): CandidateRelevanceGateResult {
	if (candidates.length === 0 || candidates.some((candidate) => !candidate.matches.includes("path") || !candidate.matches.includes("content"))) {
		return {
			candidates,
			decision: "needs_more_clues",
			reason: "候選相關性不足；目前沒有同時命中 path 與 content 的 code_base 候選。",
		};
	}
	if (candidates.length > 1) {
		const [firstCandidate, ...otherCandidates] = candidates;
		const sharedSeeds = new Set(firstCandidate?.matchedSeeds ?? []);
		for (const candidate of otherCandidates) {
			for (const seed of sharedSeeds) {
				if (!candidate.matchedSeeds?.includes(seed)) {
					sharedSeeds.delete(seed);
				}
			}
		}
		if (sharedSeeds.size === 0) {
			return {
				candidates,
				decision: "needs_more_clues",
				reason: "候選相關性不足；候選群沒有共同 discovery seed，無法安全進入 deep knowledge。",
			};
		}
	}

	return {
		candidates,
		decision: "proceed_deep",
		reason: `候選相關性足夠；將以 ${candidates[0]?.relativePath ?? "unknown"} 作為 deep knowledge 起點。`,
	};
}

function walkFiles(dir: string): string[] {
	const entries = readdirSync(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const nextPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkFiles(nextPath));
			continue;
		}
		if (entry.isFile() && statSync(nextPath).size > 0) {
			files.push(nextPath);
		}
	}
	return files;
}

function normalizeRelativeFilePath(seed: string): string | undefined {
	const normalized = seed.trim().replaceAll("\\", "/");
	if (!/^[A-Za-z0-9_.\-/]+\.[A-Za-z0-9]+$/.test(normalized)) {
		return undefined;
	}
	if (normalized.startsWith("/") || normalized.startsWith("../") || normalized.includes(":/")) {
		return undefined;
	}
	return normalized;
}

function scoreSeedMatches(haystack: string, seeds: string[]): number {
	const lowerHaystack = haystack.toLowerCase();
	let score = 0;
	for (const seed of seeds) {
		const normalizedSeed = seed.trim().toLowerCase();
		if (normalizedSeed.length === 0) {
			continue;
		}
		if (lowerHaystack.includes(normalizedSeed)) {
			score += normalizedSeed.includes(".") ? 3 : 1;
		}
	}
	return score;
}

function buildWhyRelevant(relativePath: string, matches: string[]): string {
	if (matches.length === 0) {
		return `No strong relevance signals for ${relativePath}.`;
	}
	return `Matched ${matches.join(" + ")} signals for ${relativePath}.`;
}
