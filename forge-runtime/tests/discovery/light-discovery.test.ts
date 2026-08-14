import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runLightDiscovery } from "../../src/discovery/light-discovery.ts";

test("LightDiscovery_WhenSnapshotCreated_ShouldDeepFreezeEvidence", async (t) => {
	const rootDir = mkdtempSync(join(tmpdir(), "forge-runtime-light-discovery-"));
	mkdirSync(join(rootDir, "wiki"), { recursive: true });
	mkdirSync(join(rootDir, "code_base", "src"), { recursive: true });
	writeFileSync(join(rootDir, "wiki", "snapshot.md"), "SnapshotEvidenceNeedle documents the Grill evidence contract.\n", "utf8");
	writeFileSync(
		join(rootDir, "code_base", "src", "snapshot-evidence-candidate.ts"),
		"// SnapshotEvidenceNeedle is a frozen code base candidate.\nexport const snapshotEvidence = true;\n",
		"utf8",
	);
	t.after(() => {
		rmSync(rootDir, { force: true, recursive: true });
	});

	const result = await runLightDiscovery(rootDir, ["SnapshotEvidenceNeedle", "snapshot-evidence-candidate.ts"]);
	const manifestEntry = result.snapshot.manifest.find((entry) => entry.kind === "code_base");
	assert.ok(manifestEntry, "Expected Light Discovery to include the selected code_base candidate");
	const candidate = result.snapshot.candidates[manifestEntry.candidateId];
	assert.ok(candidate, "Expected the manifest candidate to resolve from the public snapshot");
	assert.ok(candidate.metadata.matches, "Expected code_base candidate metadata to include matched signals");

	assert.equal(Object.isFrozen(result.snapshot), true);
	assert.equal(Object.isFrozen(result.snapshot.manifest), true);
	assert.equal(Object.isFrozen(manifestEntry), true);
	assert.equal(Object.isFrozen(result.snapshot.candidates), true);
	assert.equal(Object.isFrozen(candidate), true);
	assert.equal(Object.isFrozen(candidate.metadata), true);
	assert.equal(Object.isFrozen(candidate.metadata.matches), true);

	const originalContent = candidate.content;
	assert.throws(() => {
		(candidate as { content: string }).content = "mutated";
	}, TypeError);
	assert.equal(candidate.content, originalContent);
});
