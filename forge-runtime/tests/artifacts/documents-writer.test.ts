import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	captureDocumentsBase,
	commitDocumentsBundle,
	renderDeliverableDocuments,
} from "../../src/artifacts/documents-writer.ts";
import { createEvidencePackage } from "../../src/evidence/evidence-engine.ts";

test("CommitDocuments_WhenTargetsAreAbsent_ShouldCreateManagedBlocks", (t) => {
	const rootDir = mkdtempSync(join(tmpdir(), "forge-documents-writer-"));
	t.after(() => rmSync(rootDir, { recursive: true, force: true }));

	const baseHash = captureDocumentsBase(rootDir);
	const result = commitDocumentsBundle({
		rootDir,
		expectedBaseHash: baseHash,
		documents: {
			context: "Context body",
			adr: "ADR body",
			handoff: "Handoff body",
		},
	});

	assert.equal(result.kind, "committed");
	const documentsDir = join(rootDir, "Documents");
	const files = [
		["CONTEXT.md", "CONTEXT"],
		["ADR.md", "ADR"],
		["handoff.md", "HANDOFF"],
	] as const;

	for (const [fileName, marker] of files) {
		const content = readFileSync(join(documentsDir, fileName), "utf8");
		assert.match(content, new RegExp(`<!-- forge-runtime:${marker}:begin -->`));
		assert.match(content, new RegExp(`<!-- forge-runtime:${marker}:end -->`));
		const body = fileName === "CONTEXT.md"
			? "Context body"
			: fileName === "ADR.md"
				? "ADR body"
				: "Handoff body";
		assert.equal(content.split(body).length - 1, 1);
	}
});

test("CommitDocuments_WhenTargetsExist_ShouldPreserveUnmanagedContent", (t) => {
	const rootDir = mkdtempSync(join(tmpdir(), "forge-documents-writer-"));
	t.after(() => rmSync(rootDir, { recursive: true, force: true }));

	const documentsDir = join(rootDir, "Documents");
	mkdirSync(documentsDir);
	const files = [
		["CONTEXT.md", "CONTEXT", "context"],
		["ADR.md", "ADR", "adr"],
		["handoff.md", "HANDOFF", "handoff"],
	] as const;
	for (const [fileName, marker, key] of files) {
		const begin = `<!-- forge-runtime:${marker}:begin -->`;
		const end = `<!-- forge-runtime:${marker}:end -->`;
		writeFileSync(
			join(documentsDir, fileName),
			`unmanaged-prefix-${key}\n${begin}\nold-${key}-body\n${end}\nunmanaged-suffix-${key}\n`,
		);
	}

	const baseHash = captureDocumentsBase(rootDir);
	const result = commitDocumentsBundle({
		rootDir,
		expectedBaseHash: baseHash,
		documents: {
			context: "new-context-body",
			adr: "new-adr-body",
			handoff: "new-handoff-body",
		},
	});

	assert.equal(result.kind, "committed");
	for (const [fileName, marker, key] of files) {
		const content = readFileSync(join(documentsDir, fileName), "utf8");
		const prefix = `unmanaged-prefix-${key}`;
		const suffix = `unmanaged-suffix-${key}`;
		const oldBody = `old-${key}-body`;
		const newBody = `new-${key}-body`;
		const begin = `<!-- forge-runtime:${marker}:begin -->`;
		const end = `<!-- forge-runtime:${marker}:end -->`;

		assert.equal(content.split(prefix).length - 1, 1);
		assert.equal(content.split(suffix).length - 1, 1);
		assert.ok(content.indexOf(prefix) < content.indexOf(suffix));
		assert.equal(content.split(oldBody).length - 1, 0);
		assert.equal(content.split(newBody).length - 1, 1);
		assert.equal(content.split(begin).length - 1, 1);
		assert.equal(content.split(end).length - 1, 1);
	}

	assert.deepEqual(readdirSync(documentsDir).filter((name) => name.includes(".tmp") || name.includes(".bak")), []);
});

