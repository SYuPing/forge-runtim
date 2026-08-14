import assert from "node:assert/strict";
import test from "node:test";

test("UnderstandIntent_WhenInputMixesChineseAndEnglish_ShouldIncludeSpiAndRtlSeeds", async () => {
	const { understandIntent } = await import("../../src/intent/intent-understanding.ts");
	const result = understandIntent({
		userMessage: "實作spi rtl",
		hasSlashCommand: false,
		sessionState: "idle",
	});

	assert.equal(result.lightDiscoverySeeds.includes("spi"), true);
	assert.equal(result.lightDiscoverySeeds.includes("rtl"), true);
});
