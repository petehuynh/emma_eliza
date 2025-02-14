import { type IAgentRuntime, type Memory, type Action, type UUID } from "@elizaos/core";
import {
  SystemState,
  EmotionalState,
  RelationshipState,
  ResponseMode,
  type RelationshipContext,
  type InteractionHistory
} from "../types";

interface ResponseConfig {
  style: 'formal' | 'casual' | 'friendly' | 'professional';
  tone: 'neutral' | 'empathetic' | 'direct' | 'cautious';
  depth: 'surface' | 'moderate' | 'deep';
  engagement: 'minimal' | 'balanced' | 'proactive';
}

interface ResponseModeResult {
  mode: ResponseMode;
  config: ResponseConfig;
  nextState: SystemState;
  recommendations: string[];
}

// Add response mode error types
interface ResponseModeError extends Error {
  code: string;
  recoverable: boolean;
  context?: unknown;
}

class ResponseStateError extends Error implements ResponseModeError {
  code: string;
  recoverable: boolean;
  context?: unknown;

  constructor(message: string, code: string, recoverable = true, context?: unknown) {
    super(message);
    this.name = 'ResponseStateError';
    this.code = code;
    this.recoverable = recoverable;
    this.context = context;
  }
}

// Add validation utilities
function validateResponseConfig(config: ResponseConfig): void {
  const validStyles = ['formal', 'casual', 'friendly', 'professional'];
  const validTones = ['neutral', 'empathetic', 'direct', 'cautious'];
  const validDepths = ['surface', 'moderate', 'deep'];
  const validEngagements = ['minimal', 'balanced', 'proactive'];

  if (!validStyles.includes(config.style)) {
    throw new ResponseStateError(
      'Invalid response style',
      'INVALID_STYLE',
      false,
      { style: config.style, validStyles }
    );
  }

  if (!validTones.includes(config.tone)) {
    throw new ResponseStateError(
      'Invalid response tone',
      'INVALID_TONE',
      false,
      { tone: config.tone, validTones }
    );
  }

  if (!validDepths.includes(config.depth)) {
    throw new ResponseStateError(
      'Invalid response depth',
      'INVALID_DEPTH',
      false,
      { depth: config.depth, validDepths }
    );
  }

  if (!validEngagements.includes(config.engagement)) {
    throw new ResponseStateError(
      'Invalid engagement level',
      'INVALID_ENGAGEMENT',
      false,
      { engagement: config.engagement, validEngagements }
    );
  }
}

function validateStateTransition(
  currentState: SystemState,
  nextState: SystemState,
  context: RelationshipContext
): void {
  // Define valid state transitions
  const validTransitions: Record<SystemState, SystemState[]> = {
    [SystemState.IDLE]: [SystemState.EMOTION_ANALYSIS, SystemState.RESPONSE_MODE],
    [SystemState.EMOTION_ANALYSIS]: [SystemState.RESPONSE_MODE, SystemState.MONITORING],
    [SystemState.RESPONSE_MODE]: [SystemState.MONITORING, SystemState.IDLE],
    [SystemState.MONITORING]: [SystemState.EMOTION_ANALYSIS, SystemState.IDLE],
    [SystemState.USER_EVALUATION]: [SystemState.IDLE, SystemState.EMOTION_ANALYSIS]
  };

  if (!validTransitions[currentState]?.includes(nextState)) {
    throw new ResponseStateError(
      'Invalid state transition',
      'INVALID_TRANSITION',
      false,
      {
        currentState,
        nextState,
        validTransitions: validTransitions[currentState]
      }
    );
  }

  // Additional validation based on context
  if (nextState === SystemState.MONITORING && !context.emotionalState) {
    throw new ResponseStateError(
      'Cannot transition to monitoring without emotional state',
      'INVALID_CONTEXT',
      false
    );
  }
}

