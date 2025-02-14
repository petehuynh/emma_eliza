import { type Plugin } from "@elizaos/core";
import { relationshipProvider } from "./providers/relationship";
import { userEvaluationAction } from "./actions/userEvaluation";
import { emotionAnalysisAction } from "./actions/emotionAnalysis";
import { monitorAction } from "./actions/monitor";
import { responseModeAction } from "./actions/responseMode";
import { endAction } from "./actions/endAction";
import { feelingEvaluator } from "./evaluators/feeling";
import { goalEvaluator } from "./evaluators/goal";
import { timeProvider } from "./providers/time.ts";

export * as actions from "./actions/index.ts";
export * as evaluators from "./evaluators/index.ts";
export * as providers from "./providers/index.ts";

export const relationshipPlugin: Plugin = {
    name: "relationship",
    description: "Monitor and build relationships via reciprocity.",
    actions: [monitorAction, emotionAnalysisAction, userEvaluationAction, responseModeAction, endAction   
    ],
    evaluators: [goalEvaluator,feelingEvaluator],
    providers: [timeProvider,relationshipProvider],
};
export default relationshipPlugin;
