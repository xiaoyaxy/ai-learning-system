import type { ModelGateway, RoleModelRequest } from "./model";
import type { RoleResult } from "../runtime/types";
/** Deterministic fixtures are for explicit local demo and tests only. */
export class FixtureModelGateway implements ModelGateway {
  constructor(private respond: (request: RoleModelRequest) => RoleResult) {}
  async generate(request: RoleModelRequest) {
    return this.respond(request);
  }
}
