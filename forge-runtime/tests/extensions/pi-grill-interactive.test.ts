import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "../../../pi-main/packages/ai/src/compat.ts";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../../pi-main/packages/coding-agent/src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../../pi-main/packages/coding-agent/src/core/auth-storage.ts";
import { SessionManager } from "../../../pi-main/packages/coding-agent/src/core/session-manager.ts";
import type { ExtensionAPI, ExtensionFactory } from "../../../pi-main/packages/coding-agent/src/index.ts";
import { InteractiveMode } from "../../../pi-main/packages/coding-agent/src/modes/interactive/interactive-mode.ts";
import { VirtualTerminal } from "../../../pi-main/packages/tui/test/virtual-terminal.ts";
import forgeRuntimeExtension from "../../extensions/forge-runtime.ts";
import { runLightDiscovery } from "../../src/discovery/light-discovery.ts";

type ForgeExtensionApi = Parameters<typeof forgeRuntimeExtension>[0];

// PI 的 on overload 集合與 Forge runtime contract 結構不同；真實 TUI tests 覆蓋 runtime contract。
// 這是僅限測試的 overload-set bridge；四個真實 TUI lifecycle tests 驗證 runtime contract。
const installForgeRuntimeExtension = (pi: ExtensionAPI): void => forgeRuntimeExtension(pi as unknown as ForgeExtensionApi);

async function waitForViewport(terminal: VirtualTerminal, text: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const viewport = (await terminal.flushAndGetViewport()).join("\n");
		if (viewport.includes(text)) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.fail(`TUI viewport did not contain ${JSON.stringify(text)}`);
}

