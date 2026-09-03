import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { AdrBuildCandidate } from "../decision/adr-builder.ts";
import type { EvidenceDecision, EvidencePackage } from "../evidence/evidence-engine.ts";
import type { ContextCandidate } from "../knowledge/context-builder.ts";

export interface DocumentsContent {
	readonly context: string;
	readonly adr: string;
	readonly handoff: string;
}

export interface CommitDocumentsRequest {
	readonly rootDir: string;
	readonly expectedBaseHash: string;
	readonly documents: DocumentsContent;
}

export interface RenderDeliverableDocumentsRequest {
	readonly knowledgePackage: EvidencePackage;
	readonly contextCandidate: ContextCandidate;
	readonly adrBuildCandidate: AdrBuildCandidate;
	readonly humanDecisions?: readonly EvidenceDecision[];
}

export type CommitDocumentsResult =
	| Readonly<{ kind: "committed"; baseHash: string }>
	| Readonly<{ kind: "conflict"; error: string }>
	| Readonly<{ kind: "invalid" | "failed"; errors: readonly string[] }>;

export type InstallStagedFile = (stagedPath: string, targetPath: string) => void;

const DOCUMENTS = [
	{ fileName: "CONTEXT.md", key: "context", marker: "CONTEXT" },
	{ fileName: "ADR.md", key: "adr", marker: "ADR" },
	{ fileName: "handoff.md", key: "handoff", marker: "HANDOFF" },
] as const;

const citations = (evidenceIds: readonly string[]): string => evidenceIds.map((id) => `\`${id}\``).join("、");

function redactHandoffPii(value: string): string {
	return value
		.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[已遮蔽]")
		.replace(/(?:[A-Za-z]:\\Users\\|\/(?:home|Users)\/)[^\\/\s]+/g, "[已遮蔽]")
		.replace(/\+?\d[\d ().-]{7,}\d/g, (candidate) =>
			candidate.replace(/\D/g, "").length >= 9 ? "[已遮蔽]" : candidate,
		);
}

export function renderDeliverableDocuments(request: RenderDeliverableDocumentsRequest): DocumentsContent {
	const { knowledgePackage, contextCandidate, adrBuildCandidate } = request;
	const humanDecisions = request.humanDecisions ?? [];
	const context = [
		"# CONTEXT",
		"",
		"## 詞彙",
		...contextCandidate.glossary.map(
			(entry) => `- **${entry.term}**：${entry.definition}（證據：${citations(entry.evidenceIds)}）`,
		),
		"",
		"## 證據索引",
		...knowledgePackage.evidence.map(
			(evidence) => `- \`${evidence.evidenceId}\`｜${evidence.kind}｜${evidence.title}`,
		),
		"",
		"## 已確認決策",
		...knowledgePackage.decisions.map(
			(decision) => `- ${decision.statement}（證據：${citations(decision.evidenceIds)}）`,
		),
		...(humanDecisions.length > 0
			? [
					"",
					"## 後續使用者決策",
					...humanDecisions.map(
						(decision) =>
							`- \`${decision.decisionId}\`：${decision.statement}（證據：${citations(decision.evidenceIds)}）`,
					),
				]
			: []),
		"",
		"## 已驗證發現",
		...knowledgePackage.findings.map(
			(finding) => `- ${finding.statement}（證據：${citations(finding.evidenceIds)}）`,
		),
		"",
		"## 限制與 Spec Gap",
		...knowledgePackage.limitations.map(
			(limitation) => `- [${limitation.blocking ? "blocking" : "non-blocking"}] ${limitation.statement}`,
		),
		...(knowledgePackage.specGap
			? [
					`- 目標：${knowledgePackage.specGap.target}`,
					`- 原因：${knowledgePackage.specGap.reason}`,
					`- 缺少證據：${knowledgePackage.specGap.missingEvidence.join("、")}`,
					`- 影響：${knowledgePackage.specGap.impact}`,
				]
			: []),
	].join("\n");

	const adr = [
		"# ADR",
		...adrBuildCandidate.records.flatMap((record, index) => [
			"",
			`## 決策 ${index + 1}`,
			"",
			`**決策：** ${record.decision}`,
			"",
			`**理由：** ${record.rationale}`,
			"",
			"**後果：**",
			...record.consequences.map((consequence) => `- ${consequence}`),
			"",
			`**證據：** ${citations(record.citations)}`,
		]),
	].join("\n");

	const handoffCandidate = adrBuildCandidate.handoff;
	const handoff = [
		"# handoff",
		"",
		"## 目前狀態",
		redactHandoffPii(handoffCandidate.summary),
		"",
		"## 下一個 session 重點",
		redactHandoffPii(handoffCandidate.nextSessionFocus),
		"",
		"## 參考文件",
		...handoffCandidate.references.map((reference) => `- ${redactHandoffPii(reference)}`),
		"",
		"## Suggested skills",
		...handoffCandidate.suggestedSkills.map((skill) => `- ${redactHandoffPii(skill)}`),
	].join("\n");

	return { context, adr, handoff };
}

