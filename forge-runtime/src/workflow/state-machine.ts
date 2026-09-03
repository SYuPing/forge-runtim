export const WORKFLOW_STAGES = [
	"RECEIVE",
	"INTENT_UNDERSTANDING",
	"LIGHT_DISCOVERY",
	"GRILL",
	"WAIT_USER",
	"USER_CONFIRMED",
	"DEEP_KNOWLEDGE_RETRIEVAL",
	"KNOWLEDGE_UNDERSTANDING",
	"CONTEXT_BUILD",
	"ADR_BUILD",
	"TO_SPEC",
	"TO_TICKET",
	"PLANNING",
	"IMPLEMENT_GATE",
	"TDD",
	"FAN_OUT_EXECUTION",
	"VALIDATION",
	"REVIEW",
	"JUDGE",
	"COMPLETE",
	"ROOT_CAUSE",
	"REPAIR_ORCHESTRATOR",
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export interface StateMachineOptions {
	initialStage?: WorkflowStage;
}

export interface StateMachine {
	canTransitionTo(nextStage: WorkflowStage): boolean;
	getStage(): WorkflowStage;
	transitionTo(nextStage: WorkflowStage): WorkflowStage;
}

const DEFAULT_STAGE: WorkflowStage = "RECEIVE";

const LEGAL_TRANSITIONS: Record<WorkflowStage, readonly WorkflowStage[]> = {
	RECEIVE: ["INTENT_UNDERSTANDING"],
	INTENT_UNDERSTANDING: ["LIGHT_DISCOVERY"],
	LIGHT_DISCOVERY: ["GRILL"],
	GRILL: ["WAIT_USER", "DEEP_KNOWLEDGE_RETRIEVAL"],
	WAIT_USER: ["USER_CONFIRMED"],
	USER_CONFIRMED: [
		"GRILL",
		"LIGHT_DISCOVERY",
		"DEEP_KNOWLEDGE_RETRIEVAL",
		"KNOWLEDGE_UNDERSTANDING",
		"CONTEXT_BUILD",
		"ADR_BUILD",
	],
	DEEP_KNOWLEDGE_RETRIEVAL: ["KNOWLEDGE_UNDERSTANDING", "LIGHT_DISCOVERY", "WAIT_USER"],
	KNOWLEDGE_UNDERSTANDING: ["CONTEXT_BUILD", "LIGHT_DISCOVERY", "WAIT_USER"],
	CONTEXT_BUILD: ["ADR_BUILD", "WAIT_USER"],
	ADR_BUILD: ["TO_SPEC", "WAIT_USER"],
	TO_SPEC: ["TO_TICKET"],
	TO_TICKET: ["PLANNING"],
	PLANNING: ["IMPLEMENT_GATE"],
	IMPLEMENT_GATE: ["TDD", "JUDGE"],
	TDD: ["FAN_OUT_EXECUTION"],
	FAN_OUT_EXECUTION: ["VALIDATION"],
	VALIDATION: ["REVIEW", "ROOT_CAUSE"],
	REVIEW: ["JUDGE", "ROOT_CAUSE"],
	JUDGE: ["COMPLETE", "ROOT_CAUSE"],
	COMPLETE: [],
	ROOT_CAUSE: ["REPAIR_ORCHESTRATOR"],
	REPAIR_ORCHESTRATOR: [
		"GRILL",
		"DEEP_KNOWLEDGE_RETRIEVAL",
		"CONTEXT_BUILD",
		"ADR_BUILD",
		"TO_SPEC",
		"TO_TICKET",
		"IMPLEMENT_GATE",
		"TDD",
	],
};

export function createStateMachine(options: StateMachineOptions = {}): StateMachine {
	let currentStage = options.initialStage ?? DEFAULT_STAGE;

	return {
		canTransitionTo(nextStage) {
			return LEGAL_TRANSITIONS[currentStage].includes(nextStage);
		},
		getStage() {
			return currentStage;
		},
		transitionTo(nextStage) {
			if (!LEGAL_TRANSITIONS[currentStage].includes(nextStage)) {
				throw new Error(`Invalid transition: ${currentStage} -> ${nextStage}`);
			}

			currentStage = nextStage;
			return currentStage;
		},
	};
}
