import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const result = spawnSync(
	process.platform === "win32" ? "pi.cmd" : "pi",
	[
		"--offline",
		"--no-session",
		"--no-extensions",
		"--extension",
		".pi/extensions/forge-runtime.ts",
	],
	{ cwd: "..", encoding: "utf8", shell: process.platform === "win32", timeout: 30_000 },
);
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

function assertPiInvocationStartedWithoutTimeout(): void {
	const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
	assert.notEqual(errorCode, "ETIMEDOUT", `Pi CLI timed out after 30 seconds:\n${output}`);
	assert.equal(result.error, undefined, `Pi CLI integration prerequisite unavailable:\n${result.error?.message ?? output}`);
	assert.ok(result.pid > 0, "Pi CLI integration prerequisite unavailable: subprocess did not start");
	if (process.platform === "win32") {
		assert.doesNotMatch(
			output,
			/'pi(?:\.cmd)?' is not recognized as an internal or external command/i,
			`Pi CLI integration prerequisite unavailable:\n${output}`,
		);
	}
}

test("Pi_WhenLoadingForgeRuntimeExtension_ShouldNotEmitTypeBoxSchemaResolutionError", () => {
	assertPiInvocationStartedWithoutTimeout();
	assert.doesNotMatch(output, /typebox\/build\/index\.mjs\/schema/i, output);
});

test("Pi_WhenLoadingForgeRuntimeExtension_ShouldNotFailDuringExtensionLoad", () => {
	assertPiInvocationStartedWithoutTimeout();
	assert.doesNotMatch(output, /Failed to load extension/i, output);
});
