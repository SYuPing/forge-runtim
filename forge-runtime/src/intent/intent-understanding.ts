import { checkForResume } from "./resume-check.ts";
import type { IntentInput, IntentOutput, IntentTaskKind } from "./intent-types.ts";

const ENGINEERING_KEYWORDS: Array<{ kind: IntentTaskKind; pattern: RegExp }> = [
	{ kind: "bugfix", pattern: /\bbug\b|錯誤|失敗|修|修復|壞掉|crash|error|fix/i },
	{ kind: "testing", pattern: /測試|test|驗證/i },
	{ kind: "review", pattern: /review|審查|檢查/i },
	{ kind: "planning", pattern: /計畫|規劃|plan/i },
	{ kind: "design", pattern: /設計|方案|architecture|架構/i },
	{ kind: "refactor", pattern: /重構|refactor/i },
	{ kind: "implementation", pattern: /實作|開發|新增|加入|幫我|請幫我|implement|build|add/i },
];

const NON_ENGINEERING_PATTERN = /天氣|翻譯|改寫|摘要|介紹|是什麼|what is|how are you/i;
const FILE_OR_SYMBOL_PATTERN = /[\w./-]+\.[A-Za-z0-9]+|`([^`]+)`|[A-Z]{2,}-\d+/g;

export function understandIntent(input: IntentInput): IntentOutput {
	const resume = checkForResume(input);
	if (resume) {
		return resume;
	}

	const message = input.userMessage.trim();
	if (input.hasSlashCommand || message.length === 0 || NON_ENGINEERING_PATTERN.test(message)) {
		return {
			ambiguities: [],
			goal: message,
			lightDiscoverySeeds: [],
			route: "passthrough",
			taskKind: "unknown",
		};
	}

	const taskKind = detectTaskKind(message);
	if (taskKind === "unknown") {
		return {
			ambiguities: [],
			goal: message,
			lightDiscoverySeeds: [],
			route: "passthrough",
			taskKind,
		};
	}

	return {
		// ponytail: ambiguity 先只做最省的字串線索；不在 v1 假裝懂完整需求。
		ambiguities: /方案|選哪個|要不要|如何/i.test(message) ? ["needs-grill"] : [],
		goal: message,
		lightDiscoverySeeds: extractSeeds(message),
		route: "start_forge",
		taskKind,
	};
}

function detectTaskKind(message: string): IntentTaskKind {
	for (const candidate of ENGINEERING_KEYWORDS) {
		if (candidate.pattern.test(message)) {
			return candidate.kind;
		}
	}

	return "unknown";
}

function extractSeeds(message: string): string[] {
	const matches = message.match(FILE_OR_SYMBOL_PATTERN) ?? [];
	const quoted = matches.map((match) => match.replaceAll("`", "").trim()).filter(Boolean);
	const words = message
		.split(/\s+/)
		.flatMap(splitMixedToken)
		.filter((word) => word.length >= 2 && /[A-Za-z\u4e00-\u9fff]/.test(word))
		.slice(0, 6);

	return [...new Set([...quoted, ...words])].slice(0, 8);
}

function splitMixedToken(token: string): string[] {
	return token
		.trim()
		.split(/(?<=[\u4e00-\u9fff])(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])(?=[\u4e00-\u9fff])/)
		.filter(Boolean);
}