test("PiTui_WhenNeedsConfirmationCompletes_ShouldShowQuestionAndAdvanceAfterAnswer", async () => {
	const tempDir = join(tmpdir(), `pi-grill-tui-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	mkdirSync(join(tempDir, "wiki"), { recursive: true });
	mkdirSync(join(tempDir, "code_base"), { recursive: true });
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	let mode: InteractiveMode | undefined;
	try {
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
		const extensionFactory: ExtensionFactory = installForgeRuntimeExtension;
		const runtimeOptions = {
			agentDir: tempDir,
			authStorage,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.registerProvider(faux.getModel().provider, {
							baseUrl: faux.getModel().baseUrl,
							apiKey: "faux-key",
							api: faux.api,
							models: faux.models.map((model) => ({
								id: model.id,
								name: model.name,
								api: model.api,
								reasoning: model.reasoning,
								input: model.input,
								cost: model.cost,
								contextWindow: model.contextWindow,
								maxTokens: model.maxTokens,
							})),
						});
						extensionFactory(pi);
					},
				],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({ ...runtimeOptions, cwd });
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: runtimeOptions.model,
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};
		runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir),
		});
		await runtime.session.bindExtensions({});

		faux.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("forge_grill_complete", {
					evidence: [],
					questions: [{ id: "q-proceed", question: "是否進入 deep knowledge？", options: ["是", "否"] }],
					recommendation: { reason: "需要使用者確認。", value: "是" },
					requiresUserConfirmation: true,
					roundId: "grill-1",
					status: "NEEDS_CONFIRMATION",
				}, { id: "call-complete-1" })],
			),
			fauxAssistantMessage("已收到確認。"),
		]);
		mode = new InteractiveMode(runtime, { terminal, uiMode: "regular" });
		void mode.run();
		await new Promise((resolve) => setTimeout(resolve, 100));
		terminal.sendInput("請幫我測試 Forge");
		terminal.sendInput("\r");
		await waitForViewport(terminal, "是否進入 deep knowledge？");
		terminal.sendInput("是");
		terminal.sendInput("\r");
		await waitForViewport(terminal, "grill-2");
		assert.equal(runtime.session.messages.some((message) => JSON.stringify(message).includes("grill-2")), true);
	} finally {
		mode?.stop();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});

test("PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue", async () => {
	const tempDir = join(tmpdir(), `pi-grill-tui-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	mkdirSync(join(tempDir, "wiki"), { recursive: true });
	mkdirSync(join(tempDir, "code_base"), { recursive: true });
	writeFileSync(join(tempDir, "code_base", "test.ts"), "// test candidate\nexport const test = true;\n");
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	let mode: InteractiveMode | undefined;
	try {
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
		const extensionFactory: ExtensionFactory = installForgeRuntimeExtension;
		const runtimeOptions = {
			agentDir: tempDir,
			authStorage,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.registerProvider(faux.getModel().provider, {
							baseUrl: faux.getModel().baseUrl,
							apiKey: "faux-key",
							api: faux.api,
							models: faux.models.map((model) => ({
								id: model.id,
								name: model.name,
								api: model.api,
								reasoning: model.reasoning,
								input: model.input,
								cost: model.cost,
								contextWindow: model.contextWindow,
								maxTokens: model.maxTokens,
							})),
						});
						extensionFactory(pi);
					},
				],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({ ...runtimeOptions, cwd });
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: runtimeOptions.model,
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};
		runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir),
		});
		await runtime.session.bindExtensions({});
		const lightDiscovery = await runLightDiscovery(tempDir, ["test"]);
		const candidate = lightDiscovery.codeBaseCandidates[0];
		assert.ok(candidate, "expected a test code_base candidate");
		const candidateId = lightDiscovery.snapshot.manifest.find((entry) => entry.kind === "code_base")?.candidateId;
		assert.ok(candidateId, "expected a code_base evidence candidate");

		faux.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("forge_grill_evidence", {
					candidateId,
				}, { id: "call-evidence-1" })],
			),
			fauxAssistantMessage(
				[fauxToolCall("forge_grill_complete", {
					evidence: [candidateId],
					questions: [],
					recommendation: { reason: "候選相關性足夠。", value: "進入 deep knowledge" },
					requiresUserConfirmation: false,
					roundId: "grill-1",
					status: "READY_FOR_DEEP",
				}, { id: "call-complete-ready-1" })],
			),
			fauxAssistantMessage("已完成 deep knowledge。")
		]);
		mode = new InteractiveMode(runtime, { terminal, uiMode: "regular" });
		void mode.run();
		await new Promise((resolve) => setTimeout(resolve, 100));
		terminal.sendInput("請幫我測試 test");
		terminal.sendInput("\r");
		await waitForViewport(terminal, "KNOWLEDGE_UNDERSTANDING");
		assert.doesNotMatch((await terminal.flushAndGetViewport()).join("\n"), /continue/i);
		const userMessages = runtime.session.messages.filter((message) => message.role === "user");
		assert.equal(userMessages.length, 1);
		assert.match(JSON.stringify(userMessages[0]), /請幫我測試 test/);
	} finally {
		mode?.stop();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});

