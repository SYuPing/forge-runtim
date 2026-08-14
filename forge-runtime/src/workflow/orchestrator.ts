import { createStateMachine, type WorkflowStage } from "./state-machine.ts";

export interface GrillResult {
	requiresUserConfirmation: boolean;
}

export interface ImplementGateInput {
	requiresCode: boolean;
}

export interface ValidationResult {
	passed: boolean;
}

export interface OrchestratorOptions {
	initialStage?: WorkflowStage;
}

export interface Orchestrator {
	getStage(): WorkflowStage;
	handleGrillResult(result: GrillResult): WorkflowStage;
	handleImplementGate(input: ImplementGateInput): WorkflowStage;
	handleUserConfirmation(): WorkflowStage;
	handleValidationResult(result: ValidationResult): WorkflowStage;
	transitionTo(nextStage: WorkflowStage): WorkflowStage;
}

export function createOrchestrator(options: OrchestratorOptions = {}): Orchestrator {
	const stateMachine = createStateMachine({ initialStage: options.initialStage });

	return {
		getStage() {
			return stateMachine.getStage();
		},
		transitionTo(nextStage) {
			return stateMachine.transitionTo(nextStage);
		},
		handleGrillResult(result) {
			return stateMachine.transitionTo(result.requiresUserConfirmation ? "WAIT_USER" : "DEEP_KNOWLEDGE_RETRIEVAL");
		},
		handleImplementGate(input) {
			return stateMachine.transitionTo(input.requiresCode ? "TDD" : "JUDGE");
		},
		handleUserConfirmation() {
			return stateMachine.transitionTo("USER_CONFIRMED");
		},
		handleValidationResult(result) {
			return stateMachine.transitionTo(result.passed ? "REVIEW" : "ROOT_CAUSE");
		},
	};
}
