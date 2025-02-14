import { type IAgentRuntime, type Memory, type Action, type UUID } from "@elizaos/core";
import {
  SystemState,
  EmotionalState,
  RelationshipState,
  ResponseMode,
  type RelationshipContext,
  type InteractionHistory
} from "../types";

interface EndActionResult {
  reason: 'DISENGAGEMENT' | 'LOW_CREDIBILITY' | 'USER_REQUEST' | 'SYSTEM_INITIATED';
  summary: {
    finalState: RelationshipState;
    credibilityScore: number;
    totalInteractions: number;
    duration: number; // in milliseconds
  };
  recommendations: string[];
}

export const endAction: Action = {
  name: 'END_INTERACTION',
  similes: ['TERMINATE_INTERACTION', 'CONCLUDE_SESSION', 'FINISH_CONVERSATION', 'END_ENGAGEMENT', 'FINISH_INTERACTION', 'COMPLETE_CYCLE', 'TERMINATE_ENGAGEMENT'],
  description: 'Handles the termination or modification of interaction sessions based on context',
  
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
      
      // Enhanced validation checks from end.ts
      if (!context) return false;
      if (context.currentState === SystemState.IDLE) return false;
      
      return context?.responseMode === ResponseMode.DISENGAGEMENT || 
             context?.emotionalState === EmotionalState.FRUSTRATED;
    } catch (error) {
      console.error('Error validating end action:', error);
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
    
    // Process end action
    const endResult = processEndAction(context);
    
    // Update context with end state
    await updateContext(runtime, userId, endResult, context);

    // Log the end of interaction for metrics
    await runtime.databaseAdapter.createMemory(
      {
        userId,
        agentId: runtime.agentId,
        roomId: userId,
        content: {
          text: JSON.stringify({
            action: 'END_INTERACTION',
            timestamp: new Date(),
            endResult
          }),
          action: 'METRICS',
          responseType: 'SYSTEM',
        }
      },
      'interaction_metrics'
    );

    return {
      success: true,
      endResult,
      message: "Interaction ended successfully"
    };
  },

  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "I need to go now, goodbye",
          relationshipState: RelationshipState.ACQUAINTANCE,
          responseMode: ResponseMode.DISENGAGEMENT
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "This isn't working out",
          relationshipState: RelationshipState.ADVERSARY,
          responseMode: ResponseMode.DISENGAGEMENT
        }
      }
    ]
  ]
};

function processEndAction(context: RelationshipContext): EndActionResult {
  // Determine end reason
  const reason = determineEndReason(context);
  
  // Generate summary
  const summary = generateSummary(context);
  
  // Generate recommendations
  const recommendations = generateRecommendations(context, reason);
  
  return {
    reason,
    summary,
    recommendations
  };
}

function determineEndReason(context: RelationshipContext): EndActionResult['reason'] {
  if (context.responseMode === ResponseMode.DISENGAGEMENT) {
    return 'DISENGAGEMENT';
  }
  
  if (context.credibilityScore < 3) {
    return 'LOW_CREDIBILITY';
  }
  
  // Check last interaction for user-initiated end
  const lastInteraction = context.interactionHistory[context.interactionHistory.length - 1];
  if (lastInteraction?.action === 'MESSAGE') {
    return 'USER_REQUEST';
  }
  
  return 'SYSTEM_INITIATED';
}

function generateSummary(context: RelationshipContext): EndActionResult['summary'] {
  const firstInteraction = context.interactionHistory[0];
  const lastInteraction = context.interactionHistory[context.interactionHistory.length - 1];
  
  return {
    finalState: context.relationshipState,
    credibilityScore: context.credibilityScore,
    totalInteractions: context.interactionHistory.length,
    duration: lastInteraction.timestamp.getTime() - firstInteraction.timestamp.getTime()
  };
}

function generateRecommendations(
  context: RelationshipContext,
  reason: EndActionResult['reason']
): string[] {
  const recommendations: string[] = [];
  
  // Add reason-based recommendations
  switch (reason) {
    case 'DISENGAGEMENT':
      recommendations.push('Consider re-engagement strategies for future interactions');
      recommendations.push('Review interaction patterns to identify disengagement triggers');
      break;
      
    case 'LOW_CREDIBILITY':
      recommendations.push('Implement stricter validation for future interactions');
      recommendations.push('Document credibility issues for system improvement');
      break;
      
    case 'USER_REQUEST':
      recommendations.push('Ensure proper closure of all active processes');
      recommendations.push('Save relevant context for future sessions');
      break;
      
    case 'SYSTEM_INITIATED':
      recommendations.push('Log system conditions that triggered the end');
      recommendations.push('Review decision criteria for potential optimization');
      break;
  }
  
  // Add state-based recommendations
  if (context.relationshipState === RelationshipState.ADVERSARY ||
      context.relationshipState === RelationshipState.ENEMY) {
    recommendations.push('Flag account for enhanced monitoring in future sessions');
    recommendations.push('Review security measures and access controls');
  }
  
  return recommendations;
}

async function updateContext(
  runtime: IAgentRuntime,
  userId: UUID,
  endResult: EndActionResult,
  context: RelationshipContext
): Promise<void> {
  const updatedContext = {
    ...context,
    currentState: SystemState.IDLE,
    responseMode: ResponseMode.INITIAL,
    lastInteraction: new Date(),
    interactionHistory: [
      ...context.interactionHistory,
      {
        timestamp: new Date(),
        action: 'END_INTERACTION',
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
        text: JSON.stringify({
          ...updatedContext,
          endResult
        }),
        action: 'STATE_UPDATE',
        responseType: 'ANALYZED',
        emotionalState: context.emotionalState
      }
    },
    'relationship_contexts',
    true
  );
} 