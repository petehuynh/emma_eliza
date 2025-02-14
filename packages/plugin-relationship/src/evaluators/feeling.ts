import { type Evaluator, type IAgentRuntime, type Memory, type State, ModelClass } from "@elizaos/core";
import { EmotionalState } from "../types";
import { 
    determineDominantEmotion, 
    analyzeSubEmotions, 
    calculateConfidence,
    estimateEmotionalDuration 
} from "../actions/emotionAnalysis";
import { generateText } from "@elizaos/core";
import { composeContext } from "@elizaos/core";

// Add evaluator error types
interface EvaluatorError extends Error {
  code: string;
  recoverable: boolean;
  context?: unknown;
}

class FeelingEvaluatorError extends Error implements EvaluatorError {
  code: string;
  recoverable: boolean;
  context?: unknown;

  constructor(message: string, code: string, recoverable = true, context?: unknown) {
    super(message);
    this.name = 'FeelingEvaluatorError';
    this.code = code;
    this.recoverable = recoverable;
    this.context = context;
  }
}

// Add validation utilities
function validateAnalysisResult(result: any): void {
  if (!result || typeof result !== 'object') {
    throw new FeelingEvaluatorError(
      'Invalid analysis result format',
      'INVALID_RESULT',
      false
    );
  }

  if (!result.analysis || typeof result.analysis !== 'string') {
    throw new FeelingEvaluatorError(
      'Missing or invalid analysis text',
      'INVALID_ANALYSIS',
      false,
      { result }
    );
  }

  if (!result.dominantEmotion || !Object.values(EmotionalState).includes(result.dominantEmotion)) {
    throw new FeelingEvaluatorError(
      'Invalid dominant emotion',
      'INVALID_EMOTION',
      false,
      { emotion: result.dominantEmotion }
    );
  }

  if (!result.confidence || !['high', 'medium', 'low'].includes(result.confidence)) {
    throw new FeelingEvaluatorError(
      'Invalid confidence level',
      'INVALID_CONFIDENCE',
      false,
      { confidence: result.confidence }
    );
  }

  if (!Array.isArray(result.indicators) || result.indicators.length === 0) {
    throw new FeelingEvaluatorError(
      'Missing emotional indicators',
      'MISSING_INDICATORS',
      false,
      { indicators: result.indicators }
    );
  }
}

const feelingTemplate = `TASK: Analyze Emotional State
Analyze the conversation and determine the emotional state of the user based on their messages and interaction patterns.

# INSTRUCTIONS
- Review the recent messages and identify emotional indicators
- Consider both explicit statements and implicit tone
- Look for patterns in interaction style and engagement
- Account for context and relationship history
- Determine confidence level in assessment

# START OF ACTUAL TASK INFORMATION

{{recentMessages}}

TASK: Analyze the conversation and provide a detailed sentiment analysis. Include:
1. Overall emotional tone
2. Key emotional indicators found
3. Confidence level in assessment (high/medium/low)
4. Any notable patterns or changes in emotional state

Response format:
\`\`\`json
{
    "analysis": "Detailed analysis text",
    "dominantEmotion": "HAPPY|SAD|ANGRY|FRUSTRATED",
    "confidence": "high|medium|low",
    "indicators": ["indicator1", "indicator2", ...]
}
\`\`\``;

export const feelingEvaluator: Evaluator = {
    name: "EVALUATE_FEELING",
    similes: ["CHECK_EMOTION", "ASSESS_SENTIMENT", "ANALYZE_MOOD"],
    description: "Evaluates the emotional context and sentiment of interactions",

    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        try {
            if (!message?.roomId || !message?.userId) {
                throw new FeelingEvaluatorError(
                    'Missing required message properties',
                    'INVALID_MESSAGE',
                    false
                );
            }

            // Get recent messages for context
            const recentMessages = await runtime.messageManager.getMemories({
                roomId: message.roomId,
                count: 10
            });

            if (!recentMessages || recentMessages.length === 0) {
                throw new FeelingEvaluatorError(
                    'No recent messages found for analysis',
                    'NO_MESSAGES',
                    false
                );
            }

            return true;
        } catch (error) {
            console.error('Error validating feeling evaluator:', error);
            return false;
        }
    },

    handler: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<EmotionalState> => {
        try {
            // Get recent messages
            const recentMessages = await runtime.messageManager.getMemories({
                roomId: message.roomId,
                count: 10
            });

            if (!recentMessages || recentMessages.length === 0) {
                throw new FeelingEvaluatorError(
                    'No messages available for analysis',
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

            // Create state for context
            const analysisState: State = {
                bio: state?.bio || '',
                lore: state?.lore || '',
                messageDirections: state?.messageDirections || '',
                postDirections: state?.postDirections || '',
                roomId: message.roomId,
                actors: state?.actors || '',
                recentMessagesData: recentMessages,
                recentMessages: JSON.stringify(formattedMessages),
                goals: '',
                lastMessage: state?.lastMessage || null,
                lastResponse: state?.lastResponse || null
            };

            // Compose context for analysis
            const context = await composeContext({
                state: analysisState,
                template: feelingTemplate
            });

            // Generate analysis
            const analysisResult = await generateText({
                runtime,
                context,
                modelClass: ModelClass.LARGE
            });

            if (!analysisResult?.trim()) {
                throw new FeelingEvaluatorError(
                    'Failed to generate analysis',
                    'GENERATION_FAILED',
                    true
                );
            }

            // Parse and validate result
            let result;
            try {
                const jsonMatch = analysisResult.match(/```json\n([\s\S]*?)\n```/);
                if (!jsonMatch) {
                    throw new Error('No JSON found in response');
                }
                result = JSON.parse(jsonMatch[1]);
            } catch (error) {
                throw new FeelingEvaluatorError(
                    'Failed to parse analysis result',
                    'PARSE_ERROR',
                    true,
                    { analysisResult }
                );
            }

            // Validate analysis result
            validateAnalysisResult(result);

            // Convert confidence level to numeric value
            const confidenceMap = { high: 0.9, medium: 0.6, low: 0.3 };
            const confidence = confidenceMap[result.confidence as keyof typeof confidenceMap];

            // Create detailed analysis memory
            await runtime.databaseAdapter.createMemory(
                {
                    userId: message.userId,
                    agentId: runtime.agentId,
                    roomId: message.roomId,
                    content: {
                        text: JSON.stringify({
                            ...result,
                            numericalConfidence: confidence,
                            timestamp: new Date().toISOString()
                        }),
                        action: 'FEELING_ANALYSIS'
                    }
                },
                'emotional_analyses'
            );

            return result.dominantEmotion as EmotionalState;
        } catch (error) {
            if (error instanceof FeelingEvaluatorError) {
                throw error;
            }

            throw new FeelingEvaluatorError(
                'Failed to evaluate feeling',
                'EVALUATION_FAILED',
                true,
                { originalError: error }
            );
        }
    },

    examples: [
        {
            context: "User expresses frustration with technical issues",
            messages: [
                {
                    user: "{{user1}}",
                    content: { text: "This isn't working and I'm getting really annoyed!" },
                },
                {
                    user: "{{agentName}}",
                    content: {
                        text: "I understand your frustration. Let me help resolve this.",
                        emotionalState: EmotionalState.FRUSTRATED
                    },
                },
            ],
            outcome: "Detected frustrated emotional state with high confidence"
        }
    ]
};
