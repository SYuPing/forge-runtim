import { readdirSync, statSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";

export type LightDiscoverySource = "wiki" | "code_base";

export interface LightDiscoveryMatch {
	source: LightDiscoverySource;
	relativePath: string;
	fileName: string;
	extension: string;
}

export interface LightDiscoveryResult {
	matches: LightDiscoveryMatch[];
	warnings: string[];
	sourceAvailability: Readonly<Record<LightDiscoverySource, boolean>>;
}

/** Light Discovery 的唯一 public seam：只接受 workspace/root 與原始使用者輸入。 */
export function runLightDiscovery(rootDir: string, userMessage: string): LightDiscoveryResult {
	const seeds = normalizeInput(userMessage);
	const matches: LightDiscoveryMatch[] = [];
	const warnings: string[] = [];
	const sourceAvailability = { wiki: false, code_base: false };

	for (const source of ["wiki", "code_base"] as const) {
		const sourceRoot = resolve(rootDir, source);
		let files: string[];
		try {
			files = collectFiles(sourceRoot, warnings, source);
			sourceAvailability[source] = true;
		} catch (error) {
			warnings.push(`${source} 來源無法讀取：${formatError(error)}`);
			continue;
		}

		const sourceMatches: LightDiscoveryMatch[] = [];
		if (seeds.length === 0) continue;
		for (const filePath of files) {
			try {
				const relativePath = relative(sourceRoot, filePath).replaceAll("\\", "/");
				const fileName = basename(relativePath);
				if (!seeds.some((seed) => matchesPath(seed, relativePath, fileName))) continue;
				sourceMatches.push({ source, relativePath, fileName, extension: extname(fileName) });
			} catch (error) {
				warnings.push(`${source} 檔案 metadata 失敗：${formatError(error)}`);
			}
		}

		matches.push(...sourceMatches.sort(compareMatches).slice(0, 3));
	}

	return { matches: matches.sort(compareMatches), warnings, sourceAvailability };
}

function normalizeInput(message: string): string[] {
	const tokens = message
		.match(/[\w./-]+\.[A-Za-z0-9]+|`([^`]+)`|[A-Z]{2,}-\d+/g)
		?.map((token) => token.replaceAll("`", "").trim()) ?? [];
	const words = message
		.split(/\s+/)
		.flatMap((token) => token.trim().split(/(?<=[\u4e00-\u9fff])(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])(?=[\u4e00-\u9fff])/))
		.filter((word) => word.length >= 2 && /[A-Za-z\u4e00-\u9fff]/.test(word))
		.slice(0, 6);
	return [...new Set([...tokens, ...words])].slice(0, 8).map((token) => token.toLowerCase());
}

function matchesPath(seed: string, relativePath: string, fileName: string): boolean {
	return relativePath.toLowerCase().includes(seed) || fileName.toLowerCase().includes(seed);
}

function collectFiles(root: string, warnings?: string[], source?: LightDiscoverySource): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) {
			try {
				files.push(...collectFiles(path, warnings, source));
			} catch (error) {
				warnings?.push(`${source ?? "source"} 目錄 metadata 失敗：${formatError(error)}`);
			}
		} else if (entry.isFile()) {
			try {
				if (statSync(path).size >= 0) files.push(path);
			} catch (error) {
				warnings?.push(`${source ?? "source"} 檔案 metadata 失敗：${formatError(error)}`);
			}
		}
	}
	return files;
}

function compareMatches(left: LightDiscoveryMatch, right: LightDiscoveryMatch): number {
	return left.source.localeCompare(right.source) || left.relativePath.localeCompare(right.relativePath);
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
