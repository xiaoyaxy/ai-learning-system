import { z } from "zod";
import type { Role } from "@learning/contracts";
import type { ToolAction } from "../domain/permissions";
export const RoleResultSchema = z
  .object({
    kind: z.string(),
    content: z.record(z.string(), z.unknown()),
    evidence_ids: z.array(z.string()),
    usage: z
      .object({
        input_tokens: z.number().nonnegative().optional(),
        output_tokens: z.number().nonnegative().optional(),
        neurons: z.number().nonnegative().optional(),
      })
      .strict()
      .nullable(),
    request_id: z.string().optional(),
  })
  .strict();
export type RoleResult = z.infer<typeof RoleResultSchema>;
export interface RoleTask {
  project_id: string;
  run_id: string;
  epoch: number;
  step_key: string;
  role: Role;
  action: string;
  evidence_ids: string[];
  public_context: Record<string, unknown>;
  private_context?: Record<string, unknown>;
}
export interface WorkStep {
  external_kind?: "model" | "tool";
  key: string;
  role: Role;
  action: ToolAction;
  input: Record<string, unknown>;
}
export interface RuntimeState {
  owner_id: string | null;
  project_id: string | null;
  run_id: string | null;
  step_key: string | null;
  epoch: number;
  error_code: string | null;
}
