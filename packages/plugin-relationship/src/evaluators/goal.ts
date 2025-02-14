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
    type EvaluationExample,
} from "@elizaos/core";
import { SystemState, RelationshipState } from "../types";

// Add evaluator error types
interface GoalEvaluatorError extends Error {
    code: string;
    recoverable: boolean;
    context?: unknown;
}

class GoalStateError extends Error implements GoalEvaluatorError {
    code: string;
    recoverable: boolean;
    context?: unknown;

    constructor(message: string, code: string, recoverable = true, context?: unknown) {
        super(message);
        this.name = 'GoalStateError';
        this.code = code;
        this.recoverable = recoverable;
        this.context = context;
    }
}

// Add validation utilities
function validateGoal(goal: Goal): void {
    if (!goal.id) {
        throw new GoalStateError(
            'Missing goal ID',
            'INVALID_GOAL',
            false,
            { goal }
        );
    }

    if (!goal.objectives || !Array.isArray(goal.objectives)) {
        throw new GoalStateError(
            'Invalid objectives format',
            'INVALID_OBJECTIVES',
            false,
            { goal }
        );
    }

    if (goal.status && !['IN_PROGRESS', 'DONE', 'FAILED'].includes(goal.status)) {
        throw new GoalStateError(
            'Invalid goal status',
            'INVALID_STATUS',
            false,
            { goal, status: goal.status }
        );
    }

    goal.objectives.forEach((objective, index) => {
        if (!objective.id || !objective.description) {
            throw new GoalStateError(
                'Invalid objective format',
                'INVALID_OBJECTIVE',
                false,
                { objective, index }
            );
        }
    });
}

function validateGoalUpdates(updates: Goal[]): void {
    if (!Array.isArray(updates)) {
        throw new GoalStateError(
            'Invalid updates format',
            'INVALID_UPDATES',
            false,
            { updates }
        );
    }

    updates.forEach((goal, index) => {
        validateGoal(goal);
    });
}

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
    "objectives": [ // optional, include all objectives if updating any
      {
        "id": <objective uuid>,
        "description": "objective description",
        "completed": true | false
      }
    ]
  }
]
\`\`\``;

export const goalEvaluator: Evaluator = {
    name: "EVALUATE_GOALS",
    similes: ["CHECK_GOALS", "ASSESS_PROGRESS", "UPDATE_GOALS"],
    description: "Evaluates the progress of relationship goals and updates their status",

    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        try {
            if (!message?.roomId || !message?.userId) {
                throw new GoalStateError(
                    'Missing required message properties',
                    'INVALID_MESSAGE',
                    false
                );
            }

            // Get active goals
            const goals = await getGoals({
                runtime,
                roomId: message.roomId,
                onlyInProgress: true
            });

            if (!goals || goals.length === 0) {
                throw new GoalStateError(
                    'No active goals found',
                    'NO_GOALS',
                    false
                );
            }

            return true;
        } catch (error) {
            console.error('Error validating goal evaluator:', error);
            return false;
        }
    },

    handler: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<Goal[]> => {
        try {
            // Get active goals
            const goals = await getGoals({
                runtime,
                roomId: message.roomId,
                onlyInProgress: true
            });

            if (!goals || goals.length === 0) {
                throw new GoalStateError(
                    'No goals available for evaluation',
                    'NO_GOALS',
                    false
                );
            }

            // Get recent messages for context
            const recentMessages = await runtime.messageManager.getMemories({
                roomId: message.roomId,
                count: 10
            });

            if (!recentMessages || recentMessages.length === 0) {
                throw new GoalStateError(
                    'No messages available for evaluation',
                    'NO_MESSAGES',
                    false
                );
            }

            // Format messages for context
            const formattedMessages = recentMessages.map(msg => ({
                text: msg.content.text,
                timestamp: msg.createdAt,
                userId: msg.userId
            }));

            // Create evaluation state
            const evaluationState: State = {
                bio: state?.bio || '',
                lore: state?.lore || '',
                messageDirections: state?.messageDirections || '',
                postDirections: state?.postDirections || '',
                roomId: message.roomId,
                actors: state?.actors || '',
                recentMessagesData: recentMessages,
                recentMessages: '',
                goals: '',
                lastMessage: state?.lastMessage || null,
                lastResponse: state?.lastResponse || null
            };

            // Create evaluation context with dynamic data
            const context = await composeContext({
                state: {
                    ...evaluationState,
                    goals: JSON.stringify(goals),
                    recentMessages: JSON.stringify(formattedMessages)
                },
                template: goalsTemplate
            });

            // Generate evaluation
            const evaluationResult = await generateText({
                runtime,
                context,
                modelClass: ModelClass.LARGE
            });

            if (!evaluationResult?.trim()) {
                throw new GoalStateError(
                    'Failed to generate evaluation',
                    'GENERATION_FAILED',
                    true
                );
            }

            // Parse and validate updates
            let updates: Goal[];
            try {
                updates = parseJsonArrayFromText(evaluationResult);
            } catch (error) {
                throw new GoalStateError(
                    'Failed to parse evaluation result',
                    'PARSE_ERROR',
                    true,
                    { evaluationResult }
                );
            }

            // Validate updates
            validateGoalUpdates(updates);

            // Create evaluation record
            await runtime.databaseAdapter.createMemory(
                {
                    userId: message.userId,
                    agentId: runtime.agentId,
                    roomId: message.roomId,
                    content: {
                        text: JSON.stringify({
                            goals,
                            updates,
                            timestamp: new Date().toISOString()
                        }),
                        action: 'GOAL_EVALUATION'
                    }
                },
                'goal_evaluations'
            );

            return updates;
        } catch (error) {
            if (error instanceof GoalStateError) {
                throw error;
            }

            throw new GoalStateError(
                'Failed to evaluate goals',
                'EVALUATION_FAILED',
                true,
                { originalError: error }
            );
        }
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
            ],
            outcome: "Goal completed: Build initial rapport with user"
        }
    ]
};
