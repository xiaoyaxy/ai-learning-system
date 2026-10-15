import type { StepContext } from "../db/types";
export interface ToolContext extends StepContext {
  run_id: string;
}
export function makeToolContext(ctx: ToolContext): Readonly<ToolContext> {
  return Object.freeze({ ...ctx });
}
