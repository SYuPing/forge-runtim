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
function attachVirtualTerminal(mode: InteractiveMode, terminal: VirtualTerminal): void {
	(mode as unknown as { renderer: { terminal: VirtualTerminal } }).renderer.terminal = terminal;
}
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

async function waitForScrollBuffer(terminal: VirtualTerminal, text: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		await terminal.waitForRender();
		if (terminal.getScrollBuffer().join("\n").includes(text)) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.fail(`TUI scroll buffer did not contain ${JSON.stringify(text)}`);
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
			}, 5000);
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
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
		terminal.sendInput("請幫我測試 Forge");
		terminal.sendInput("\r");
		const boundaryOutcome = await Promise.race([boundary, boundaryDeadline]);
		assert.equal(
			boundaryOutcome,
			"idle",
			"WAIT_USER 顯示後舊回合未先終止：agent turn 未在使用者回答前 settle。",
		);
		await waitForViewport(terminal, "是否進入 deep knowledge？");
		const callCountAtWaitUser = faux.state.callCount;
		const assistantMessagesAtWaitUser = runtime.session.messages.filter((message) => message.role === "assistant").length;
		assert.equal(callCountAtWaitUser, 2, "router completion 與 Grill completion 應分開計數");
		assert.equal(faux.getPendingResponseCount(), 1);
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(faux.state.callCount, callCountAtWaitUser);
		assert.equal(runtime.session.messages.filter((message) => message.role === "assistant").length, assistantMessagesAtWaitUser);

			terminal.sendInput("是");
			terminal.sendInput("\r");
			for (let attempt = 0; attempt < 250; attempt += 1) {
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

test("DeepHandoff_WhenSteerPrecedesSettledIdentityPrompt_ShouldKeepStagePanelOutOfProviderAndPreserveDeep", async () => {
	const tempDir = join(tmpdir(), `pi-deep-stale-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(join(tempDir, "wiki"), { recursive: true });
	mkdirSync(join(tempDir, "code_base"), { recursive: true });
	writeFileSync(join(tempDir, "code_base", "BoundaryToken.md"), "BoundaryToken\n", "utf8");
	writeFileSync(join(tempDir, "wiki", "boundary.md"), "BoundaryToken\n", "utf8");
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	let mode: InteractiveMode | undefined;
	let unsubscribe: (() => void) | undefined;
	const providerContexts: string[] = [];
	const deepResults: unknown[] = [];
	const staleCompletionResults: unknown[] = [];
	try {
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
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
							models: faux.models.map((model) => ({ id: model.id, name: model.name, api: model.api, reasoning: model.reasoning, input: model.input, cost: model.cost, contextWindow: model.contextWindow, maxTokens: model.maxTokens })),
						});
						installForgeRuntimeExtension(pi);
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
		runtime = await createAgentSessionRuntime(createRuntime, { cwd: tempDir, agentDir: tempDir, sessionManager: SessionManager.inMemory() });
		await runtime.session.bindExtensions({});
		unsubscribe = runtime.session.subscribe((event) => {
			if (event.type === "tool_execution_start" && event.toolName === "forge_grill_complete") {
				void runtime?.session.steer("queued steer must not displace Deep identity");
			}
			if (event.type === "tool_execution_end" && event.toolName === "forge_deep_search") {
				deepResults.push(event.result);
			}
			if (event.type === "tool_execution_end" && event.toolName === "forge_deep_retrieval_complete") {
				staleCompletionResults.push(event.result);
			}
		});
		faux.setResponses([
			(context) => {
				providerContexts.push(JSON.stringify(context));
				return routerStartForgeResponse();
			},
				(context) => {
					providerContexts.push(JSON.stringify(context));
					const match = JSON.stringify(context).match(/ev-[0-9a-f]{64}/);
					assert.ok(match, "fixture 必須先取得 evidence candidateId");
					const candidateId = match[0];
					return fauxAssistantMessage([fauxToolCall("forge_grill_evidence", { candidateId }, { id: "deep-stale-loop-evidence" })]);
				},
				(context) => {
					providerContexts.push(JSON.stringify(context));
					const match = JSON.stringify(context).match(/ev-[0-9a-f]{64}/);
					assert.ok(match, "fixture 必須再次取得 evidence candidateId");
					const candidateId = match[0];
					return fauxAssistantMessage([fauxToolCall("forge_grill_complete", {
						evidence: [candidateId], questions: [], recommendation: { reason: "ready", value: "proceed" },
						requiresUserConfirmation: false, roundId: "grill-1", status: "READY_FOR_DEEP",
				}, { id: "deep-stale-loop-complete" })]);
			},
			(context) => {
				providerContexts.push(JSON.stringify(context));
				return fauxAssistantMessage([fauxToolCall("forge_deep_retrieval_complete", {
					attemptId: "deep-0", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL",
					outcome: { kind: "completed" },
				}, { id: "deep-stale-loop-completion" })]);
			},
			(context) => {
				providerContexts.push(JSON.stringify(context));
				return fauxAssistantMessage("steer processed");
			},
			(context) => {
				providerContexts.push(JSON.stringify(context));
				return fauxAssistantMessage([fauxToolCall("forge_deep_search", {
					attemptId: "deep-1", sourceRoundId: "grill-1", phase: "DEEP_KNOWLEDGE_RETRIEVAL", query: "BoundaryToken", source: "wiki",
				}, { id: "deep-stale-loop-search" })]);
			},
			(context) => {
				providerContexts.push(JSON.stringify(context));
				return fauxAssistantMessage("合法 Deep 後續已完成");
			},
		]);
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
		terminal.sendInput("請幫我測試 BoundaryToken");
		terminal.sendInput("\r");
		for (let attempt = 0; attempt < 250; attempt += 1) {
			if (providerContexts.length > 0) break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.ok(providerContexts.length > 0, "positive control: initial prompt 必須真的進入 provider loop");
		await runtime.session.waitForIdle();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await runtime.session.waitForIdle();
		assert.ok(providerContexts.length >= 4, "positive control: steer 與 settled identity prompt 都必須真的進入 agent loop");
		assert.ok(providerContexts.some((context) => context.includes("queued steer must not displace Deep identity")), "positive control: queued steer 必須被處理");
		assert.equal(providerContexts.some((context) => context.includes("forge-stage") && context.includes("DEEP_KNOWLEDGE_RETRIEVAL")), false, "stage panel 不得進入 provider context");
		assert.equal(staleCompletionResults.length, 1, "過期 Deep completion 必須實際執行並回傳 blocked result");
		const staleCompletionResult = staleCompletionResults[0] as { content?: unknown };
		const staleCompletionContent = JSON.stringify(staleCompletionResult.content);
		assert.equal(staleCompletionContent.includes("過期的 Deep Retrieval 完成結果已忽略。"), false, "過期 completion 不得把使用者問題字串帶入結果");
		assert.equal(staleCompletionContent.includes("Tool execution was blocked"), true, "過期 completion 必須由 pending gate 阻擋");
		assert.equal(deepResults.length, 1, "合法 identity prompt 應只執行一次 Deep search");
		const deepResult = deepResults[0] as { content?: Array<{ text?: string }>; details?: Record<string, unknown> };
		assert.equal(deepResult.details?.status, "accepted", "合法 Deep 後續不可被 stale guard 誤傷");
		assert.equal(deepResult.content?.some((part) => part.text?.includes("過期的 Deep Retrieval")), false, "合法 Deep 後續不可被 stale guard 誤傷");
	} finally {
		unsubscribe?.();
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
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
		terminal.sendInput("請幫我測試 test");
		terminal.sendInput("\r");
		const completionResult = await completion as { terminate?: unknown; details?: { status?: unknown } };
		await runtime.session.waitForIdle();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
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
	let unsubscribeSearch: () => void = () => {};
	let searchToolCalls = 0;
	let retrievalCompleteToolCalls = 0;
	let understandingCompleteToolCalls = 0;
	let searchResult: unknown;
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
		unsubscribeSearch = runtime.session.subscribe((event) => {
			if (event.type === "tool_execution_end" && event.toolName === "forge_deep_search") {
				searchToolCalls += 1;
				searchResult = event.result;
			}
			if (event.type === "tool_execution_end" && event.toolName === "forge_deep_retrieval_complete") {
				retrievalCompleteToolCalls += 1;
			}
			if (event.type === "tool_execution_end" && event.toolName === "forge_deep_complete") {
				understandingCompleteToolCalls += 1;
			}
		});
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
			// READY_FOR_DEEP 後的第二模型回合必須使用 runtime 提供的 Deep identity。
			fauxAssistantMessage(
				[
					{ type: "text", text: "FORBIDDEN_IMPLEMENTATION_MARKER" },
					fauxToolCall("forge_deep_search", {
						attemptId: "deep-1",
						sourceRoundId: "grill-1",
						phase: "DEEP_KNOWLEDGE_RETRIEVAL",
						query: "test.ts",
						source: "code_base",
					}, { id: "call-deep-search-1" }),
				],
			),
			fauxAssistantMessage([
				{ type: "text", text: "FORBIDDEN_IMPLEMENTATION_MARKER" },
				fauxToolCall("forge_deep_retrieval_complete", {
					attemptId: "deep-1",
					sourceRoundId: "grill-1",
					phase: "DEEP_KNOWLEDGE_RETRIEVAL",
					outcome: { kind: "completed" },
				}, { id: "call-deep-retrieval-complete-1" }),
			]),
			fauxAssistantMessage([
				{ type: "text", text: "FORBIDDEN_IMPLEMENTATION_MARKER" },
				fauxToolCall("forge_deep_complete", {
					attemptId: "deep-1",
					sourceRoundId: "grill-1",
					phase: "KNOWLEDGE_UNDERSTANDING",
					outcome: {
						kind: "completed",
						decisions: [],
						findings: [],
						limitations: [],
						knowledgeSummary: "測試知識摘要",
					},
				}, { id: "call-deep-complete-1" }),
			]),
		]);
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
		terminal.sendInput("請幫我測試 test");
		terminal.sendInput("\r");
		await waitForScrollBuffer(terminal, "DEEP_KNOWLEDGE_RETRIEVAL");
		assert.doesNotMatch((await terminal.flushAndGetViewport()).join("\n"), /continue/i);
		const userMessages = runtime.session.messages.filter((message) => message.role === "user");
		assert.ok(userMessages.length >= 1);
		assert.match(JSON.stringify(userMessages), /請幫我測試 test/);
		await runtime.session.waitForIdle();
		assert.equal(faux.getPendingResponseCount(), 0, "後續模型回合應已被消耗");
		assert.equal(searchToolCalls, 1, "Deep 搜尋工具應成功執行一次");
		assert.equal(retrievalCompleteToolCalls, 1, "Deep Retrieval 完成工具應成功執行一次");
		assert.equal(understandingCompleteToolCalls, 1, "Knowledge Understanding 完成工具應成功執行一次");
		assert.match(JSON.stringify(searchResult), /accepted/);
		const messages = runtime.session.messages.map((message) => JSON.stringify(message)).join("\n");
		assert.doesNotMatch(messages, /FORBIDDEN_IMPLEMENTATION_MARKER/);
		assert.doesNotMatch(messages, /已有進行中的 workflow|continue/i);
		assert.match((await terminal.flushAndGetViewport()).join("\n"), /CONTEXT_BUILD/);
	} finally {
		unsubscribeSearch();
		mode?.stop();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});

test("PiProvider_WhenContextBuildStageIsPublished_ShouldKeepStageOutOfProviderContext", async () => {
	const tempDir = join(tmpdir(), `pi-stage-provider-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	mkdirSync(join(tempDir, "wiki"), { recursive: true });
	mkdirSync(join(tempDir, "code_base"), { recursive: true });
	writeFileSync(join(tempDir, "code_base", "context-isolation.ts"), "// context-isolation\nexport const contextIsolation = true;\n");
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	let mode: InteractiveMode | undefined;
	const providerContexts: string[] = [];
	let deepCompletionCount = 0;
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
			sessionManager: SessionManager.inMemory(),
		});
		await runtime.session.bindExtensions({});
		unsubscribeCompletion = runtime.session.subscribe((event) => {
			if (event.type !== "tool_execution_end" || event.toolName !== "forge_deep_complete") return;
			deepCompletionCount += 1;
		});
		faux.setResponses([
			(context) => {
				providerContexts.push(JSON.stringify(context));
				return routerStartForgeResponse();
			},
			(context) => {
				providerContexts.push(JSON.stringify(context));
				return fauxAssistantMessage([fauxToolCall("forge_grill_evidence", {
					candidateId: extractCandidateId(context),
				}, { id: "call-stage-context-evidence" })]);
			},
			(context) => {
				providerContexts.push(JSON.stringify(context));
				return fauxAssistantMessage([fauxToolCall("forge_grill_complete", {
					evidence: [extractCandidateId(context)],
					questions: [],
					recommendation: { reason: "候選相關性足夠。", value: "進入 deep knowledge" },
					requiresUserConfirmation: false,
					roundId: "grill-1",
					status: "READY_FOR_DEEP",
				}, { id: "call-stage-context-ready" })]);
			},
			(context) => {
				providerContexts.push(JSON.stringify(context));
				return fauxAssistantMessage([fauxToolCall("forge_deep_search", {
					attemptId: "deep-1",
					sourceRoundId: "grill-1",
					phase: "DEEP_KNOWLEDGE_RETRIEVAL",
					query: "context-isolation.ts",
					source: "code_base",
				}, { id: "call-stage-context-search" })]);
			},
			(context) => {
				providerContexts.push(JSON.stringify(context));
				return fauxAssistantMessage([fauxToolCall("forge_deep_retrieval_complete", {
					attemptId: "deep-1",
					sourceRoundId: "grill-1",
					phase: "DEEP_KNOWLEDGE_RETRIEVAL",
					outcome: { kind: "completed" },
				}, { id: "call-stage-context-retrieval-complete" })]);
			},
			(context) => {
				providerContexts.push(JSON.stringify(context));
				return fauxAssistantMessage([fauxToolCall("forge_deep_complete", {
					attemptId: "deep-1",
					sourceRoundId: "grill-1",
					phase: "KNOWLEDGE_UNDERSTANDING",
					outcome: { kind: "completed", decisions: [], findings: [], limitations: [], knowledgeSummary: "測試知識摘要" },
				}, { id: "call-stage-context-understanding-complete" })]);
			},
		]);
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
		terminal.sendInput("請幫我測試 context-isolation");
		terminal.sendInput("\r");
		await waitForScrollBuffer(terminal, "DEEP_KNOWLEDGE_RETRIEVAL");
		for (let attempt = 0; attempt < 100; attempt += 1) {
			if (providerContexts.some((context) => context.includes("任務：請幫我測試 context-isolation"))) break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		for (let attempt = 0; attempt < 100 && deepCompletionCount < 1; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.equal(deepCompletionCount, 1, "bounded wait 應等到 forge_deep_complete completed");
		await runtime.session.waitForIdle();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await runtime.session.waitForIdle();

		assert.equal(
			providerContexts.some((context) => context.includes("任務：請幫我測試 context-isolation")),
			true,
			"positive control: provider context 必須看得到同一回合的正常 user input",
		);
		assert.equal(
			providerContexts.some((context) => context.includes("Forge CONTEXT_BUILD [active]")),
			false,
			"provider context 不得包含 Forge CONTEXT_BUILD [active] literal",
		);
		const completionToolCall = runtime.session.messages
			.filter((message) => message.role === "assistant")
			.flatMap((message) => message.content)
			.find((block) => block.type === "toolCall" && block.name === "forge_deep_complete") as { id?: string } | undefined;
		assert.ok(completionToolCall?.id, "session history 必須保留 forge_deep_complete tool call");
		const completionToolResult = runtime.session.messages.find(
			(message) =>
				(message as { role?: string; toolCallId?: string }).role === "toolResult" &&
				(message as { toolCallId?: string }).toolCallId === completionToolCall?.id,
		) as { isError?: boolean; details?: { status?: string } } | undefined;
		assert.ok(completionToolResult, "session history 必須保留 forge_deep_complete tool result");
		assert.equal(completionToolResult?.details?.status, "accepted");
		assert.equal(completionToolResult?.isError, false);
		assert.equal(faux.getPendingResponseCount(), 0);
	} finally {
		unsubscribeCompletion();
		mode?.stop();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});

test("PiProvider_WhenDeepDecisionIsAnswered_ShouldCompleteFirstFreshAttemptWithoutBlockedRetry", async () => {
	const tempDir = join(tmpdir(), `pi-deep-decision-replay-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	mkdirSync(join(tempDir, "wiki"), { recursive: true });
	mkdirSync(join(tempDir, "code_base"), { recursive: true });
	writeFileSync(
		join(tempDir, "code_base", "spi_mode0_loopback.sv"),
		"SPI_MODE0 loopback\nMISO follows MOSI at the same bit position.\n",
		"utf8",
	);
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	let mode: InteractiveMode | undefined;
	let unsubscribe: (() => void) | undefined;
	const providerContexts: string[] = [];
	const deepCompletions: Array<{ result: unknown; input: string }> = [];
	let blockedCompletions = 0;
	try {
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
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
						installForgeRuntimeExtension(pi);
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
		unsubscribe = runtime.session.subscribe((event) => {
			if (event.type !== "tool_execution_end" || event.toolName !== "forge_deep_complete") return;
			const result = event.result as { content?: unknown };
			const input = JSON.stringify(event);
			deepCompletions.push({ result, input });
			if (JSON.stringify(result.content).includes("Tool execution was blocked")) blockedCompletions += 1;
		});
		faux.setResponses([
			(context) => {
				return routerStartForgeResponse();
			},
			(context) => {
				return fauxAssistantMessage([fauxToolCall("forge_grill_evidence", {
					candidateId: extractCandidateId(context),
				}, { id: "call-decision-replay-evidence" })]);
			},
			(context) => {
				return fauxAssistantMessage([fauxToolCall("forge_grill_complete", {
				evidence: [extractCandidateId(context)],
				questions: [],
				recommendation: { reason: "候選同時符合檔案路徑與內容。", value: "進入 deep knowledge" },
				requiresUserConfirmation: false,
				roundId: "grill-1",
				status: "READY_FOR_DEEP",
				}, { id: "call-decision-replay-ready" })]);
			},
			(context) => {
				return fauxAssistantMessage([fauxToolCall("forge_deep_search", {
				attemptId: "deep-1",
				sourceRoundId: "grill-1",
				phase: "DEEP_KNOWLEDGE_RETRIEVAL",
				query: "spi_mode0_loopback.sv SPI_MODE0",
				source: "code_base",
				}, { id: "call-decision-replay-search" })]);
			},
			(context) => {
				return fauxAssistantMessage([fauxToolCall("forge_deep_retrieval_complete", {
				attemptId: "deep-1",
				sourceRoundId: "grill-1",
				phase: "DEEP_KNOWLEDGE_RETRIEVAL",
				outcome: { kind: "completed" },
				}, { id: "call-decision-replay-retrieval" })]);
			},
			(context) => {
				return fauxAssistantMessage([fauxToolCall("forge_deep_complete", {
				attemptId: "deep-1",
				sourceRoundId: "grill-1",
				phase: "KNOWLEDGE_UNDERSTANDING",
				outcome: {
					kind: "needs_decision",
					decisionId: "spi_mode0_behavior",
					question: "MISO 應如何驅動？",
					options: ["固定驅動（不三態；例如維持 0）", "純直通"],
					recommendation: "固定驅動（不三態；例如維持 0）",
					evidenceIds: [extractCandidateId(context)],
					decisionSummary: "需要確認 MISO 驅動行為。",
				},
				}, { id: "call-decision-replay-needs-decision" })]);
			},
			(context) => {
				providerContexts.push(JSON.stringify(context));
				return fauxAssistantMessage([fauxToolCall("forge_deep_complete", {
					attemptId: "deep-2",
					sourceRoundId: "grill-1",
					phase: "KNOWLEDGE_UNDERSTANDING",
					outcome: { kind: "completed", decisions: [], findings: [], limitations: [], knowledgeSummary: "測試知識摘要" },
				}, { id: "call-decision-replay-fresh-complete" })]);
			},
		]);
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
		terminal.sendInput("請分析 SPI_MODE0 loopback");
		terminal.sendInput("\r");
		await waitForViewport(terminal, "MISO 應如何驅動？");
		terminal.sendInput("\r");
		for (let attempt = 0; attempt < 100 && deepCompletions.length < 2; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.equal(deepCompletions.length, 2, "bounded wait 應等到 fresh deep-2 completion");
		await runtime.session.waitForIdle();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await runtime.session.waitForIdle();
		assert.equal(blockedCompletions, 0, "正常決策回答不得觸發 blocked retry");
		assert.equal(
			deepCompletions.length,
			2,
			"Deep completion 應只有 needs_decision 與 fresh deep-2 各一次",
		);
		assert.equal(
			providerContexts.some((context) => context.includes("attemptId=deep-2")),
			true,
			"新 provider context 必須包含 deep-2 identity",
		);
		const freshToolCall = runtime.session.messages
			.filter((message) => message.role === "assistant")
			.flatMap((message) => message.content)
			.find(
				(block) =>
					block.type === "toolCall" &&
					block.name === "forge_deep_complete" &&
					(block.arguments as Record<string, unknown>).attemptId === "deep-2",
			) as {
				id?: string;
				arguments?: Record<string, unknown>;
			} | undefined;
		assert.ok(freshToolCall?.id, "session history 必須保留 deep-2 forge_deep_complete tool call");
		assert.equal(freshToolCall?.arguments?.sourceRoundId, "grill-1");
		assert.equal(freshToolCall?.arguments?.phase, "KNOWLEDGE_UNDERSTANDING");
		const freshToolResult = runtime.session.messages.find(
			(message) =>
				(message as { role?: string; toolCallId?: string }).role === "toolResult" &&
				(message as { toolCallId?: string }).toolCallId === freshToolCall?.id,
		) as { isError?: boolean; details?: { status?: string } } | undefined;
		assert.ok(freshToolResult, "session history 必須保留 deep-2 tool result");
		assert.equal(freshToolResult?.details?.status, "accepted");
		assert.equal(freshToolResult?.isError, false);
		assert.equal(faux.getPendingResponseCount(), 0);
	} finally {
		unsubscribe?.();
		mode?.stop();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});

test("PiTui_WhenCompletionIsOmitted_ShouldRecoverOnceAndResumeOnlyAfterExplicitRetry", async () => {
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
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
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
		await runtime.session.waitForIdle();
		assert.equal(runtime.session.messages.filter((message) => message.role === "user").length, 1);
		assert.equal(runtime.session.messages.filter((message) => message.role === "assistant").length, assistantMessagesAtRecovery);
		assert.equal(faux.getPendingResponseCount(), 0);
		assert.equal(faux.state.callCount, 2);
		assert.equal(runtime.session.isIdle, true);
		assert.doesNotMatch(JSON.stringify(runtime.session.messages), /retry-attempt-completed/);

		faux.appendResponses([
			fauxAssistantMessage([
				fauxToolCall("forge_grill_complete", {
					evidence: [],
					questions: [{ id: "q-retry", question: "retry-attempt-completed", options: ["是", "否"] }],
					recommendation: { reason: "重試完成。", value: "是" },
					requiresUserConfirmation: true,
					roundId: "grill-1",
					status: "NEEDS_CONFIRMATION",
				}, { id: "call-complete-retry-1" }),
			]),
		]);
		terminal.sendInput("/forge-runtime retry");
		terminal.sendInput("\r");
		await waitForViewport(terminal, "retry-attempt-completed");
		await runtime.session.waitForIdle();
		assert.equal(faux.state.callCount, 3);
		assert.equal(faux.getPendingResponseCount(), 0);
		assert.equal(runtime.session.messages.filter((message) => message.role === "user").length, 2);
		assert.equal(runtime.session.isIdle, true);
		assert.equal(
			runtime.session.messages.filter((message) => JSON.stringify(message).includes("GRILL_COMPLETION_REQUIRED")).length,
			1,
		);
		assert.match((await terminal.flushAndGetViewport()).join("\n"), /retry-attempt-completed/);
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
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
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
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
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
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
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
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
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

test("AgentSession_WhenParallelMixedDeepBatchRuns_ShouldApplyBarrierEndToEnd", async () => {
	const originalPiOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";
	const tempDir = join(tmpdir(), `pi-deep-mixed-batch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(join(tempDir, "wiki"), { recursive: true });
	mkdirSync(join(tempDir, "code_base"), { recursive: true });
	writeFileSync(join(tempDir, "wiki", "mixed.md"), "mixed barrier evidence\n", "utf8");
	writeFileSync(join(tempDir, "code_base", "mixed-barrier.ts"), "// mixed barrier\nexport const mixedBarrier = true;\n", "utf8");
	writeFileSync(join(tempDir, "mixed-barrier.ts"), "// mixed barrier\nexport const mixedBarrier = true;\n", "utf8");
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	let unsubscribe: (() => void) | undefined;
	const toolEnds: Array<{ toolCallId: string; toolName: string; result: unknown }> = [];
	const deepIdentity = { attemptId: "deep-1", sourceRoundId: "grill-1" } as const;
	try {
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
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
						installForgeRuntimeExtension(pi);
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
		unsubscribe = runtime.session.subscribe((event) => {
			if (event.type === "tool_execution_end" && ["forge_deep_search", "forge_deep_retrieval_complete", "forge_deep_complete"].includes(event.toolName)) {
				toolEnds.push({ toolCallId: event.toolCallId, toolName: event.toolName, result: event.result });
			}
		});
		faux.setResponses([
			routerStartForgeResponse(),
			(context) => fauxAssistantMessage([fauxToolCall("forge_grill_evidence", {
				candidateId: extractCandidateId(context),
			}, { id: "mixed-batch-grill-evidence" })]),
			(context) => fauxAssistantMessage([fauxToolCall("forge_grill_complete", {
				evidence: [extractCandidateId(context)],
				questions: [],
				recommendation: { reason: "ready", value: "進入 deep knowledge" },
				requiresUserConfirmation: false,
				roundId: "grill-1",
				status: "READY_FOR_DEEP",
			}, { id: "mixed-batch-grill-complete" })]),
			() => {
				return fauxAssistantMessage([
					fauxToolCall("forge_deep_search", {
						...deepIdentity, phase: "DEEP_KNOWLEDGE_RETRIEVAL", query: "mixed barrier", source: "wiki",
					}, { id: "mixed-batch-search-wiki" }),
					fauxToolCall("forge_deep_search", {
						...deepIdentity, phase: "DEEP_KNOWLEDGE_RETRIEVAL", query: "mixedBarrier", source: "code_base",
					}, { id: "mixed-batch-search-code" }),
					fauxToolCall("forge_deep_retrieval_complete", {
						...deepIdentity, phase: "DEEP_KNOWLEDGE_RETRIEVAL", outcome: { kind: "completed" },
					}, { id: "mixed-batch-completion" }),
				]);
			},
			() => {
				return fauxAssistantMessage([fauxToolCall("forge_deep_retrieval_complete", {
					attemptId: deepIdentity.attemptId,
					sourceRoundId: deepIdentity.sourceRoundId,
					phase: "DEEP_KNOWLEDGE_RETRIEVAL",
					outcome: { kind: "completed" },
				}, { id: "mixed-batch-retrieval-completion-only" })]);
			},
			() => {
				return fauxAssistantMessage([fauxToolCall("forge_deep_complete", {
					...deepIdentity,
					phase: "KNOWLEDGE_UNDERSTANDING",
					outcome: { kind: "completed", decisions: [], findings: [], limitations: [] },
				}, { id: "mixed-batch-understanding-complete" })]);
			},
		]);
		const baselineUserMessages = runtime.session.messages.filter((message) => message.role === "user").length;
		await runtime.session.prompt("請幫我測試 mixed barrier");
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await runtime.session.waitForIdle();

		const sessionMessages = JSON.stringify(runtime.session.messages);
		assert.match(sessionMessages, /"attemptId":"deep-1"/);
		assert.match(sessionMessages, /"sourceRoundId":"grill-1"/);
		assert.match(sessionMessages, /DEEP_KNOWLEDGE_RETRIEVAL/);
		const completionResults = toolEnds.filter((entry) => entry.toolName === "forge_deep_retrieval_complete");
		assert.equal(completionResults.length, 2, "retrieval completion must execute once per batch");
		const mixedCompletion = completionResults.find((entry) => entry.toolCallId === "mixed-batch-completion");
		assert.ok(mixedCompletion, "mixed completion event must be present");
		const mixedCompletionResult = mixedCompletion.result as { details?: Record<string, unknown>; terminate?: boolean };
		assert.equal(mixedCompletionResult.details?.status, "rejected");
		assert.equal(mixedCompletionResult.details?.reason, "mixed_search_completion_batch");
		assert.equal(mixedCompletionResult.details?.retryable, true);
		assert.equal(mixedCompletionResult.terminate, true, `mixed completion must terminate: ${JSON.stringify(mixedCompletionResult)}`);
		const completionOnly = completionResults.find((entry) => entry.toolCallId === "mixed-batch-retrieval-completion-only");
		assert.ok(completionOnly, "completion-only event must be present");
		const completionOnlyResult = completionOnly.result as { details?: Record<string, unknown>; terminate?: boolean };
		assert.equal(completionOnlyResult.terminate, true);
		assert.equal(completionOnlyResult.details?.status, "accepted");
		const wikiSearch = toolEnds.find((entry) => entry.toolCallId === "mixed-batch-search-wiki");
		assert.ok(wikiSearch, "wiki search event must be present");
		assert.equal((wikiSearch.result as { terminate?: boolean }).terminate, true);
		assert.equal((wikiSearch.result as { details?: { status?: string } }).details?.status, "accepted");
		const codeSearch = toolEnds.find((entry) => entry.toolCallId === "mixed-batch-search-code");
		assert.ok(codeSearch, "code search event must be present");
		assert.equal((codeSearch.result as { terminate?: boolean }).terminate, true);
		assert.equal((codeSearch.result as { details?: { status?: string } }).details?.status, "accepted");
		const userMessages = runtime.session.messages.filter((message) => message.role === "user");
		const userMessageDelta = userMessages.slice(baselineUserMessages);
		const barrierUserMessages = userMessageDelta.filter((message) =>
			JSON.stringify(message).includes("Deep Search 批次已完成。"),
		);
		assert.equal(
			barrierUserMessages.length,
			1,
			"barrier follow-up should be emitted exactly once",
		);
		const barrierUserMessageJson = JSON.stringify(barrierUserMessages[0]);
		assert.ok(barrierUserMessageJson.includes("deep-1"));
		assert.ok(barrierUserMessageJson.includes("grill-1"));
		assert.deepEqual(
			await runtime.session.agent.state.tools.map((tool) => tool.name),
			["forge_deep_complete"],
			"只有通過 retrieval barrier 後才可進入 Knowledge Understanding",
		);
		for (let attempt = 0; attempt < 100; attempt += 1) {
			if (toolEnds.some((entry) => entry.toolCallId === "mixed-batch-understanding-complete")) break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.ok(
			toolEnds.some((entry) => entry.toolCallId === "mixed-batch-understanding-complete"),
			"Knowledge Understanding completion event 應在 cleanup 前完成",
		);
		await runtime.session.waitForIdle();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await runtime.session.waitForIdle();
		for (let attempt = 0; attempt < 100 && !runtime.session.isIdle; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.equal(runtime.session.isIdle, true, "後續 settled 事件應在 cleanup 前完成");
	} finally {
		if (originalPiOffline === undefined) delete process.env.PI_OFFLINE;
		else process.env.PI_OFFLINE = originalPiOffline;
		unsubscribe?.();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});

test("PiTui_WhenDeepDiscoveryFallbackNeedsConfirmation_ShouldShowFixedPromptAndEnterUnderstanding", async () => {
	const tempDir = join(tmpdir(), `pi-grill-fallback-tui-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(join(tempDir, "wiki"), { recursive: true });
	mkdirSync(join(tempDir, "code_base"), { recursive: true });
	writeFileSync(join(tempDir, "code_base", "請幫我測試 Forge fallback.md"), "請幫我測試 Forge fallback\nFALLBACK_FIXTURE_UNIQUE_MARKER\n", "utf8");
	const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const terminal = new VirtualTerminal(100, 30);
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	let mode: InteractiveMode | undefined;
	let retrievalCompleteToolCalls = 0;
	let unsubscribe: (() => void) | undefined;
	const extractLastCandidateId = (context: unknown): string => {
		const candidateId = Array.from(JSON.stringify(context).matchAll(/\bev-[0-9a-f]{64}\b/g)).at(-1)?.[0];
		assert.ok(candidateId, "provider invocation must expose the latest opaque candidate id");
		return candidateId;
	};
	const extractUserTexts = (context: unknown): string[] => {
		const messages = (context as { messages: Array<{ role: string; content: unknown }> }).messages;
		return messages.flatMap((message) => {
			if (typeof message.content === "string") return [message.content];
			if (!Array.isArray(message.content)) return [];
			return message.content.flatMap((block) => {
				if (typeof block !== "object" || block === null || !("type" in block) || block.type !== "text" || !("text" in block) || typeof block.text !== "string") return [];
				return [block.text];
			});
		});
	};
	const extractLastRoundId = (context: unknown): string => {
		const roundMatches = extractUserTexts(context)
			.flatMap((userText) => Array.from(userText.matchAll(/目前 Grill roundId:\s*(grill-\d+)/g)).map((match) => match[1]))
		const roundId = roundMatches.at(-1);
		assert.ok(roundId, "provider invocation must expose the active Grill roundId");
		return roundId;
	};
	const extractLastDeepIdentity = (context: unknown): {
		attemptId: string;
		sourceRoundId: string;
		phase: "DEEP_KNOWLEDGE_RETRIEVAL" | "KNOWLEDGE_UNDERSTANDING";
	} => {
		const userTexts = extractUserTexts(context);
		const identityMatches = userTexts
			.flatMap((userText) => Array.from(userText.matchAll(/\{"attemptId":"[^"]+","sourceRoundId":"[^"]+","phase":"(?:DEEP_KNOWLEDGE_RETRIEVAL|KNOWLEDGE_UNDERSTANDING)"\}/g)).map((match) => match[0]));
		const identityJson = identityMatches
			.at(-1);
		assert.ok(identityJson, "provider invocation must expose the runtime Deep identity");
		const identity: unknown = JSON.parse(identityJson);
		assert.ok(
			typeof identity === "object" && identity !== null &&
				typeof (identity as { attemptId?: unknown }).attemptId === "string" &&
				typeof (identity as { sourceRoundId?: unknown }).sourceRoundId === "string" &&
				((identity as { phase?: unknown }).phase === "DEEP_KNOWLEDGE_RETRIEVAL" ||
					(identity as { phase?: unknown }).phase === "KNOWLEDGE_UNDERSTANDING"),
			"provider invocation exposed an invalid runtime Deep identity",
		);
		return {
			attemptId: (identity as { attemptId: string }).attemptId,
			sourceRoundId: (identity as { sourceRoundId: string }).sourceRoundId,
			phase: (identity as { phase: "DEEP_KNOWLEDGE_RETRIEVAL" | "KNOWLEDGE_UNDERSTANDING" }).phase,
		};
	};
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
		unsubscribe = runtime.session.subscribe((event) => {
			if (event.type === "tool_execution_end" && event.toolName === "forge_deep_retrieval_complete") {
				retrievalCompleteToolCalls += 1;
			}
		});
		faux.setResponses([
			routerStartForgeResponse(),
			(context) => {
				return fauxAssistantMessage([fauxToolCall("forge_grill_evidence", {
					candidateId: extractLastCandidateId(context),
				}, { id: "fallback-grill-evidence-1" })]);
			},
			(context) => {
				return fauxAssistantMessage([fauxToolCall("forge_grill_complete", {
					evidence: [extractLastCandidateId(context)],
					questions: [],
					recommendation: { reason: "ready", value: "進入 deep knowledge" },
					requiresUserConfirmation: false,
					roundId: extractLastRoundId(context),
					status: "READY_FOR_DEEP",
				}, { id: "fallback-grill-complete-1" })]);
			},
			(context) => {
				const identity = extractLastDeepIdentity(context);
				return fauxAssistantMessage([fauxToolCall("forge_deep_retrieval_complete", {
					...identity,
					outcome: { kind: "needs_discovery", decisionSummary: "需要更多來源" },
				}, { id: "fallback-retrieval-complete-1" })]);
			},
			(context) => {
				const argumentsPayload = { candidateId: extractLastCandidateId(context) };
				const response = fauxAssistantMessage([fauxToolCall("forge_grill_evidence", argumentsPayload, { id: "fallback-grill-evidence-2" })]);
				return response;
			},
			(context) => {
				const argumentsPayload = {
					evidence: [extractLastCandidateId(context)],
					questions: [],
					recommendation: { reason: "ready", value: "進入 deep knowledge" },
					requiresUserConfirmation: false,
					roundId: extractLastRoundId(context),
					status: "READY_FOR_DEEP",
				};
				const response = fauxAssistantMessage([fauxToolCall("forge_grill_complete", argumentsPayload, { id: "fallback-grill-complete-2" })]);
				return response;
			},
			(context) => {
				const identity = extractLastDeepIdentity(context);
				assert.equal(identity.attemptId, "deep-2");
				assert.equal(identity.sourceRoundId, "grill-2");
				assert.equal(identity.phase, "DEEP_KNOWLEDGE_RETRIEVAL");
				const argumentsPayload = {
					...identity,
					outcome: { kind: "needs_discovery", decisionSummary: "第二次仍需要更多來源" },
				};
				const response = fauxAssistantMessage([fauxToolCall("forge_deep_retrieval_complete", argumentsPayload, { id: "fallback-retrieval-complete-3" })]);
				return response;
			},
			(_context) => {
				return fauxAssistantMessage("Understanding follow-up 已正常收尾。");
			},
		]);
		mode = new InteractiveMode(runtime);
		attachVirtualTerminal(mode, terminal);
		await mode.init();
		void mode.run();
		await terminal.waitForRender();
		terminal.sendInput("請幫我測試 Forge fallback");
		terminal.sendInput("\r");
		const fixedQuestion = "此專案資料來源不足，將以前次grill/ 資料來源所得之證據進行後續開發，請確認";
		await waitForViewport(terminal, "此專案資料來源不足");
		const fallbackViewport = (await terminal.flushAndGetViewport()).join("\n");
		const normalizedViewport = fallbackViewport.replace(/\s+/g, "");
		const normalizedQuestion = fixedQuestion.replace(/\s+/g, "");
		assert.ok(normalizedViewport.includes(normalizedQuestion), "fallback viewport did not contain the complete fixed question");
		assert.match(fallbackViewport, /確認/);
		assert.match(fallbackViewport, /取消/);
		terminal.sendInput("\r");
		await waitForViewport(terminal, "KNOWLEDGE_UNDERSTANDING");
		await runtime.session.waitForIdle();
		assert.deepEqual(await runtime.session.agent.state.tools.map((tool) => tool.name), ["forge_deep_complete"]);
		assert.equal(retrievalCompleteToolCalls, 2, "第二次 needs_discovery 後不得再發第三次 retrieval");
	} finally {
		unsubscribe?.();
		mode?.stop();
		await runtime?.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	}
});
