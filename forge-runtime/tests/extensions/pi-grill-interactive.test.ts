import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
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

type ForgeExtensionApi = Parameters<typeof forgeRuntimeExtension>[0];

// PI 的 on overload 集合與 Forge runtime contract 結構不同；真實 TUI tests 覆蓋 runtime contract。
// 這是僅限測試的 overload-set bridge；四個真實 TUI lifecycle tests 驗證 runtime contract。
const installForgeRuntimeExtension = (pi: ExtensionAPI): void => forgeRuntimeExtension(pi as unknown as ForgeExtensionApi);
const routerStartForgeResponse = () => fauxAssistantMessage('{"route":"start_forge"}');

function extractCandidateId(context: unknown): string {
	const candidateId = JSON.stringify(context).match(/\bev-[0-9a-f]{64}\b/)?.[0];
	assert.ok(candidateId, "expected the real Grill ingress to expose an opaque candidate id");
	return candidateId;
}

async function waitForViewport(terminal: VirtualTerminal, text: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const viewport = (await terminal.flushAndGetViewport()).join("\n");
		if (viewport.includes(text)) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.fail(`TUI viewport did not contain ${JSON.stringify(text)}`);
}

test("SuccessfulNeedsConfirmationCompletion_TerminatesTurnUntilUserAnswer", async () => {
	const tempDir = join(tmpdir(), `pi-grill-boundary-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	mkdirSync(join(tempDir, "wiki"), { recursive: true });
	mkdirSync(join(tempDir, "code_base"), { recursive: true });
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	let mode: InteractiveMode | undefined;
	let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
	let unsubscribeBoundary: () => void = () => {};
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
							}))
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
				...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: runtimeOptions.model })),
				services,
				diagnostics: services.diagnostics,
			};
		};
		runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
		});
		await runtime.session.bindExtensions({});
		const sentinelResponse = fauxAssistantMessage("舊回合 sentinel 不應被消耗");
		let boundaryResult: "idle" | "second-call" | "deadline" | undefined;
		let resolveBoundary!: (result: "idle" | "second-call" | "deadline") => void;
		const boundary = new Promise<"idle" | "second-call" | "deadline">((resolve) => {
			resolveBoundary = (result) => {
				if (boundaryResult) return;
				boundaryResult = result;
				if (boundaryTimer) {
					clearTimeout(boundaryTimer);
					boundaryTimer = undefined;
				}
				unsubscribeBoundary();
				unsubscribeBoundary = () => {};
				resolve(result);
			};
		});
		const boundaryDeadline = new Promise<"deadline">((resolve) => {
			boundaryTimer = setTimeout(() => {
				resolveBoundary("deadline");
				resolve("deadline");
			}, 2000);
		});
		unsubscribeBoundary = runtime.session.subscribe((event) => {
			if (event.type === "agent_settled") resolveBoundary("idle");
		});
		faux.setResponses([
			routerStartForgeResponse(),
			fauxAssistantMessage([fauxToolCall("forge_grill_complete", {
				evidence: [],
				questions: [{ id: "q-proceed", question: "是否進入 deep knowledge？", options: ["是", "否"] }],
				recommendation: { reason: "需要使用者確認。", value: "是" },
				requiresUserConfirmation: true,
				roundId: "grill-1",
				status: "NEEDS_CONFIRMATION",
			}, { id: "call-complete-1" })]),
			() => {
				resolveBoundary("second-call");
				return sentinelResponse;
			},
		]);
		mode = new InteractiveMode(runtime, { terminal, uiMode: "regular" });
		void mode.run();
		await new Promise((resolve) => setTimeout(resolve, 100));
		terminal.sendInput("請幫我測試 Forge");
		terminal.sendInput("\r");
		await waitForViewport(terminal, "是否進入 deep knowledge？");
		const boundaryOutcome = await Promise.race([boundary, boundaryDeadline]);
		assert.equal(
			boundaryOutcome,
			"idle",
			"WAIT_USER 顯示後舊回合未先終止：agent turn 未在使用者回答前 settle。",
		);
		const callCountAtWaitUser = faux.state.callCount;
		const assistantMessagesAtWaitUser = runtime.session.messages.filter((message) => message.role === "assistant").length;
		assert.equal(callCountAtWaitUser, 2, "router completion 與 Grill completion 應分開計數");
		assert.equal(faux.getPendingResponseCount(), 1);
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(faux.state.callCount, callCountAtWaitUser);
		assert.equal(runtime.session.messages.filter((message) => message.role === "assistant").length, assistantMessagesAtWaitUser);

			terminal.sendInput("是");
			terminal.sendInput("\r");
			for (let attempt = 0; attempt < 100; attempt += 1) {
				const userMessages = runtime.session.messages.filter((message) => message.role === "user");
				if (userMessages.length === 2 && JSON.stringify(userMessages[1]).includes("grill-2")) break;
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			assert.equal(runtime.session.messages.filter((message) => message.role === "user").length, 2);
		assert.match(JSON.stringify(runtime.session.messages), /grill-2/);
	} finally {
		if (boundaryTimer) {
			clearTimeout(boundaryTimer);
			boundaryTimer = undefined;
		}
		unsubscribeBoundary();
		mode?.stop();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});

test("SuccessfulReadyForDeepCompletion_ReturnsTerminatingResultWithoutConfirmationUi", async () => {
	const tempDir = join(tmpdir(), `pi-grill-ready-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	mkdirSync(join(tempDir, "wiki"), { recursive: true });
	mkdirSync(join(tempDir, "code_base"), { recursive: true });
	writeFileSync(join(tempDir, "code_base", "test.ts"), "// test candidate\nexport const test = true;\n");
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	let mode: InteractiveMode | undefined;
	let unsubscribeCompletion: () => void = () => {};
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
								id: model.id, name: model.name, api: model.api, reasoning: model.reasoning,
								input: model.input, cost: model.cost, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
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
				...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: runtimeOptions.model })),
				services,
				diagnostics: services.diagnostics,
			};
		};
		runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
		});
		await runtime.session.bindExtensions({});
		let resolveCompletion!: (result: unknown) => void;
		const completion = new Promise<unknown>((resolve) => {
			resolveCompletion = resolve;
		});
		unsubscribeCompletion = runtime.session.subscribe((event) => {
			if (event.type === "tool_execution_end" && event.toolName === "forge_grill_complete") {
				resolveCompletion(event.result);
			}
		});
		faux.setResponses([
			routerStartForgeResponse(),
			(context) => fauxAssistantMessage([fauxToolCall("forge_grill_evidence", { candidateId: extractCandidateId(context) }, { id: "call-evidence-ready-regression" })]),
			(context) => fauxAssistantMessage([fauxToolCall("forge_grill_complete", {
				evidence: [extractCandidateId(context)],
					questions: [],
					recommendation: { reason: "候選相關性足夠。", value: "進入 deep knowledge" },
					requiresUserConfirmation: false,
					roundId: "grill-1",
					status: "READY_FOR_DEEP",
				}, { id: "call-complete-ready-regression" })]),
			() => fauxAssistantMessage("已完成 deep knowledge。"),
		]);
		mode = new InteractiveMode(runtime, { terminal, uiMode: "regular" });
		void mode.run();
		await new Promise((resolve) => setTimeout(resolve, 100));
		terminal.sendInput("請幫我測試 test");
		terminal.sendInput("\r");
		const completionResult = await completion as { terminate?: unknown; details?: { status?: unknown } };
		await runtime.session.waitForIdle();
		assert.equal(completionResult.terminate, true);
		assert.equal(completionResult.details?.status, "READY_FOR_DEEP");
		const messages = runtime.session.messages.map((message) => JSON.stringify(message));
		assert.equal(messages.some((message) => message.includes("是否進入 deep knowledge？")), false);
		assert.equal(messages.some((message) => message.includes('"deliverAs":"displayOnly"') && message.includes("WAIT_USER")), false);
	} finally {
		unsubscribeCompletion();
		mode?.stop();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});

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
			routerStartForgeResponse(),
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
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const userMessages = runtime.session.messages.filter((message) => message.role === "user");
			if (userMessages.length >= 2 && JSON.stringify(userMessages[1]).includes("grill-2")) break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.equal(runtime.session.messages.some((message) => JSON.stringify(message).includes("grill-2")), true);
		await runtime.session.waitForIdle();
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
		faux.setResponses([
			routerStartForgeResponse(),
			(context) => fauxAssistantMessage([fauxToolCall("forge_grill_evidence", {
				candidateId: extractCandidateId(context),
			}, { id: "call-evidence-1" })]),
			(context) => fauxAssistantMessage(
				[fauxToolCall("forge_grill_complete", {
					evidence: [extractCandidateId(context)],
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

		faux.setResponses([routerStartForgeResponse(), fauxAssistantMessage("模型回覆未完成。"), fauxAssistantMessage("retry-attempt-completed")]);
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

		faux.setResponses([routerStartForgeResponse(), fauxAssistantMessage("模型回覆未完成。")]);
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

test("PiProvider_WhenWaitUserAnswerStartsNextRound_ShouldReceiveStructuredInvocationInsteadOfAnswer", async () => {
		const tempDir = join(tmpdir(), `pi-grill-round-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		mkdirSync(join(tempDir, "wiki"), { recursive: true });
		mkdirSync(join(tempDir, "code_base"), { recursive: true });
		await writeFile(join(tempDir, "code_base", "auth.md"), "auth implementation target\n");
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
		const request = "請實作 auth";
		const contexts: unknown[] = [];
		let firstRoundId: string | undefined;
		let firstCandidateId: string | undefined;
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
								id: model.id, name: model.name, api: model.api, reasoning: model.reasoning,
								input: model.input, cost: model.cost, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
							})),
						});
						extensionFactory(pi);
					},
				],
				noSkills: true, noPromptTemplates: true, noThemes: true,
			},
		};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({ ...runtimeOptions, cwd });
			return {
				...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: runtimeOptions.model })),
				services, diagnostics: services.diagnostics,
			};
		};
		runtime = await createAgentSessionRuntime(createRuntime, { cwd: tempDir, agentDir: tempDir, sessionManager: SessionManager.create(tempDir) });
		await runtime.session.bindExtensions({});
			faux.setResponses([
				routerStartForgeResponse(),
				(context) => {
					contexts.push(context);
					const invocation = JSON.stringify(context.messages);
					firstRoundId = invocation.match(/目前 Grill roundId:\s*(grill-\d+)/)?.[1];
					firstCandidateId = invocation.match(/\bev-[0-9a-f]{64}\b/)?.[0];
					assert.ok(firstRoundId, "first provider invocation did not include a roundId");
					assert.ok(firstCandidateId, "first provider invocation did not include a code_base candidateId");
					return fauxAssistantMessage([fauxToolCall("forge_grill_evidence", {
						candidateId: firstCandidateId,
					}, { id: "call-evidence-1" })]);
				},
				(context) => {
					contexts.push(context);
					assert.ok(firstRoundId);
					assert.ok(firstCandidateId);
					return fauxAssistantMessage([fauxToolCall("forge_grill_complete", {
						evidence: [firstCandidateId],
						questions: [{ id: "q-proceed", question: "是否進入 deep knowledge？", options: ["是", "否"] }],
						recommendation: { reason: "需要使用者確認。", value: "是" }, requiresUserConfirmation: true, roundId: firstRoundId,
						status: "NEEDS_CONFIRMATION",
						}, { id: "call-complete-1" })]);
					},
					(context) => { contexts.push(context); return fauxAssistantMessage("首輪 completion suppress。"); },
					(context) => {
					contexts.push(context);
					return fauxAssistantMessage([fauxToolCall("forge_grill_complete", {
						evidence: [], questions: [], recommendation: { value: "繼續" }, requiresUserConfirmation: false,
						status: "READY_FOR_DEEP", roundId: "grill-2",
					}, { id: "call-complete-2" })]);
				},
				(context) => { contexts.push(context); return fauxAssistantMessage("第二輪已收到結構化決策。"); },
					// ponytail: 預留四個回應；只有 PI 增加導引回合時才提高。
				...Array.from({ length: 4 }, () => (context: { messages: unknown[] }) => {
					contexts.push(context);
					return fauxAssistantMessage("headroom");
				}),
			]);
		mode = new InteractiveMode(runtime, { terminal, uiMode: "regular" });
		void mode.run();
		await new Promise((resolve) => setTimeout(resolve, 100));
		terminal.sendInput(request); terminal.sendInput("\r");
		await waitForViewport(terminal, "是否進入 deep knowledge？");
		terminal.sendInput("\r");
		let nextRoundRequestCaptured = false;
		for (let attempt = 0; attempt < 100; attempt += 1) {
			nextRoundRequestCaptured = contexts.some((context) => JSON.stringify(context).includes("grill-2"));
			if (nextRoundRequestCaptured) break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.ok(nextRoundRequestCaptured, "next-round provider request was not captured");
		await runtime.session.waitForIdle();
		assert.ok(contexts.length >= 3, "provider requests were not captured");
		const userTexts = contexts.flatMap((context) =>
			(context as { messages: Array<{ role: string; content: unknown }> }).messages
				.filter((message) => message.role === "user")
				.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content))),
		);
		const secondUserText = userTexts.find((text) => text.includes("completion payload") && text.includes("grill-2"));
		assert.ok(secondUserText, "provider requests did not include a structured grill-2 invocation");
		assert.match(secondUserText, /completion payload/);
		for (const field of ["evidence", "questions", "recommendation", "requiresUserConfirmation", "status", "roundId"]) assert.match(secondUserText, new RegExp(field));
		assert.match(secondUserText, /grill-2/); assert.match(secondUserText, /是/); assert.match(secondUserText, new RegExp(request));
		const completionContext = contexts.find((context) =>
			(context as { messages: Array<{ role: string; content: unknown }> }).messages.some(
				(message) =>
					message.role === "user" &&
					(typeof message.content === "string" ? message.content : JSON.stringify(message.content)) === secondUserText,
			),
		);
		assert.ok(completionContext, "structured grill-2 invocation context was not captured");
		const firstManifestContext = contexts.find((context) => /manifest/i.test(JSON.stringify(context)));
		const firstManifest = firstManifestContext && JSON.stringify(firstManifestContext).match(/manifest[^\n]{0,500}/i)?.[0];
		assert.ok(typeof firstManifest === "string", "first provider request did not include the snapshot manifest");
		assert.match(JSON.stringify(completionContext), new RegExp(firstManifest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		assert.equal(userTexts.includes("是"), false, "provider context contained the submitted answer as a standalone user message");
	} finally {
		mode?.stop(); await runtime?.dispose(); faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});

test("PiIngress_WhenInitialGrillIngress_ShouldPreserveFullGrillInvocationInProviderContext", async () => {
	const tempDir = join(tmpdir(), `pi-grill-ingress-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	mkdirSync(join(tempDir, "wiki"), { recursive: true });
	mkdirSync(join(tempDir, "code_base"), { recursive: true });
		const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
	const request = "請幫我測試 Forge，並保留 Grill 傳輸完整性";
	let providerUserMessage: string | undefined;
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
							}))
						});
						extensionFactory(pi);
					}
				],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			}
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
			routerStartForgeResponse(),
			(context) => {
				const userMessage = [...context.messages].reverse().find((message) => message.role === "user");
				providerUserMessage = userMessage
					? typeof userMessage.content === "string"
						? userMessage.content
						: JSON.stringify(userMessage.content)
					: undefined;
				return fauxAssistantMessage("模型回覆未完成。");
			},
		]);
		mode = new InteractiveMode(runtime, { terminal, uiMode: "regular" });
		void mode.run();
		await new Promise((resolve) => setTimeout(resolve, 100));
		terminal.sendInput(request);
		terminal.sendInput("\r");
		for (let attempt = 0; attempt < 100 && providerUserMessage === undefined; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
			assert.ok(providerUserMessage, "provider request was not captured");
			assert.match(providerUserMessage, /completion payload/);
			assert.match(providerUserMessage, /目前 Grill roundId:\s*grill-1/);
			assert.match(providerUserMessage, /可查核來源只限以下 snapshot manifest；不得猜測或傳入 path。/);
			assert.match(providerUserMessage, new RegExp(request));
		assert.notEqual(providerUserMessage, request);
	} finally {
		mode?.stop();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});

