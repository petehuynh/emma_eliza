import { IAgentRuntime, UUID } from '@elizaos/core';
import {
  RelationshipState,
  type RelationshipContext,
  type RelationshipMetrics,
  type InteractionHistory
} from '../types';
import { EmotionalState } from '../types';

// Additional interfaces for enhancements
export interface StateChange {
  previousState: RelationshipState;
  newState: RelationshipState;
  reason: string;
  timestamp: Date;
}

export interface DetailedMetrics extends RelationshipMetrics {
  recentTrend: 'improving' | 'stable' | 'declining';
  confidenceScore: number;
  lastStateChange?: Date;
}

// Helper: Validate input parameters
const validateInputs = (context: RelationshipContext, metrics: RelationshipMetrics): void => {
  if (!context || !metrics) {
    throw new Error('Invalid input: context and metrics are required');
  }
  if (metrics.credibilityScore < 0 || metrics.credibilityScore > 10) {
    throw new Error('Invalid credibility score: must be between 0 and 10');
  }
  if (metrics.averageSentiment < 0 || metrics.averageSentiment > 1) {
    throw new Error('Invalid sentiment: must be between 0 and 1');
  }
};

// Helper: Log state change
const logStateChange = (
  context: RelationshipContext,
  previousState: RelationshipState,
  newState: RelationshipState,
  reason: string
): void => {
  const stateChange: StateChange = {
    previousState,
    newState,
    reason,
    timestamp: new Date()
  };
  
  // Initialize stateChangeLog if it doesn't exist
  if (!('stateChangeLog' in context)) {
    (context as any).stateChangeLog = [];
  }
  (context as any).stateChangeLog.push(stateChange);
};

// Helper: Retry logic for asynchronous operations
const retryOperation = async <T>(
  operation: () => Promise<T>, 
  maxRetries = 3, 
  delay = 1000
): Promise<T> => {
  let lastError: Error;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
};

// Calculate trend based on interaction history
const calculateTrend = (history: InteractionHistory[]): 'improving' | 'stable' | 'declining' => {
  if (history.length < 3) return 'stable';
  
  const recentInteractions = history.slice(-3);
  const positiveCount = recentInteractions.filter(
    interaction => interaction.emotionalState === EmotionalState.HAPPY
  ).length;
  const negativeCount = recentInteractions.filter(
    interaction => interaction.emotionalState === EmotionalState.SAD || 
                   interaction.emotionalState === EmotionalState.ANGRY ||
                   interaction.emotionalState === EmotionalState.FRUSTRATED
  ).length;
  
  if (positiveCount > negativeCount) return 'improving';
  if (negativeCount > positiveCount) return 'declining';
  return 'stable';
};

// Enhanced Metrics Calculation
export const calculateDetailedMetrics = async (
  runtime: IAgentRuntime,
  context: RelationshipContext
): Promise<DetailedMetrics> => {
  // Calculate average sentiment from interaction history
  const sentiments = context.interactionHistory.map(interaction => {
    switch (interaction.emotionalState) {
      case EmotionalState.HAPPY:
        return 1.0;
      case EmotionalState.FRUSTRATED:
        return 0.3;
      case EmotionalState.SAD:
      case EmotionalState.ANGRY:
        return 0.0;
      default:
        return 0.5;
    }
  });

  const averageSentiment = sentiments.length > 0
    ? sentiments.reduce((sum, val) => sum + val, 0) / sentiments.length
    : 0.5;

  const baseMetrics: RelationshipMetrics = {
    credibilityScore: context.credibilityScore,
    interactionFrequency: context.interactionHistory.length,
    averageSentiment
  };

  const recentTrend = calculateTrend(context.interactionHistory);
  const confidenceScore = Math.min(1, context.interactionHistory.length / 10);

  return {
    ...baseMetrics,
    recentTrend,
    confidenceScore,
    lastStateChange: new Date()
  };
};

// Helper function to create memory content with required text field
function createMemoryContent(context: RelationshipContext, runtime: IAgentRuntime) {
  return {
    id: context.userId,
    userId: context.userId,
    agentId: runtime.agentId,
    roomId: context.userId, // Using userId as roomId since this is a 1:1 relationship context
    content: {
      text: `Relationship state: ${context.relationshipState}, Credibility: ${context.credibilityScore}`,
      ...context
    }
  };
}

