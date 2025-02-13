import { composeContext } from "@elizaos/core";
import { generateText } from "@elizaos/core";
import { getGoals } from "@elizaos/core";
import { parseJsonArrayFromText } from "@elizaos/core";
import {
    type IAgentRuntime,
    type Memory,
    ModelClass,
    type Objective,
    type Goal,
    type State,
    type Evaluator,
} from "@elizaos/core";
import { SystemState, RelationshipState } from "../types";

const goalsTemplate = `TASK: Update Goal
Analyze the conversation and update the status of the goals based on the new information provided.

# INSTRUCTIONS

- Review the conversation and identify any progress towards the objectives of the current goals.
- Update the objectives if they have been completed or if there is new information about them.
- Update the status of the goal to 'DONE' if all objectives are completed.
- If no progress is made, do not change the status of the goal.

# START OF ACTUAL TASK INFORMATION

{{goals}}
{{recentMessages}}

TASK: Analyze the conversation and update the status of the goals based on the new information provided. Respond with a JSON array of goals to update.
- Each item must include the goal ID, as well as the fields in the goal to update.
- For updating objectives, include the entire objectives array including unchanged fields.
- Only include goals which need to be updated.
- Goal status options are 'IN_PROGRESS', 'DONE' and 'FAILED'. If the goal is active it should always be 'IN_PROGRESS'.
- If the goal has been successfully completed, set status to DONE. If the goal cannot be completed, set status to FAILED.
- If those goal is still in progress, do not include the status field.

Response format should be:
\`\`\`json
[
  {
    "id": <goal uuid>, // required
    "status": "IN_PROGRESS" | "DONE" | "FAILED", // optional
    "objectives": [ // optional
      { "description": "Objective description", "completed": true | false },
      { "description": "Objective description", "completed": true | false }
    ] // NOTE: If updating objectives, include the entire objectives array including unchanged fields.
  }
]
\`\`\``;

async function handler(
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options: { [key: string]: unknown } = { onlyInProgress: true }
): Promise<Goal[]> {
    state = (await runtime.composeState(message)) as State;
    const context = composeContext({
        state,
        template: runtime.character.templates?.goalsTemplate || goalsTemplate,
    });

    // Request generateText from OpenAI to analyze conversation and suggest goal updates
    const response = await generateText({
        runtime,
        context,
        modelClass: ModelClass.LARGE,
    });

    // Parse the JSON response to extract goal updates
    const updates = parseJsonArrayFromText(response);

    // get goals
    const goalsData = await getGoals({
        runtime,
        roomId: message.roomId,
        onlyInProgress: options.onlyInProgress as boolean,
    });

    // Apply the updates to the goals
    const updatedGoals = goalsData
        .map((goal: Goal): Goal => {
            const update = updates?.find((u) => u.id === goal.id);
            if (update) {
                // Merge the update into the existing goal
                return {
                    ...goal,
                    ...update,
                    objectives: goal.objectives.map((objective) => {
                        const updatedObjective = update.objectives?.find(uo => uo.description === objective.description);
                        return updatedObjective ? { ...objective, ...updatedObjective } : objective;
                    }),
                };
            }
            return null; // No update for this goal
        })
        .filter(Boolean);

    // Update goals in the database
    for (const goal of updatedGoals) {
        const id = goal.id;
        // delete id from goal
        if (goal.id) delete goal.id;
        await runtime.databaseAdapter.updateGoal({ ...goal, id });
    }

    return updatedGoals; // Return updated goals for further processing or logging
}

export const goalEvaluator: Evaluator = {
    name: "EVALUATE_GOALS",
    similes: ["CHECK_OBJECTIVES", "ASSESS_PROGRESS", "REVIEW_TARGETS"],
    description: "Evaluates progress towards relationship and interaction goals",

    validate: async (runtime: IAgentRuntime, message: Memory) => {
        // Check if goals are defined for current interaction
        // Verify we're tracking progress
        // Ensure we have sufficient context for evaluation
        // Check if goal evaluation is needed at this point
    },

    handler: async (runtime: IAgentRuntime, message: Memory) => {
        // Retrieve current interaction goals
        // Assess progress towards each goal
        // Check relationship state transitions
        // Update goal completion status
        // Determine if new goals needed
        // Generate goal progress report
        // Update relationship progression path
        // Trigger goal-based actions
        // Log goal status changes
        // Recommend next steps based on goal status
    },

    examples: [
        {
            context: "Building relationship from stranger to acquaintance",
            messages: [
                {
                    user: "{{user1}}",
                    content: { text: "Thanks for consistently helping with my questions" },
                },
                {
                    user: "{{agentName}}",
                    content: {
                        text: "Happy to help! We've built a good rapport.",
                        relationshipState: RelationshipState.ACQUAINTANCE
                    },
                },
            ]
        },
        // Add more examples...
    ]
};
