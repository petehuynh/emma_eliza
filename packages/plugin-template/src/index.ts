import type { Plugin } from "@elizaos/core";
import { continueAction } from "./actions/continue.ts";
import { goalEvaluator } from "./evaluators/goal.ts";
import { timeProvider } from "./providers/time.ts";

export * as actions from "./actions";
export * as evaluators from "./evaluators";
export * as providers from "./providers";

export const templatePlugin: Plugin = {
    name: "template",
    description: "Put your description here and make sure you replace the templatePlugin with your plugin name in the export default",
    actions: [continueAction],
    evaluators: [goalEvaluator],
    providers: [timeProvider],
};
export default templatePlugin;
