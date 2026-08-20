import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { generateBranchSummary } from "../src/core/compaction/branch-summarization.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

const DISPLAY_ONLY_SENTINEL = "DISPLAY_ONLY_SENTINEL";
const NORMAL_SENTINEL = "NORMAL_SENTINEL";

describe("generateBranchSummary", () => {
	it("does not send excluded custom messages to the provider", async () => {
		let providerMessages: unknown;
		const streamFn: StreamFn = (_model, context) => {
			providerMessages = context.messages;
			const stream = createAssistantMessageEventStream();
			stream.push({
				type: "done",
				reason: "stop",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "summary" }],
					api: "openai-completions",
					provider: "test",
					model: "test-model",
					stopReason: "stop",
					timestamp: Date.now(),
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				},
			});
			return stream;
		};

		const entries = [
			{
				type: "custom_message",
				id: "display-only",
				parentId: null,
				timestamp: "2026-08-20T00:00:00.000Z",
				customType: "sentinel",
				content: DISPLAY_ONLY_SENTINEL,
				display: true,
				excludeFromContext: true,
			},
			{
				type: "custom_message",
				id: "normal",
				parentId: "display-only",
				timestamp: "2026-08-20T00:00:01.000Z",
				customType: "sentinel",
				content: NORMAL_SENTINEL,
				display: true,
				excludeFromContext: false,
			},
		] satisfies SessionEntry[];

		await generateBranchSummary(entries, {
			model: {
				id: "test-model",
				name: "Test model",
				api: "openai-completions",
				provider: "test",
				baseUrl: "https://example.test",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 2048,
			} satisfies Model<"openai-completions">,
			signal: new AbortController().signal,
			streamFn,
		});

		const payload = JSON.stringify(providerMessages);
		expect(payload).not.toContain(DISPLAY_ONLY_SENTINEL);
		expect(payload).toContain(NORMAL_SENTINEL);
	});
});
