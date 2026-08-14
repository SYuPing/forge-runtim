import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GrillEvidenceManifestEntry } from "../runtime/session-state.ts";
import { parseStructuredGrillResult, type StructuredGrillResult } from "./grill-result.ts";

const JSON_BLOCK_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;
const FRONTMATTER_PATTERN = /^---\s*\n[\s\S]*?\n---\s*\n?/;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GRILLING_SKILL_PATH = resolve(__dirname, "../../../.pi/skills/grilling/SKILL.md");

export function buildGrillingSkillInvocation(
	request: string,
	roundId?: string,
	manifest: readonly GrillEvidenceManifestEntry[] = [],
): string {
	const skillContent = readFileSync(GRILLING_SKILL_PATH, "utf8").replace(FRONTMATTER_PATTERN, "").trim();
	const referencesDir = dirname(GRILLING_SKILL_PATH).replace(/\\/g, "/");
	return [
		`<skill name="grilling" location="${GRILLING_SKILL_PATH.replace(/\\/g, "/")}">`,
		`References are relative to ${referencesDir}.`,
		"",
		skillContent,
		"</skill>",
		"",
			"正常輸出只能透過 forge_grill_evidence 與 forge_grill_complete；不得輸出 assistant prose、終局 JSON 或其他文字結果。",
		"Grill v1 僅允許 forge_grill_evidence 與 forge_grill_complete；所有其他工具（包含原生與未知工具）一律禁止。",
		"新 snapshot 的首輪完成前，必須使用 forge_grill_evidence 查核 snapshot manifest 中的 candidateId；同一 snapshot 的後續 round 可重用已查核 evidence。",
			"完成結果只能透過 forge_grill_complete 提交，不得以 assistant 文字或終局 JSON 取代。",
		"completion payload 欄位固定為：roundId、status、questions、recommendation、evidence、requiresUserConfirmation。",
		"若仍有一個最阻塞、必須由使用者決定的問題，status 輸出 NEEDS_CONFIRMATION。",
		"若資訊已足夠直接進 deep knowledge，status 輸出 READY_FOR_DEEP。",
		"NEEDS_CONFIRMATION 時，questions 只放一題，格式為 { id, question, options }。",
		"READY_FOR_DEEP 時，questions 輸出空陣列。",
		"options 必須是字串陣列，例如 [\"A\", \"B\"]；不要輸出 { id, value } 物件。",
		"recommendation 格式為 { value, reason, confidence }。",
		"evidence 只放 evidence id 字串陣列。",
		"NEEDS_CONFIRMATION 時 requiresUserConfirmation 必須是 true。",
		"READY_FOR_DEEP 時 requiresUserConfirmation 必須是 false。",
		"可查核來源只限以下 snapshot manifest；不得猜測或傳入 path。",
		"forge_grill_evidence 只接受 manifest 中的 candidateId。",
		...(roundId
			? [
				`目前 Grill roundId: ${roundId}`,
				"完成時必須呼叫 forge_grill_complete；completion payload 必須原樣包含此 roundId。",
				"不得輸出 assistant 終局 JSON 代替 completion tool。",
			]
			: []),
		...manifest.map((item) => `- ${item.candidateId} [${item.kind}] ${item.title} (${item.source})`),
		`任務：${request}`,
	].join("\n");
}

export function parseStructuredGrillResultMessage(text: string): StructuredGrillResult {
	const trimmed = text.trim();
	const fenced = trimmed.match(JSON_BLOCK_PATTERN)?.[1]?.trim();
	return parseStructuredGrillResult(fenced ?? trimmed);
}
