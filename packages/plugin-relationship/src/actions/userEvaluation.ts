import { type IAgentRuntime, type Memory, type Action, type UUID } from "@elizaos/core";
import {
  SystemState,
  EmotionalState,
  RelationshipState,
  ResponseMode,
  type RelationshipContext,
  type InteractionHistory
} from "../types";

interface UserEvaluationResult {
  credibilityScore: number;
  relationshipState: RelationshipState;
  recommendedResponseMode: ResponseMode;
  analysis: {
    emotionalTrend: EmotionalState[];
    interactionFrequency: number;
    averageResponseTime: number;
    engagementScore: number;
  };
}

export const userEvaluationAction: Action = {
  name: 'EVALUATE_USER',
  similes: ['ASSESS_USER', 'ANALYZE_USER_HISTORY', 'CHECK_USER_STATUS'],
  description: 'Evaluates user history and interaction patterns to determine relationship state and credibility',
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    if (!message?.userId) {
      return false;
    }

    try {
      const contexts = await runtime.databaseAdapter.getMemories({
        roomId: message.roomId,
        tableName: 'relationship_contexts',
        agentId: runtime.agentId,
        count: 1
      });
      
      const context = contexts[0] as unknown as RelationshipContext;
      return context?.currentState === SystemState.USER_EVALUATION;
    } catch (error) {
      console.error('Error validating user evaluation:', error);
      return false;
    }
  },

  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const userId = message.userId;

    // Get relationship context
    const contexts = await runtime.databaseAdapter.getMemories({
      roomId: message.roomId,
      tableName: 'relationship_contexts',
      agentId: runtime.agentId,
      count: 1
    });
    
    const context = contexts[0] as unknown as RelationshipContext;
    
    // Perform user evaluation
    const evaluationResult = await evaluateUser(runtime, userId, context);
    
    // Update relationship context with evaluation results
    await updateContext(runtime, userId, evaluationResult, context);

    return {
      success: true,
      evaluation: evaluationResult
    };
  },

  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Let's work together on this project",
          credibilityScore: 7.5,
          relationshipState: RelationshipState.ACQUAINTANCE
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "I don't trust your suggestions anymore",
          credibilityScore: 2.5,
          relationshipState: RelationshipState.ADVERSARY
        }
      }
    ]
  ]
};

async function evaluateUser(
  runtime: IAgentRuntime,
  userId: UUID,
  context: RelationshipContext
): Promise<UserEvaluationResult> {
  // Get user's interaction history
  const history = context.interactionHistory;
  
  // Calculate emotional trend
  const emotionalTrend = calculateEmotionalTrend(history);
  
  // Calculate interaction metrics
  const interactionMetrics = calculateInteractionMetrics(history);
  
  // Calculate credibility score
  const credibilityScore = calculateCredibilityScore(
    context.credibilityScore,
    emotionalTrend,
    interactionMetrics
  );
  
  // Determine relationship state
  const relationshipState = determineRelationshipState(
    context.relationshipState,
    credibilityScore,
    interactionMetrics
  );
  
  // Recommend response mode
  const recommendedResponseMode = determineResponseMode(
    relationshipState,
    emotionalTrend,
    interactionMetrics
  );
  
  return {
    credibilityScore,
    relationshipState,
    recommendedResponseMode,
    analysis: {
      emotionalTrend,
      interactionFrequency: interactionMetrics.frequency,
      averageResponseTime: interactionMetrics.averageResponseTime,
      engagementScore: interactionMetrics.engagementScore
    }
  };
}

function calculateEmotionalTrend(history: InteractionHistory[]): EmotionalState[] {
  // Get last 10 emotional states
  return history
    .slice(-10)
    .map(interaction => interaction.emotionalState);
}

interface InteractionMetrics {
  frequency: number;
  averageResponseTime: number;
  engagementScore: number;
}

function calculateInteractionMetrics(history: InteractionHistory[]): InteractionMetrics {
  const now = new Date();
  const dayInMs = 24 * 60 * 60 * 1000;
  const recentHistory = history.filter(h => 
    (now.getTime() - h.timestamp.getTime()) <= 7 * dayInMs
  );
  
  // Calculate frequency (interactions per day)
  const frequency = recentHistory.length / 7;
  
  // Calculate average response time
  const responseTimes = recentHistory
    .map((h, i) => i > 0 ? h.timestamp.getTime() - recentHistory[i-1].timestamp.getTime() : 0)
    .filter(time => time > 0);
  
  const averageResponseTime = responseTimes.length > 0
    ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
    : 0;
  
  // Calculate engagement score (0-1)
  const engagementScore = Math.min(
    (frequency * 0.4) + // Weight frequency at 40%
    (1 - (averageResponseTime / (24 * 60 * 60 * 1000)) * 0.3) + // Weight response time at 30%
    (recentHistory.filter(h => h.responseType === 'ANALYZED').length / recentHistory.length * 0.3), // Weight meaningful responses at 30%
    1
  );
  
  return {
    frequency,
    averageResponseTime,
    engagementScore
  };
}

