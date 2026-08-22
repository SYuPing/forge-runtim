export type IntentRoute = "passthrough" | "start_forge";

export interface IntentInput {
	userMessage: string;
	hasSlashCommand: boolean;
	sessionState: "idle" | "wait_user" | "open_workflow";
}

export interface IntentOutput {
	route: IntentRoute;
}

export interface IntentModelContext {
	model?: object;
	modelRegistry?: {
		complete(
			model: object,
			context: {
				systemPrompt?: string;
				messages: Array<{ role: "user"; content: Array<{ type: "text"; text: string }> }>;
			},
			options?: { signal?: AbortSignal },
		): Promise<{ content?: Array<{ type?: string; text?: string }> }>;
	};
	signal?: AbortSignal;
}
