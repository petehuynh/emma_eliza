import type { Plugin } from "@elizaos/core";
import { monitorAction } from "./actions/monitor.ts";
import { emotionAnalysisAction } from "./actions/emotionAnalysis.ts";
import { userEvalAction } from "./actions/userEval.ts";
import { responseModeAction } from "./actions/responseMode.ts";
import { endAction } from "./actions/end.ts";
import { goalEvaluator } from "./evaluators/goal.ts";
import { feelingEvaluator } from "./evaluators/feeling.ts";
import { timeProvider } from "./providers/time.ts";
import { relationshipProvider } from "./providers/relationship.ts";

export * as actions from "./actions/index.ts";
export * as evaluators from "./evaluators/index.ts";
export * as providers from "./providers/index.ts";

export const relationshipPlugin: Plugin = {
    name: "relationship",
    description: "Monitor and build relationships via reciprocity.",
    actions: [monitorAction, emotionAnalysisAction, userEvalAction, responseModeAction, endAction   
    ],
    evaluators: [goalEvaluator,feelingEvaluator],
    providers: [timeProvider,relationshipProvider],
};
export default relationshipPlugin;