test("PiTui_WhenCompletionIsOmitted_ShouldRecoverOnceAndSettle", async () => {
	const tempDir = join(tmpdir(), `pi-grill-tui-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	mkdirSync(join(tempDir, "wiki"), { recursive: true });
	mkdirSync(join(tempDir, "code_base"), { recursive: true });
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	let mode: InteractiveMode | undefined;
	try {
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
		const extensionFactory: ExtensionFactory = installForgeRuntimeExtension;
		const runtimeOptions = {
			agentDir: tempDir,
			authStorage,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.registerProvider(faux.getModel().provider, {
							baseUrl: faux.getModel().baseUrl,
							apiKey: "faux-key",
							api: faux.api,
							models: faux.models.map((model) => ({
								id: model.id,
								name: model.name,
								api: model.api,
								reasoning: model.reasoning,
								input: model.input,
								cost: model.cost,
								contextWindow: model.contextWindow,
								maxTokens: model.maxTokens,
							})),
						});
						extensionFactory(pi);
					},
				],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({ ...runtimeOptions, cwd });
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: runtimeOptions.model,
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};
		runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir),
		});
		await runtime.session.bindExtensions({});

		faux.setResponses([fauxAssistantMessage("模型回覆未完成。"), fauxAssistantMessage("retry-attempt-completed")]);
		mode = new InteractiveMode(runtime, { terminal, uiMode: "regular" });
		void mode.run();
		await new Promise((resolve) => setTimeout(resolve, 100));
		terminal.sendInput("請幫我測試 Forge");
		terminal.sendInput("\r");
		await waitForViewport(terminal, "GRILL_COMPLETION_REQUIRED");
		const viewport = (await terminal.flushAndGetViewport()).join("\n");
		assert.match(viewport, /\/forge-runtime retry/);
		assert.match(viewport, /\/forge-runtime cancel/);
		assert.match(viewport, /\/forge-runtime switch <request>/);
		const recoveryPanels = runtime.session.messages.filter((message) => JSON.stringify(message).includes("GRILL_COMPLETION_REQUIRED"));
		assert.equal(recoveryPanels.length, 1);
		const assistantMessagesAtRecovery = runtime.session.messages.filter((message) => message.role === "assistant").length;
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(runtime.session.messages.filter((message) => message.role === "user").length, 1);
		assert.equal(runtime.session.messages.filter((message) => message.role === "assistant").length, assistantMessagesAtRecovery);
		assert.equal(faux.getPendingResponseCount(), 0);

		terminal.sendInput("/forge-runtime retry");
		terminal.sendInput("\r");
		await waitForViewport(terminal, "retry-attempt-completed");
		assert.equal(runtime.session.messages.filter((message) => message.role === "user").length, 2);
	} finally {
		mode?.stop();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});

test("PiTui_WhenSingleInputRuns_ShouldBoundAssistantTurns", async () => {
	const tempDir = join(tmpdir(), `pi-grill-tui-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	mkdirSync(join(tempDir, "wiki"), { recursive: true });
	mkdirSync(join(tempDir, "code_base"), { recursive: true });
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	let mode: InteractiveMode | undefined;
	try {
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
		const extensionFactory: ExtensionFactory = installForgeRuntimeExtension;
		const runtimeOptions = {
			agentDir: tempDir,
			authStorage,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.registerProvider(faux.getModel().provider, {
							baseUrl: faux.getModel().baseUrl,
							apiKey: "faux-key",
							api: faux.api,
							models: faux.models.map((model) => ({
								id: model.id,
								name: model.name,
								api: model.api,
								reasoning: model.reasoning,
								input: model.input,
								cost: model.cost,
								contextWindow: model.contextWindow,
								maxTokens: model.maxTokens,
							})),
						});
						extensionFactory(pi);
					},
				],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({ ...runtimeOptions, cwd });
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: runtimeOptions.model,
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};
		runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir),
		});
		await runtime.session.bindExtensions({});

		faux.setResponses([fauxAssistantMessage("模型回覆未完成。")]);
		mode = new InteractiveMode(runtime, { terminal, uiMode: "regular" });
		void mode.run();
		await new Promise((resolve) => setTimeout(resolve, 100));
		terminal.sendInput("請幫我測試 Forge");
		terminal.sendInput("\r");
		await waitForViewport(terminal, "GRILL_COMPLETION_REQUIRED");

		const callCountAtRecovery = faux.state.callCount;
		const assistantMessagesAtRecovery = runtime.session.messages.filter((message) => message.role === "assistant").length;
		await new Promise((resolve) => setTimeout(resolve, 100));

		assert.equal(faux.state.callCount, callCountAtRecovery);
		assert.equal(
			runtime.session.messages.filter((message) => message.role === "assistant").length,
			assistantMessagesAtRecovery,
		);
		assert.equal(faux.getPendingResponseCount(), 0);
		assert.equal(runtime.session.messages.filter((message) => message.role === "user").length, 1);
	} finally {
		mode?.stop();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});