// Enhanced response mode action
export const responseModeAction: Action = {
  name: 'DETERMINE_RESPONSE',
  similes: ['SELECT_RESPONSE_MODE', 'CONFIGURE_RESPONSE', 'SET_INTERACTION_MODE'],
  description: 'Determines the appropriate response mode and configuration based on relationship context',
  
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
      
      if (!context) {
        throw new ResponseStateError(
          'No relationship context found',
          'MISSING_CONTEXT',
          false
        );
      }

      if (!context.emotionalState) {
        throw new ResponseStateError(
          'Missing emotional state in context',
          'INVALID_CONTEXT',
          false
        );
      }

      return context.currentState === SystemState.RESPONSE_MODE;
    } catch (error) {
      console.error('Error validating response mode:', error);
      return false;
    }
  },

  handler: async (runtime: IAgentRuntime, message: Memory) => {
    try {
      const contexts = await runtime.databaseAdapter.getMemories({
        roomId: message.roomId,
        tableName: 'relationship_contexts',
        agentId: runtime.agentId,
        count: 1
      });

      const context = contexts[0] as unknown as RelationshipContext;
      
      if (!context) {
        throw new ResponseStateError(
          'Context not found',
          'MISSING_CONTEXT',
          false
        );
      }

      // Determine response mode with validation
      const responseModeResult = determineResponseMode(context);
      validateResponseConfig(responseModeResult.config);
      validateStateTransition(
        context.currentState,
        responseModeResult.nextState,
        context
      );

      // Update context with new response mode
      await updateContext(runtime, message.userId, responseModeResult, context);

      return {
        success: true,
        mode: responseModeResult.mode,
        config: responseModeResult.config,
        recommendations: responseModeResult.recommendations
      };
    } catch (error) {
      if (error instanceof ResponseStateError) {
        throw error;
      }

      throw new ResponseStateError(
        'Failed to determine response mode',
        'HANDLER_FAILED',
        true,
        { originalError: error }
      );
    }
  },

  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Can you help me with this task?",
          relationshipState: RelationshipState.ACQUAINTANCE,
          responseMode: ResponseMode.ONGOING
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "I haven't been here in a while",
          relationshipState: RelationshipState.STRANGER,
          responseMode: ResponseMode.INITIAL
        }
      }
    ]
  ]
};

function determineResponseMode(context: RelationshipContext): ResponseModeResult {
  const { relationshipState, emotionalState, credibilityScore } = context;
  
  // Determine base configuration based on relationship state
  const baseConfig = getBaseConfig(relationshipState);
  
  // Adjust configuration based on emotional state
  const adjustedConfig = adjustConfigForEmotion(baseConfig, emotionalState);
  
  // Determine next system state
  const nextState = determineNextState(context);
  
  // Generate recommendations
  const recommendations = generateRecommendations(context, adjustedConfig);
  
  return {
    mode: context.responseMode,
    config: adjustedConfig,
    nextState,
    recommendations
  };
}

function getBaseConfig(relationshipState: RelationshipState): ResponseConfig {
  const configs: Record<RelationshipState, ResponseConfig> = {
    [RelationshipState.STRANGER]: {
      style: 'formal',
      tone: 'neutral',
      depth: 'surface',
      engagement: 'minimal'
    },
    [RelationshipState.ACQUAINTANCE]: {
      style: 'professional',
      tone: 'direct',
      depth: 'moderate',
      engagement: 'balanced'
    },
    [RelationshipState.FRIEND]: {
      style: 'casual',
      tone: 'empathetic',
      depth: 'deep',
      engagement: 'proactive'
    },
    [RelationshipState.FAMILY]: {
      style: 'casual',
      tone: 'empathetic',
      depth: 'deep',
      engagement: 'proactive'
    },
    [RelationshipState.BUSINESS]: {
      style: 'professional',
      tone: 'direct',
      depth: 'moderate',
      engagement: 'balanced'
    },
    [RelationshipState.COMPETITOR]: {
      style: 'formal',
      tone: 'cautious',
      depth: 'surface',
      engagement: 'minimal'
    },
    [RelationshipState.PARTNER]: {
      style: 'friendly',
      tone: 'empathetic',
      depth: 'deep',
      engagement: 'proactive'
    },
    [RelationshipState.ADVERSARY]: {
      style: 'formal',
      tone: 'cautious',
      depth: 'surface',
      engagement: 'minimal'
    },
    [RelationshipState.ENEMY]: {
      style: 'formal',
      tone: 'cautious',
      depth: 'surface',
      engagement: 'minimal'
    },
    [RelationshipState.UNKNOWN]: {
      style: 'formal',
      tone: 'neutral',
      depth: 'surface',
      engagement: 'minimal'
    }
  };

  return configs[relationshipState] || configs[RelationshipState.STRANGER];
}