test("PiProvider_WhenKnowledgeBaseApprovalStartsGrill_ShouldReceiveStructuredInvocationInsteadOfApprovalText", async () => {
	const tempDir = join(tmpdir(), `pi-grill-approval-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
	const request = "請幫我測試 Forge，並保留 Grill 傳輸完整性";
	let providerUserMessage: string | undefined;
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
			routerStartForgeResponse(),
			(context) => {
				const userMessage = [...context.messages].reverse().find((message) => message.role === "user");
				providerUserMessage = userMessage
					? typeof userMessage.content === "string"
						? userMessage.content
						: JSON.stringify(userMessage.content)
					: undefined;
				return fauxAssistantMessage("模型回覆未完成。");
			},
		]);
		mode = new InteractiveMode(runtime, { terminal, uiMode: "regular" });
		void mode.run();
		await new Promise((resolve) => setTimeout(resolve, 100));
		terminal.sendInput(request);
		terminal.sendInput("\r");
		await waitForViewport(terminal, "請明確回覆同意");
		assert.equal(faux.state.callCount, 1, "approval should have only the router call; Grill has not completed yet");
		terminal.sendInput("同意");
		terminal.sendInput("\r");
		for (let attempt = 0; attempt < 100 && providerUserMessage === undefined; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.ok(providerUserMessage, "provider request was not captured after approval");
		assert.match(providerUserMessage, /completion payload/);
		assert.match(providerUserMessage, /roundId/);
		assert.match(providerUserMessage, new RegExp(request));
		assert.notEqual(providerUserMessage, "同意");
	} finally {
		mode?.stop();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});
