import { type IAgentRuntime, type Memory, type Action, type UUID } from "@elizaos/core";
import { EmotionalState, SystemState, type RelationshipContext, RelationshipState } from "../types";

interface EmotionAnalysisResult {
  dominantEmotion: EmotionalState;
  confidence: number;
  subEmotions: Array<{
    emotion: EmotionalState;
    score: number;
  }>;
  context: {
    triggers: string[];
    intensity: number;
    duration: number;
  };
}

// Add utility types for error handling
interface AnalysisError extends Error {
  code: string;
  retryable: boolean;
  context?: unknown;
}

class EmotionAnalysisError extends Error implements AnalysisError {
  code: string;
  retryable: boolean;
  context?: unknown;

  constructor(message: string, code: string, retryable = true, context?: unknown) {
    super(message);
    this.name = 'EmotionAnalysisError';
    this.code = code;
    this.retryable = retryable;
    this.context = context;
  }
}

// Add retry utility
async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    retries?: number;
    timeout?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const { retries = 2, timeout = 5000, onRetry } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof EmotionAnalysisError && !error.retryable) {
        throw error;
      }
      
      if (attempt === retries) {
        throw error;
      }

      if (onRetry) {
        onRetry(error as Error, attempt);
      }

      await new Promise(resolve => setTimeout(resolve, timeout));
    }
  }

  throw new EmotionAnalysisError(
    'Operation failed after retries',
    'RETRY_EXHAUSTED',
    false
  );
}

// Enhanced validation function
function validateAnalysisInput(
  text: string,
  context: RelationshipContext
): void {
  if (!text?.trim()) {
    throw new EmotionAnalysisError(
      'Empty or invalid text input',
      'INVALID_INPUT',
      false
    );
  }

  if (!context?.userId) {
    throw new EmotionAnalysisError(
      'Missing user ID in context',
      'INVALID_CONTEXT',
      false
    );
  }

  if (!context?.emotionalState) {
    throw new EmotionAnalysisError(
      'Missing emotional state in context',
      'INVALID_CONTEXT',
      false
    );
  }

  if (!Object.values(EmotionalState).includes(context.emotionalState)) {
    throw new EmotionAnalysisError(
      'Invalid emotional state in context',
      'INVALID_EMOTIONAL_STATE',
      false
    );
  }
}

export const emotionAnalysisAction: Action = {
  name: 'ANALYZE_EMOTION',
  similes: ['CHECK_EMOTION', 'ASSESS_SENTIMENT', 'ANALYZE_MOOD'],
  description: 'Analyzes the emotional content and context of user messages to determine emotional state',
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    if (!message?.content?.text) {
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
      return context?.currentState === SystemState.EMOTION_ANALYSIS;
    } catch (error) {
      console.error('Error validating emotion analysis:', error);
      return false;
    }
  },

  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text;
    const userId = message.userId;

    // Get relationship context
    const contexts = await runtime.databaseAdapter.getMemories({
      roomId: message.roomId,
      tableName: 'relationship_contexts',
      agentId: runtime.agentId,
      count: 1
    });
    
    const context = contexts[0] as unknown as RelationshipContext;
    
    // Perform multi-layered emotion analysis
    const emotionResult = await analyzeEmotion(runtime, text, context);
    
    // Update relationship context with new emotional state
    await updateEmotionalState(runtime, userId, emotionResult, context);

    return {
      success: true,
      emotionalState: emotionResult.dominantEmotion,
      analysis: emotionResult
    };
  },

  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "This isn't working and I'm getting really annoyed!",
          emotionalState: EmotionalState.FRUSTRATED
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "I just got promoted at work! I'm so happy!",
          emotionalState: EmotionalState.HAPPY
        }
      }
    ]
  ]
};