test("CommitDocuments_WhenBaseHashChanged_ShouldRejectWithoutWrites", (t) => {
	const rootDir = mkdtempSync(join(tmpdir(), "forge-documents-writer-"));
	t.after(() => rmSync(rootDir, { recursive: true, force: true }));

	const documentsDir = join(rootDir, "Documents");
	mkdirSync(documentsDir);
	const files = [
		["CONTEXT.md", "CONTEXT", "context"],
		["ADR.md", "ADR", "adr"],
		["handoff.md", "HANDOFF", "handoff"],
	] as const;
	for (const [fileName, marker, key] of files) {
		const begin = `<!-- forge-runtime:${marker}:begin -->`;
		const end = `<!-- forge-runtime:${marker}:end -->`;
		writeFileSync(
			join(documentsDir, fileName),
			`unmanaged-prefix-${key}\n${begin}\nold-${key}-body\n${end}\nunmanaged-suffix-${key}\n`,
		);
	}

	const baseHash = captureDocumentsBase(rootDir);
	const contextPath = join(documentsDir, "CONTEXT.md");
	writeFileSync(
		contextPath,
		readFileSync(contextPath, "utf8").replace("unmanaged-prefix-context", "user-edited-prefix-context"),
	);
	const beforeBytes = new Map(files.map(([fileName]) => [fileName, readFileSync(join(documentsDir, fileName))]));

	const result = commitDocumentsBundle({
		rootDir,
		expectedBaseHash: baseHash,
		documents: {
			context: "new-context-body",
			adr: "new-adr-body",
			handoff: "new-handoff-body",
		},
	});

	assert.equal(result.kind, "conflict");
	for (const [fileName] of files) {
		assert.deepEqual(readFileSync(join(documentsDir, fileName)), beforeBytes.get(fileName));
	}
	assert.deepEqual(readdirSync(documentsDir).filter((name) => name.includes(".tmp") || name.includes(".bak")), []);
});

test("CommitDocuments_WhenSecondInstallFails_ShouldRollbackAllTargets", (t) => {
	const rootDir = mkdtempSync(join(tmpdir(), "forge-documents-writer-"));
	t.after(() => rmSync(rootDir, { recursive: true, force: true }));

	const documentsDir = join(rootDir, "Documents");
	mkdirSync(documentsDir);
	const files = [
		["CONTEXT.md", "CONTEXT", "context"],
		["ADR.md", "ADR", "adr"],
		["handoff.md", "HANDOFF", "handoff"],
	] as const;
	for (const [fileName, marker, key] of files) {
		const begin = `<!-- forge-runtime:${marker}:begin -->`;
		const end = `<!-- forge-runtime:${marker}:end -->`;
		writeFileSync(
			join(documentsDir, fileName),
			`unmanaged-prefix-${key}\n${begin}\nold-${key}-body\n${end}\nunmanaged-suffix-${key}\n`,
		);
	}

	const expectedBaseHash = captureDocumentsBase(rootDir);
	const beforeBytes = new Map(files.map(([fileName]) => [fileName, readFileSync(join(documentsDir, fileName))]));
	let installCount = 0;
	const installStagedFile = (source: string, target: string): void => {
		installCount += 1;
		if (installCount === 2) throw new Error("injected install failure");
		linkSync(source, target);
	};

	const result = commitDocumentsBundle({
		rootDir,
		expectedBaseHash,
		documents: {
			context: "new-context-body",
			adr: "new-adr-body",
			handoff: "new-handoff-body",
		},
	}, installStagedFile);

	assert.equal(result.kind, "failed");
	assert.ok(result.errors.some((error) => error.includes("injected install failure")));
	assert.equal(installCount, 2);
	for (const [fileName] of files) {
		assert.deepEqual(readFileSync(join(documentsDir, fileName)), beforeBytes.get(fileName));
	}
	assert.deepEqual(readdirSync(documentsDir).filter((name) => name.includes(".tmp") || name.includes(".bak")), []);
});

