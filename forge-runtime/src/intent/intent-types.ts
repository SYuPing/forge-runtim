export type IntentRoute = "passthrough" | "start_forge" | "resume_wait_user" | "resume_open_workflow";

export type IntentTaskKind =
	| "implementation"
	| "bugfix"
	| "design"
	| "planning"
	| "testing"
	| "review"
	| "refactor"
	| "unknown";

export interface IntentInput {
	userMessage: string;
	hasSlashCommand: boolean;
	sessionState: "idle" | "wait_user" | "open_workflow";
	openWorkflowGoal?: string;
	openWorkflowStage?: string;
	resumeSelectionOptions?: string[];
	recommendedOption?: string;
}

export interface IntentOutput {
	route: IntentRoute;
	goal: string;
	taskKind: IntentTaskKind;
	ambiguities: string[];
	lightDiscoverySeeds: string[];
	resumeSelection?: string;
}
