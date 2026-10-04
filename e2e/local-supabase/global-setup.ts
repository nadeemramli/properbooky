import { assertFixtureStack } from "./support";

// Refuse the whole run unless the target is the marked PBK-30 fixture stack.
export default function globalSetup() {
  assertFixtureStack();
}