function resolveDocumentsDir(rootDir: string): string {
	if (typeof rootDir !== "string" || rootDir.trim().length === 0) {
		throw new Error("Documents writer 需要明確的 rootDir");
	}
	const root = resolve(rootDir);
	if (!statSync(root).isDirectory()) {
		throw new Error("Documents writer rootDir 必須是目錄");
	}
	const documentsDir = join(root, "Documents");
	if (existsSync(documentsDir)) {
		const entry = lstatSync(documentsDir);
		if (entry.isSymbolicLink() || !entry.isDirectory()) {
			throw new Error("Documents 路徑必須是實體目錄");
		}
	}
	return documentsDir;
}

export function captureDocumentsBase(rootDir: string): string {
	const documentsDir = resolveDocumentsDir(rootDir);
	const hash = createHash("sha256");
	for (const document of DOCUMENTS) {
		const target = join(documentsDir, document.fileName);
		hash.update(document.fileName).update("\0");
		if (!existsSync(target)) {
			hash.update("missing\0");
			continue;
		}
		const entry = lstatSync(target);
		if (entry.isSymbolicLink() || !entry.isFile()) {
			throw new Error(`${document.fileName} 必須是實體檔案`);
		}
		const content = readFileSync(target);
		hash.update("present\0").update(String(content.length)).update("\0").update(content);
	}
	return hash.digest("hex");
}

function renderManagedDocument(marker: string, body: string, existing?: string): string {
	const begin = `<!-- forge-runtime:${marker}:begin -->`;
	const end = `<!-- forge-runtime:${marker}:end -->`;
	if (typeof body !== "string" || body.trim().length === 0) {
		throw new Error(`${marker} 文件內容不得為空`);
	}
	if (body.includes("<!-- forge-runtime:")) {
		throw new Error(`${marker} 文件內容不得包含 Forge managed marker`);
	}
	const block = `${begin}\n${body.trim()}\n${end}`;
	if (existing === undefined || existing.length === 0) {
		return `${block}\n`;
	}
	const beginIndex = existing.indexOf(begin);
	const endIndex = existing.indexOf(end);
	if (beginIndex === -1 && endIndex === -1) {
		return `${existing}${existing.endsWith("\n") ? "" : "\n"}${block}\n`;
	}
	if (
		beginIndex === -1 ||
		endIndex < beginIndex ||
		existing.indexOf(begin, beginIndex + begin.length) !== -1 ||
		existing.indexOf(end, endIndex + end.length) !== -1
	) {
		throw new Error(`${marker} managed block 標記不完整或重複`);
	}
	return `${existing.slice(0, beginIndex)}${block}${existing.slice(endIndex + end.length)}`;
}

export function commitDocumentsBundle(
	request: CommitDocumentsRequest,
	installStagedFile: InstallStagedFile = linkSync,
): CommitDocumentsResult {
	let documentsDir: string;
	try {
		documentsDir = resolveDocumentsDir(request.rootDir);
	} catch (error) {
		return { kind: "invalid", errors: [error instanceof Error ? error.message : String(error)] };
	}

	let currentBaseHash: string;
	try {
		currentBaseHash = captureDocumentsBase(request.rootDir);
	} catch (error) {
		return { kind: "invalid", errors: [error instanceof Error ? error.message : String(error)] };
	}
	if (currentBaseHash !== request.expectedBaseHash) {
		return { kind: "conflict", error: "Documents base hash 已變更" };
	}

	const token = randomUUID();
	const staged: Array<{
		path: string;
		target: string;
		backup: string;
		existed: boolean;
		backedUp: boolean;
		installed: boolean;
	}> = [];
	try {
		mkdirSync(documentsDir, { recursive: true });
		for (const document of DOCUMENTS) {
			const target = join(documentsDir, document.fileName);
			const path = join(documentsDir, `.${document.fileName}.${token}.tmp`);
			const existed = existsSync(target);
			const existing = existed ? readFileSync(target, "utf8") : undefined;
			writeFileSync(path, renderManagedDocument(document.marker, request.documents[document.key], existing), {
				encoding: "utf8",
				flag: "wx",
			});
			staged.push({
				path,
				target,
				backup: join(documentsDir, `.${document.fileName}.${token}.bak`),
				existed,
				backedUp: false,
				installed: false,
			});
		}
		if (captureDocumentsBase(request.rootDir) !== request.expectedBaseHash) {
			return { kind: "conflict", error: "Documents base hash 在提交前已變更" };
		}
		for (const entry of staged) {
			if (entry.existed) {
				renameSync(entry.target, entry.backup);
				entry.backedUp = true;
			}
			installStagedFile(entry.path, entry.target);
			entry.installed = true;
			rmSync(entry.path);
		}
	} catch (error) {
		const rollbackErrors: string[] = [];
		for (const entry of [...staged].reverse()) {
			try {
				if (entry.installed) rmSync(entry.target, { force: true });
				if (entry.backedUp) renameSync(entry.backup, entry.target);
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
			}
		}
		return {
			kind: "failed",
			errors: [error instanceof Error ? error.message : String(error), ...rollbackErrors],
		};
	} finally {
		for (const entry of staged) {
			rmSync(entry.path, { force: true });
		}
	}
	for (const entry of staged) {
		if (entry.backedUp) rmSync(entry.backup, { force: true });
	}
	return { kind: "committed", baseHash: captureDocumentsBase(request.rootDir) };
}
