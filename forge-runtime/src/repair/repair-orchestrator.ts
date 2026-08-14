import type { WorkflowStage } from "../workflow/state-machine.ts";
import type { RootCause } from "./root-cause.ts";

export interface RepairRequest {
	cause: RootCause;
}

export interface RepairOrchestrator {
	repair(request: RepairRequest): Promise<WorkflowStage>;
}

const REPAIR_TARGETS: Record<RootCause, WorkflowStage> = {
	requirement: "GRILL",
	knowledge: "DEEP_KNOWLEDGE_RETRIEVAL",
	context: "CONTEXT_BUILD",
	adr: "ADR_BUILD",
	spec: "TO_SPEC",
	ticket: "TO_TICKET",
	code: "IMPLEMENT_GATE",
	test: "TDD",
	tool: "IMPLEMENT_GATE",
	environment: "IMPLEMENT_GATE",
};

export function createRepairOrchestrator(): RepairOrchestrator {
	return {
		async repair(request) {
			return REPAIR_TARGETS[request.cause];
		},
	};
}