test("RenderDocuments_WhenHumanPremiseIsOnlyEvidence_ShouldProduceTraceableDesignWithoutRawSources", () => {
	const evidenceId = "human-premise-render-1";
	const rawAnswer = "RAW_ANSWER_MUST_NOT_APPEAR";
	const summarySentinel = "SUMMARY_MUST_NOT_APPEAR";
	const knowledgePackage = createEvidencePackage({
		knowledgeSummary: summarySentinel,
		inherited: [],
		supplemental: [],
		humanPremise: [{
			evidenceId,
			kind: "human_premise",
			source: "forge://human-premise",
			title: "使用者前提",
			content: `使用者確認產品範圍：${rawAnswer}`,
			metadata: { decisionId: "decision-render-1" },
		}],
		decisions: [{
			decisionId: "decision-render-1",
			statement: "採用以使用者前提建立產品 Context",
			evidenceIds: [evidenceId],
		}],
		findings: [{
			statement: "推論：產品範圍由使用者前提界定",
			evidenceIds: [evidenceId],
		}],
		limitations: [{
			statement: "Spec Gap：外部產品文件尚未提供，現階段不阻擋建立設計文件",
			blocking: false,
		}],
		specGap: {
			target: "外部產品文件",
			reason: "尚未提供外部文件",
			missingEvidence: ["external-product-documentation"],
			impact: "不阻擋使用者前提驅動的初始設計",
		},
	});
	const contextCandidate = {
		glossary: [{
			term: "使用者前提",
			definition: "由使用者明確確認、可追溯但不取代外部事實的需求基礎",
			evidenceIds: [evidenceId],
		}],
	};
	const adrBuildCandidate = {
		records: [{
			decision: "採用使用者前提作為初始 Context",
			rationale: "目前唯一證據是使用者確認，且其足以表達產品意圖",
			consequences: ["後續外部事實需補入 Spec Gap"],
			citations: [evidenceId],
		}],
		handoff: {
			summary: "已完成使用者前提驅動的初始設計",
			nextSessionFocus: "補充外部產品文件並驗證 Spec Gap",
			references: ["Documents/CONTEXT.md", "Documents/ADR.md"],
			suggestedSkills: ["domain-modeling", "handoff"],
		},
	};

	const result = renderDeliverableDocuments({ knowledgePackage, contextCandidate, adrBuildCandidate });

	assert.match(result.context, /使用者前提/);
	assert.match(result.context, /採用以使用者前提建立產品 Context/);
	assert.match(result.context, /推論：產品範圍由使用者前提界定/);
	assert.match(result.context, /Spec Gap/);
	assert.match(result.context, new RegExp(evidenceId));
	assert.match(result.context, /human_premise/);
	assert.match(result.adr, /採用使用者前提作為初始 Context/);
	assert.match(result.adr, /目前唯一證據是使用者確認/);
	assert.match(result.adr, /後續外部事實需補入 Spec Gap/);
	assert.match(result.adr, new RegExp(evidenceId));
	assert.match(result.handoff, /已完成使用者前提驅動的初始設計/);
	assert.match(result.handoff, /補充外部產品文件並驗證 Spec Gap/);
	assert.match(result.handoff, /Documents\/CONTEXT\.md/);
	assert.match(result.handoff, /domain-modeling/);
	assert.ok(!result.handoff.includes("目前唯一證據是使用者確認"));

	for (const document of [result.context, result.adr, result.handoff]) {
		assert.ok(!document.includes(rawAnswer));
		assert.ok(!document.includes(summarySentinel));
	}
});

test("RenderDeliverableDocuments_WhenHandoffContainsHighConfidencePii_ShouldRedactOutput", () => {
	const evidenceId = "handoff-pii-1";
	const email = "jane@example.com";
	const phone = "+886 912-345-678";
	const homePath = "C:\\Users\\Alice\\private";
	const knowledgePackage = createEvidencePackage({
		knowledgeSummary: "僅供測試的摘要，不應直接輸出",
		inherited: [],
		supplemental: [],
		humanPremise: [{
			evidenceId,
			kind: "human_premise",
			source: "forge://human-premise",
			title: "使用者前提",
			content: "使用者已確認初始範圍",
			metadata: { decisionId: "handoff-pii-decision" },
		}],
		decisions: [{
			decisionId: "handoff-pii-decision",
			statement: "採用使用者前提建立初始 Context",
			evidenceIds: [evidenceId],
		}],
		findings: [],
		limitations: [],
	});
	const result = renderDeliverableDocuments({
		knowledgePackage,
		contextCandidate: {
			glossary: [{
				term: "使用者前提",
				definition: "可追溯的需求基礎",
				evidenceIds: [evidenceId],
			}],
		},
		adrBuildCandidate: {
			records: [{
				decision: "採用使用者前提作為初始 Context",
				rationale: "使用者已明確確認",
				consequences: ["後續補充外部事實"],
				citations: [evidenceId],
			}],
			handoff: {
				summary: `聯絡人 ${email}，電話 ${phone}`,
				nextSessionFocus: `檢查路徑 ${homePath}`,
				references: ["Documents/CONTEXT.md", "Documents/ADR.md"],
				suggestedSkills: ["domain-modeling", "handoff"],
			},
		},
	});

	assert.ok(!result.handoff.includes(email));
	assert.ok(!result.handoff.includes(phone));
	assert.ok(!result.handoff.includes(homePath));
	assert.match(result.handoff, /\[REDACTED\]|【已遮蔽】|\[已遮蔽\]/);
});
