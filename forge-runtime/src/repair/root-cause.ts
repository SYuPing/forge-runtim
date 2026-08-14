export const ROOT_CAUSES = [
	"requirement",
	"knowledge",
	"context",
	"adr",
	"spec",
	"ticket",
	"code",
	"test",
	"tool",
	"environment",
] as const;

export type RootCause = (typeof ROOT_CAUSES)[number];