function adjustConfigForEmotion(
  config: ResponseConfig,
  emotionalState: EmotionalState
): ResponseConfig {
  const adjustments: Record<EmotionalState, Partial<ResponseConfig>> = {
    [EmotionalState.HAPPY]: {
      tone: 'empathetic',
      engagement: 'proactive'
    },
    [EmotionalState.SAD]: {
      tone: 'empathetic',
      depth: 'deep'
    },
    [EmotionalState.ANGRY]: {
      tone: 'cautious',
      engagement: 'minimal'
    },
    [EmotionalState.FRUSTRATED]: {
      tone: 'direct',
      depth: 'moderate'
    }
  };

  return {
    ...config,
    ...adjustments[emotionalState]
  };
}

function determineNextState(context: RelationshipContext): SystemState {
  const { responseMode, credibilityScore } = context;
  
  // For disengagement, move to end state
  if (responseMode === ResponseMode.DISENGAGEMENT) {
    return SystemState.IDLE;
  }
  
  // For low credibility, require monitoring
  if (credibilityScore < 5) {
    return SystemState.MONITORING;
  }
  
  // Default flow
  return SystemState.EMOTION_ANALYSIS;
}

function generateRecommendations(
  context: RelationshipContext,
  config: ResponseConfig
): string[] {
  const recommendations: string[] = [];
  
  // Add style-based recommendations
  if (config.style === 'formal') {
    recommendations.push('Maintain professional language and structure');
  } else if (config.style === 'casual') {
    recommendations.push('Use conversational tone and friendly expressions');
  }
  
  // Add tone-based recommendations
  if (config.tone === 'empathetic') {
    recommendations.push('Acknowledge and validate user emotions');
  } else if (config.tone === 'cautious') {
    recommendations.push('Keep responses factual and maintain boundaries');
  }
  
  // Add engagement-based recommendations
  if (config.engagement === 'proactive') {
    recommendations.push('Offer additional insights and suggestions');
  } else if (config.engagement === 'minimal') {
    recommendations.push('Focus on direct responses to queries only');
  }
  
  return recommendations;
}

// Enhanced context update function
async function updateContext(
  runtime: IAgentRuntime,
  userId: UUID,
  responseModeResult: ResponseModeResult,
  context: RelationshipContext
): Promise<void> {
  try {
    const updatedContext = {
      ...context,
      currentState: responseModeResult.nextState,
      responseMode: responseModeResult.mode,
      lastInteraction: new Date(),
      interactionHistory: [
        ...context.interactionHistory,
        {
          timestamp: new Date(),
          action: 'RESPONSE_MODE_UPDATE',
          responseType: 'CONFIGURED',
          config: responseModeResult.config
        }
      ]
    };

    await runtime.databaseAdapter.createMemory(
      {
        userId,
        agentId: runtime.agentId,
        roomId: context.userId as UUID,
        content: {
          text: JSON.stringify(updatedContext),
          action: 'STATE_UPDATE'
        }
      },
      'relationship_contexts',
      true
    );
  } catch (error) {
    throw new ResponseStateError(
      'Failed to update context',
      'UPDATE_FAILED',
      true,
      { originalError: error }
    );
  }
}
