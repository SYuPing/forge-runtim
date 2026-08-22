import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runLightDiscovery } from "../../src/discovery/light-discovery.ts";

function createRoot(): string {
	return mkdtempSync(join(tmpdir(), "forge-runtime-light-discovery-"));
}

test("LightDiscovery_WhenGivenRawMessage_ShouldReturnDeterministicMetadataOnlyMatches", (t) => {
	const rootDir = createRoot();
	mkdirSync(join(rootDir, "wiki", "nested"), { recursive: true });
	mkdirSync(join(rootDir, "code_base", "src"), { recursive: true });
	writeFileSync(join(rootDir, "wiki", "nested", "zeta-guide.md"), "全文不應出現在結果", "utf8");
	writeFileSync(join(rootDir, "wiki", "alpha-guide.md"), "另一份全文", "utf8");
	writeFileSync(join(rootDir, "code_base", "src", "zeta-adapter.ts"), "const secret = true;", "utf8");
	writeFileSync(join(rootDir, "code_base", "src", "alpha-adapter.ts"), "const secret = false;", "utf8");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const result = runLightDiscovery(rootDir, "請查找 Zeta alpha");
	assert.deepEqual(result.matches, [
		{ source: "code_base", relativePath: "src/alpha-adapter.ts", fileName: "alpha-adapter.ts", extension: ".ts" },
		{ source: "code_base", relativePath: "src/zeta-adapter.ts", fileName: "zeta-adapter.ts", extension: ".ts" },
		{ source: "wiki", relativePath: "alpha-guide.md", fileName: "alpha-guide.md", extension: ".md" },
		{ source: "wiki", relativePath: "nested/zeta-guide.md", fileName: "zeta-guide.md", extension: ".md" },
	]);
	assert.deepEqual(result.sourceAvailability, { wiki: true, code_base: true });
	assert.deepEqual(result.warnings, []);
	assert.equal("content" in result, false);
	assert.equal("summary" in result, false);
	assert.equal("snapshot" in result, false);
});

test("LightDiscovery_WhenSourceHasManyMatches_ShouldKeepThreeSortedPerSource", (t) => {
	const rootDir = createRoot();
	mkdirSync(join(rootDir, "wiki"), { recursive: true });
	mkdirSync(join(rootDir, "code_base"), { recursive: true });
	for (const name of ["c-needle.md", "a-needle.md", "b-needle.md", "d-needle.md"]) writeFileSync(join(rootDir, "wiki", name), "", "utf8");
	for (const name of ["c-needle.ts", "a-needle.ts", "b-needle.ts", "d-needle.ts"]) writeFileSync(join(rootDir, "code_base", name), "", "utf8");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const result = runLightDiscovery(rootDir, "needle");
	assert.deepEqual(result.matches.map(({ source, relativePath }) => `${source}/${relativePath}`), [
		"code_base/a-needle.ts",
		"code_base/b-needle.ts",
		"code_base/c-needle.ts",
		"wiki/a-needle.md",
		"wiki/b-needle.md",
		"wiki/c-needle.md",
	]);
});

test("LightDiscovery_WhenSourceIsMissing_ShouldPreserveOtherMatchesAndWarn", (t) => {
	const rootDir = createRoot();
	mkdirSync(join(rootDir, "wiki"), { recursive: true });
	writeFileSync(join(rootDir, "wiki", "fallback.md"), "", "utf8");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const result = runLightDiscovery(rootDir, "fallback");
	assert.deepEqual(result.matches, [
		{ source: "wiki", relativePath: "fallback.md", fileName: "fallback.md", extension: ".md" },
	]);
	assert.deepEqual(result.sourceAvailability, { wiki: true, code_base: false });
	assert.ok(result.warnings.some((warning) => warning.includes("code_base")));
});

test("LightDiscovery_WhenWikiScanFails_ShouldPreserveCodeBaseMatchesAndReportWikiFailure", (t) => {
	const rootDir = createRoot();
	writeFileSync(join(rootDir, "wiki"), "not a directory", "utf8");
	mkdirSync(join(rootDir, "code_base"), { recursive: true });
	writeFileSync(join(rootDir, "code_base", "partial-match.ts"), "", "utf8");
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const result = runLightDiscovery(rootDir, "partial-match.ts");
	assert.deepEqual(result.matches, [
		{ source: "code_base", relativePath: "partial-match.ts", fileName: "partial-match.ts", extension: ".ts" },
	]);
	assert.deepEqual(result.sourceAvailability, { wiki: false, code_base: true });
	assert.equal(result.warnings.length, 1);
	assert.match(result.warnings[0]!, /^wiki 來源無法讀取：.+/);
});

test("LightDiscovery_WhenMessageHasNoUsefulSeed_ShouldReturnAvailableSourcesWithoutMatches", (t) => {
	const rootDir = createRoot();
	mkdirSync(join(rootDir, "wiki"), { recursive: true });
	mkdirSync(join(rootDir, "code_base"), { recursive: true });
	t.after(() => rmSync(rootDir, { force: true, recursive: true }));

	const result = runLightDiscovery(rootDir, "?");
	assert.deepEqual(result.matches, []);
	assert.deepEqual(result.sourceAvailability, { wiki: true, code_base: true });
});