function calculateCredibilityScore(
  currentScore: number,
  emotionalTrend: EmotionalState[],
  metrics: InteractionMetrics
): number {
  let score = currentScore;
  
  // Adjust based on emotional stability
  const emotionalStability = calculateEmotionalStability(emotionalTrend);
  score += emotionalStability * 0.2;
  
  // Adjust based on engagement
  score += (metrics.engagementScore - 0.5) * 0.2;
  
  // Adjust based on interaction frequency
  if (metrics.frequency > 3) score += 0.1;
  if (metrics.frequency < 0.5) score -= 0.1;
  
  // Ensure score stays within 0-10 range
  return Math.max(0, Math.min(10, score));
}

function calculateEmotionalStability(emotionalTrend: EmotionalState[]): number {
  if (emotionalTrend.length < 2) return 0;
  
  // Count emotional state changes
  const changes = emotionalTrend.reduce((count, state, i) => 
    i > 0 && state !== emotionalTrend[i-1] ? count + 1 : count, 0
  );
  
  // Return stability score (0-1)
  return 1 - (changes / (emotionalTrend.length - 1));
}

function determineRelationshipState(
  currentState: RelationshipState,
  credibilityScore: number,
  metrics: InteractionMetrics
): RelationshipState {
  // Handle adversarial cases first
  if (credibilityScore < 3) {
    return RelationshipState.ADVERSARY;
  }
  
  // Define state transition thresholds
  const thresholds = {
    [RelationshipState.STRANGER]: {
      nextState: RelationshipState.ACQUAINTANCE,
      credibilityRequired: 5,
      engagementRequired: 0.4
    },
    [RelationshipState.ACQUAINTANCE]: {
      nextState: RelationshipState.FRIEND,
      credibilityRequired: 7,
      engagementRequired: 0.6
    },
    [RelationshipState.FRIEND]: {
      nextState: RelationshipState.PARTNER,
      credibilityRequired: 8.5,
      engagementRequired: 0.8
    }
  };
  
  // Check for progression
  const threshold = thresholds[currentState];
  if (threshold && 
      credibilityScore >= threshold.credibilityRequired &&
      metrics.engagementScore >= threshold.engagementRequired) {
    return threshold.nextState;
  }
  
  // Check for regression
  if (credibilityScore < 5 && currentState !== RelationshipState.STRANGER) {
    return RelationshipState.ACQUAINTANCE;
  }
  
  return currentState;
}

function determineResponseMode(
  relationshipState: RelationshipState,
  emotionalTrend: EmotionalState[],
  metrics: InteractionMetrics
): ResponseMode {
  // Check for disengagement
  if (metrics.frequency < 0.2 || metrics.engagementScore < 0.3) {
    return ResponseMode.DISENGAGEMENT;
  }
  
  // For new relationships
  if (relationshipState === RelationshipState.STRANGER) {
    return ResponseMode.INITIAL;
  }
  
  // Default to ongoing mode
  return ResponseMode.ONGOING;
}

async function updateContext(
  runtime: IAgentRuntime,
  userId: UUID,
  evaluation: UserEvaluationResult,
  context: RelationshipContext
): Promise<void> {
  const updatedContext = {
    ...context,
    credibilityScore: evaluation.credibilityScore,
    relationshipState: evaluation.relationshipState,
    responseMode: evaluation.recommendedResponseMode,
    currentState: SystemState.RESPONSE_MODE,
    lastInteraction: new Date(),
    interactionHistory: [
      ...context.interactionHistory,
      {
        timestamp: new Date(),
        action: 'USER_EVALUATION',
        emotionalState: context.emotionalState,
        responseType: 'ANALYZED'
      }
    ]
  };

  await runtime.databaseAdapter.createMemory(
    {
      userId,
      agentId: runtime.agentId,
      roomId: userId,
      content: {
        text: JSON.stringify(updatedContext),
        action: 'STATE_UPDATE',
        responseType: 'ANALYZED',
        emotionalState: context.emotionalState
      }
    },
    'relationship_contexts',
    true
  );
} 