// Enhanced emotion analysis function
async function analyzeEmotion(
  runtime: IAgentRuntime,
  text: string,
  context: RelationshipContext
): Promise<EmotionAnalysisResult> {
  try {
    // Validate input
    validateAnalysisInput(text, context);

    // Create memories with retry
    const [sentimentMemory, contextMemory] = await Promise.all([
      withRetry(
        () => runtime.messageManager.createMemory({
          userId: context.userId as UUID,
          agentId: runtime.agentId,
          roomId: context.userId as UUID,
          content: {
            text: `Analyze the emotional content of this text and classify it into one of these emotions: ${Object.values(EmotionalState).join(', ')}. Also identify any emotional triggers and intensity. Text: "${text}"`,
            action: 'ANALYZE_SENTIMENT'
          }
        }),
        {
          retries: 3,
          timeout: 2000,
          onRetry: (error, attempt) => {
            console.warn(`Retry attempt ${attempt} for sentiment analysis:`, error);
          }
        }
      ),
      withRetry(
        () => runtime.messageManager.createMemory({
          userId: context.userId as UUID,
          agentId: runtime.agentId,
          roomId: context.userId as UUID,
          content: {
            text: `Given the user's relationship state (${context.relationshipState}) and previous emotional state (${context.emotionalState}), analyze if there's been an emotional shift in: "${text}"`,
            action: 'ANALYZE_CONTEXT'
          }
        }),
        {
          retries: 3,
          timeout: 2000,
          onRetry: (error, attempt) => {
            console.warn(`Retry attempt ${attempt} for context analysis:`, error);
          }
        }
      )
    ]);

    // Get analysis results with enhanced error handling
    const { sentimentAnalysis, contextAnalysis } = await withRetry(
      async () => {
        const [sentimentResult, contextResult] = await Promise.all([
          runtime.messageManager.getMemories({
            roomId: context.userId as UUID,
            count: 1
          }),
          runtime.messageManager.getMemories({
            roomId: context.userId as UUID,
            count: 1
          })
        ]);

        if (!sentimentResult?.[0] || !contextResult?.[0]) {
          throw new EmotionAnalysisError(
            'Failed to retrieve analysis results',
            'MISSING_ANALYSIS',
            true
          );
        }

        return {
          sentimentAnalysis: sentimentResult,
          contextAnalysis: contextResult
        };
      },
      {
        retries: 3,
        timeout: 3000,
        onRetry: (error, attempt) => {
          console.warn(`Retry attempt ${attempt} for getting analysis results:`, error);
        }
      }
    );

    // Process results with validation
    const dominantEmotion = determineDominantEmotion(
      sentimentAnalysis[0]?.content.text || '',
      contextAnalysis[0]?.content.text || ''
    );

    if (!dominantEmotion || !Object.values(EmotionalState).includes(dominantEmotion)) {
      throw new EmotionAnalysisError(
        'Invalid dominant emotion detected',
        'INVALID_EMOTION',
        false,
        { dominantEmotion }
      );
    }

    const subEmotions = analyzeSubEmotions(sentimentAnalysis[0]?.content.text || '');
    const triggers = extractEmotionalTriggers(sentimentAnalysis[0]?.content.text || '');
    const intensity = calculateIntensity(sentimentAnalysis[0]?.content.text || '');
    const duration = estimateEmotionalDuration(dominantEmotion, context);
    const confidence = calculateConfidence(subEmotions);

    // Validate results
    if (confidence < 0 || confidence > 1) {
      throw new EmotionAnalysisError(
        'Invalid confidence score',
        'INVALID_CONFIDENCE',
        false,
        { confidence }
      );
    }

    if (intensity < 0 || intensity > 10) {
      throw new EmotionAnalysisError(
        'Invalid intensity value',
        'INVALID_INTENSITY',
        false,
        { intensity }
      );
    }

    return {
      dominantEmotion,
      confidence,
      subEmotions,
      context: {
        triggers,
        intensity,
        duration
      }
    };

  } catch (error) {
    if (error instanceof EmotionAnalysisError) {
      throw error;
    }

    throw new EmotionAnalysisError(
      'Failed to analyze emotion',
      'ANALYSIS_FAILED',
      true,
      { originalError: error }
    );
  }
}

async function updateEmotionalState(
  runtime: IAgentRuntime,
  userId: UUID,
  emotionResult: EmotionAnalysisResult,
  context: RelationshipContext
): Promise<void> {
  // Only update if confidence is high enough or emotion is significantly different
  if (emotionResult.confidence > 0.7 || 
      (emotionResult.dominantEmotion !== context.emotionalState && emotionResult.confidence > 0.5)) {
    
    const updatedContext = {
      ...context,
      emotionalState: emotionResult.dominantEmotion,
      currentState: SystemState.USER_EVALUATION, // Move to next state
      interactionHistory: [
        ...context.interactionHistory,
        {
          timestamp: new Date(),
          action: 'EMOTION_UPDATE',
          emotionalState: emotionResult.dominantEmotion,
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
          action: 'UPDATE_CONTEXT',
          source: 'emotion_analysis'
        }
      },
      'relationship_contexts',
      true
    );
  }
}

// Helper functions for emotion analysis
export function determineDominantEmotion(sentimentAnalysis: string, contextAnalysis: string): EmotionalState {
  // Count references to each emotion in both analyses
  const emotionCounts = Object.values(EmotionalState).reduce((acc, emotion) => {
    acc[emotion] = countEmotionReferences(emotion, sentimentAnalysis, contextAnalysis);
    return acc;
  }, {} as Record<EmotionalState, number>);

  // Find emotion with highest count
  return Object.entries(emotionCounts).reduce((dominant, [emotion, count]) => {
    return count > emotionCounts[dominant] ? emotion as EmotionalState : dominant;
  }, EmotionalState.HAPPY);
}

