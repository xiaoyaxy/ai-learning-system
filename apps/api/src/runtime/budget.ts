import { ApiError } from "../http/errors";
export interface RunBudget {
  model: number;
  tool: number;
  handoff: number;
}
export class BudgetTracker {
  private value: RunBudget;
  constructor(initial: RunBudget = { model: 0, tool: 0, handoff: 0 }) {
    this.value = { ...initial };
  }
  consume(kind: keyof RunBudget) {
    const limit = { model: 8, tool: 12, handoff: 6 };
    if (this.value[kind] >= limit[kind])
      throw new ApiError("BUDGET_EXCEEDED", 409);
    this.value[kind]++;
  }
  snapshot() {
    return { ...this.value };
  }
}