// Main function to update relationship state with enhanced logic
export async function updateDetailedRelationshipStateEnhanced(
  runtime: IAgentRuntime,
  context: RelationshipContext,
  metrics: RelationshipMetrics
): Promise<void> {
  // Validate input
  validateInputs(context, metrics);
  
  const previousState = context.relationshipState;
  
  // Force state to ADVERSARY if credibility is too low
  if (metrics.credibilityScore < 2) {
    context.relationshipState = RelationshipState.ADVERSARY;
    logStateChange(context, previousState, RelationshipState.ADVERSARY, 'Credibility score too low');
    await retryOperation(() => runtime.databaseAdapter.createMemory(
      createMemoryContent(context, runtime),
      'relationship_contexts',
      true
    ));
    return;
  }

  // Handle state transitions based on metrics and current state
  switch (context.relationshipState) {
    case RelationshipState.STRANGER:
      if (metrics.interactionFrequency >= 5 && metrics.averageSentiment > 0.5) {
        context.relationshipState = RelationshipState.ACQUAINTANCE;
        logStateChange(
          context,
          RelationshipState.STRANGER,
          RelationshipState.ACQUAINTANCE,
          'Sufficient interactions and positive sentiment'
        );
      } else if (metrics.credibilityScore >= 7 && metrics.averageSentiment >= 0.8) {
        context.relationshipState = RelationshipState.BUSINESS;
        logStateChange(
          context,
          RelationshipState.STRANGER,
          RelationshipState.BUSINESS,
          'High credibility and very positive sentiment'
        );
      }
      break;
      
    case RelationshipState.ACQUAINTANCE:
      if (metrics.credibilityScore >= 8 && metrics.averageSentiment >= 0.7) {
        context.relationshipState = RelationshipState.FRIEND;
        logStateChange(
          context,
          RelationshipState.ACQUAINTANCE,
          RelationshipState.FRIEND,
          'High credibility and strongly positive sentiment'
        );
      } else if (metrics.averageSentiment < 0.3) {
        context.relationshipState = RelationshipState.STRANGER;
        logStateChange(
          context,
          RelationshipState.ACQUAINTANCE,
          RelationshipState.STRANGER,
          'Significant drop in sentiment'
        );
      }
      break;
      
    case RelationshipState.FRIEND:
      if (metrics.credibilityScore >= 9 && metrics.averageSentiment >= 0.9 && metrics.interactionFrequency >= 20) {
        context.relationshipState = RelationshipState.PARTNER;
        logStateChange(
          context,
          RelationshipState.FRIEND,
          RelationshipState.PARTNER,
          'Exceptional metrics across all dimensions'
        );
      } else if (metrics.averageSentiment < 0.4 || metrics.credibilityScore < 6) {
        context.relationshipState = RelationshipState.ACQUAINTANCE;
        logStateChange(
          context,
          RelationshipState.FRIEND,
          RelationshipState.ACQUAINTANCE,
          'Significant decline in relationship metrics'
        );
      }
      break;

    case RelationshipState.PARTNER:
      if (metrics.averageSentiment < 0.6 || metrics.credibilityScore < 7) {
        context.relationshipState = RelationshipState.FRIEND;
        logStateChange(
          context,
          RelationshipState.PARTNER,
          RelationshipState.FRIEND,
          'Decline in relationship strength'
        );
      }
      break;

    case RelationshipState.BUSINESS:
      if (metrics.credibilityScore < 5) {
        context.relationshipState = RelationshipState.COMPETITOR;
        logStateChange(
          context,
          RelationshipState.BUSINESS,
          RelationshipState.COMPETITOR,
          'Decline in business relationship'
        );
      } else if (metrics.averageSentiment >= 0.8 && metrics.interactionFrequency >= 15) {
        context.relationshipState = RelationshipState.PARTNER;
        logStateChange(
          context,
          RelationshipState.BUSINESS,
          RelationshipState.PARTNER,
          'Business relationship evolved to partnership'
        );
      }
      break;

    case RelationshipState.COMPETITOR:
      if (metrics.credibilityScore >= 6 && metrics.averageSentiment >= 0.6) {
        context.relationshipState = RelationshipState.BUSINESS;
        logStateChange(
          context,
          RelationshipState.COMPETITOR,
          RelationshipState.BUSINESS,
          'Improved business relationship'
        );
      } else if (metrics.averageSentiment < 0.2) {
        context.relationshipState = RelationshipState.ADVERSARY;
        logStateChange(
          context,
          RelationshipState.COMPETITOR,
          RelationshipState.ADVERSARY,
          'Hostile competitive relationship'
        );
      }
      break;
  }
  
  // Update database with retry logic
  await retryOperation(() => runtime.databaseAdapter.createMemory(
    createMemoryContent(context, runtime),
    'relationship_contexts',
    true
  ));
} 