export function analyzeSubEmotions(analysis: string): Array<{ emotion: EmotionalState; score: number }> {
  return Object.values(EmotionalState).map(emotion => ({
    emotion,
    score: calculateEmotionScore(emotion, analysis)
  })).sort((a, b) => b.score - a.score);
}

export function extractEmotionalTriggers(analysis: string): string[] {
  const triggers: string[] = [];
  const triggerPatterns = [
    /(?:triggered by|caused by|due to|because of)\s+([^,.!?]+)/gi,
    /(?:response to|reacting to)\s+([^,.!?]+)/gi,
    /(?:when|after|during)\s+([^,.!?]+)/gi
  ];

  triggerPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(analysis)) !== null) {
      if (match[1]) {
        triggers.push(match[1].trim());
      }
    }
  });

  return [...new Set(triggers)]; // Remove duplicates
}

export function calculateConfidence(subEmotions: Array<{ emotion: EmotionalState; score: number }>): number {
  if (!subEmotions.length) return 0;

  // If top emotion is significantly stronger than others, confidence is higher
  const topScore = subEmotions[0].score;
  const secondScore = subEmotions[1]?.score ?? 0;
  const scoreDiff = topScore - secondScore;

  // Base confidence on score difference and absolute value of top score
  return Math.min(0.3 + (scoreDiff * 0.4) + (topScore * 0.3), 1);
}

export function calculateIntensity(analysis: string): number {
  let intensity = 0;

  // Check for intensity indicators
  const intensifiers = [
    { pattern: /\b(very|extremely|highly|intensely)\b/gi, weight: 0.2 },
    { pattern: /[!?]{2,}/g, weight: 0.15 },
    { pattern: /\b(CAPS|ALL CAPS)\b/g, weight: 0.25 },
    { pattern: /\b(urgent|immediate|critical)\b/gi, weight: 0.3 }
  ];

  intensifiers.forEach(({ pattern, weight }) => {
    const matches = (analysis.match(pattern) || []).length;
    intensity += matches * weight;
  });

  // Normalize to 0-1 range
  return Math.min(Math.max(intensity, 0), 1);
}

export function estimateEmotionalDuration(emotion: EmotionalState, context: RelationshipContext): number {
  // Base duration in milliseconds
  const baseDurations: Record<EmotionalState, number> = {
    [EmotionalState.HAPPY]: 3600000, // 1 hour
    [EmotionalState.SAD]: 7200000, // 2 hours
    [EmotionalState.ANGRY]: 1800000, // 30 minutes
    [EmotionalState.FRUSTRATED]: 3600000 // 1 hour
  };

  // Adjust based on relationship state
  const multiplier = getRelationshipMultiplier(context.relationshipState);
  
  return baseDurations[emotion] * multiplier;
}

export function countEmotionReferences(emotion: EmotionalState, ...texts: string[]): number {
  const emotionWords = getRelatedEmotionWords(emotion);
  const pattern = new RegExp(`\\b(${emotionWords.join('|')})\\b`, 'gi');
  
  return texts.reduce((count, text) => {
    const matches = text.match(pattern);
    return count + (matches ? matches.length : 0);
  }, 0);
}

export function calculateEmotionScore(emotion: EmotionalState, text: string): number {
  const references = countEmotionReferences(emotion, text);
  // Normalize score between 0 and 1
  return Math.min(references / 5, 1);
}

export function getRelatedEmotionWords(emotion: EmotionalState): string[] {
  const emotionWords: Record<EmotionalState, string[]> = {
    [EmotionalState.HAPPY]: ['happy', 'joy', 'excited', 'pleased', 'delighted', 'content'],
    [EmotionalState.SAD]: ['sad', 'unhappy', 'depressed', 'down', 'gloomy', 'miserable'],
    [EmotionalState.ANGRY]: ['angry', 'mad', 'furious', 'outraged', 'irritated', 'annoyed'],
    [EmotionalState.FRUSTRATED]: ['frustrated', 'stuck', 'blocked', 'helpless', 'powerless']
  };
  
  return emotionWords[emotion] || [];
}

export function getRelationshipMultiplier(relationshipState: RelationshipState): number {
  const multipliers: Record<RelationshipState, number> = {
    [RelationshipState.STRANGER]: 0.8,
    [RelationshipState.ACQUAINTANCE]: 1.0,
    [RelationshipState.FRIEND]: 1.2,
    [RelationshipState.FAMILY]: 1.5,
    [RelationshipState.BUSINESS]: 0.9,
    [RelationshipState.COMPETITOR]: 0.7,
    [RelationshipState.PARTNER]: 1.3,
    [RelationshipState.ADVERSARY]: 0.6,
    [RelationshipState.ENEMY]: 0.5,
    [RelationshipState.UNKNOWN]: 0.8
  };
  
  return multipliers[relationshipState] || 1.0;
}