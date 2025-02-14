import { describe, it, expect, vi } from 'vitest';
import {
  updateDetailedRelationshipStateEnhanced,
  calculateDetailedMetrics,
  type DetailedMetrics,
  type StateChange
} from '../../src/providers/detailedTransitionEnhanced';
import { 
  RelationshipState,
  EmotionalState,
  SystemState,
  ResponseMode,
  type RelationshipContext,
  type RelationshipMetrics
} from '../../src/types';
import type { IAgentRuntime } from '@elizaos/core';
import type { UUID } from '@elizaos/core';

// Helper to create a mock runtime with a mocked database adapter
const createMockRuntime = (): IAgentRuntime => {
  return {
    databaseAdapter: {
      createMemory: vi.fn().mockResolvedValue(true),
      get: vi.fn(),
      delete: vi.fn(),
      query: vi.fn()
    }
  } as unknown as IAgentRuntime;
};

// Helper to create a base context for testing
const createTestContext = (
  state: RelationshipState = RelationshipState.STRANGER
): RelationshipContext => ({
  userId: 'test-user-1234-5678-9012-3456' as UUID,
  currentState: SystemState.IDLE,
  emotionalState: EmotionalState.HAPPY,
  relationshipState: state,
  responseMode: ResponseMode.INITIAL,
  credibilityScore: 5,
  lastInteraction: new Date(),
  interactionHistory: []
});

describe('updateDetailedRelationshipStateEnhanced', () => {
  it('should throw error for invalid inputs', async () => {
    const runtime = createMockRuntime();
    const invalidContext = null as unknown as RelationshipContext;
    const metrics: RelationshipMetrics = {
      credibilityScore: -1,
      interactionFrequency: 5,
      averageSentiment: 0.6
    };

    await expect(updateDetailedRelationshipStateEnhanced(runtime, invalidContext, metrics))
      .rejects.toThrow('Invalid input: context and metrics are required');
  });

  it('should throw error for invalid credibility score', async () => {
    const runtime = createMockRuntime();
    const context = createTestContext();
    const metrics: RelationshipMetrics = {
      credibilityScore: 11, // Invalid: > 10
      interactionFrequency: 5,
      averageSentiment: 0.6
    };

    await expect(updateDetailedRelationshipStateEnhanced(runtime, context, metrics))
      .rejects.toThrow('Invalid credibility score: must be between 0 and 10');
  });

  it('should force ADVERSARY when credibility is too low', async () => {
    const runtime = createMockRuntime();
    const context = createTestContext();
    const metrics: RelationshipMetrics = {
      credibilityScore: 1.5,
      interactionFrequency: 10,
      averageSentiment: 0.8
    };

    await updateDetailedRelationshipStateEnhanced(runtime, context, metrics);
    
    expect(context.relationshipState).toBe(RelationshipState.ADVERSARY);
    const log = (context as any).stateChangeLog as StateChange[];
    expect(log).toBeDefined();
    expect(log[0].previousState).toBe(RelationshipState.STRANGER);
    expect(log[0].newState).toBe(RelationshipState.ADVERSARY);
    expect(log[0].reason).toContain('Credibility score too low');
    expect(runtime.databaseAdapter.createMemory).toHaveBeenCalledWith(
      { id: 'test-user-1234-5678-9012-3456', content: context },
      'relationship_contexts',
      true
    );
  });

  it('should transition from STRANGER to ACQUAINTANCE when thresholds are met', async () => {
    const runtime = createMockRuntime();
    const context = createTestContext();
    const metrics: RelationshipMetrics = {
      credibilityScore: 5,
      interactionFrequency: 6,
      averageSentiment: 0.6
    };

    await updateDetailedRelationshipStateEnhanced(runtime, context, metrics);
    
    expect(context.relationshipState).toBe(RelationshipState.ACQUAINTANCE);
    const log = (context as any).stateChangeLog as StateChange[];
    expect(log[0].previousState).toBe(RelationshipState.STRANGER);
    expect(log[0].newState).toBe(RelationshipState.ACQUAINTANCE);
    expect(log[0].reason).toContain('Sufficient interactions and positive sentiment');
  });

  it('should transition from ACQUAINTANCE to FRIEND with high metrics', async () => {
    const runtime = createMockRuntime();
    const context = createTestContext(RelationshipState.ACQUAINTANCE);
    const metrics: RelationshipMetrics = {
      credibilityScore: 9,
      interactionFrequency: 10,
      averageSentiment: 0.7
    };

    await updateDetailedRelationshipStateEnhanced(runtime, context, metrics);
    
    expect(context.relationshipState).toBe(RelationshipState.FRIEND);
    const log = (context as any).stateChangeLog as StateChange[];
    expect(log[0].previousState).toBe(RelationshipState.ACQUAINTANCE);
    expect(log[0].newState).toBe(RelationshipState.FRIEND);
    expect(log[0].reason).toContain('High credibility and strongly positive sentiment');
  });

  it('should downgrade from FRIEND to ACQUAINTANCE on low sentiment', async () => {
    const runtime = createMockRuntime();
    const context = createTestContext(RelationshipState.FRIEND);
    const metrics: RelationshipMetrics = {
      credibilityScore: 7,
      interactionFrequency: 15,
      averageSentiment: 0.3
    };

    await updateDetailedRelationshipStateEnhanced(runtime, context, metrics);
    
    expect(context.relationshipState).toBe(RelationshipState.ACQUAINTANCE);
    const log = (context as any).stateChangeLog as StateChange[];
    expect(log[0].previousState).toBe(RelationshipState.FRIEND);
    expect(log[0].newState).toBe(RelationshipState.ACQUAINTANCE);
    expect(log[0].reason).toContain('Sentiment dropped significantly');
  });

  it('should retry database update if it fails initially', async () => {
    const runtime = createMockRuntime();
    const createMemoryMock = vi.fn()
      .mockRejectedValueOnce(new Error('Database error'))
      .mockRejectedValueOnce(new Error('Database error'))
      .mockResolvedValue(true);
    runtime.databaseAdapter.createMemory = createMemoryMock;
    
    const context = createTestContext();
    const metrics: RelationshipMetrics = {
      credibilityScore: 5,
      interactionFrequency: 3,
      averageSentiment: 0.5
    };

    await updateDetailedRelationshipStateEnhanced(runtime, context, metrics);
    expect(createMemoryMock).toHaveBeenCalledTimes(3);
    expect(context.relationshipState).toBe(RelationshipState.STRANGER);
  });
});

describe('calculateDetailedMetrics', () => {
  it('should return enhanced metrics with additional fields', async () => {
    const runtime = createMockRuntime();
    const context = createTestContext();
    context.interactionHistory = [
      {
        timestamp: new Date(),
        action: 'MESSAGE',
        emotionalState: EmotionalState.HAPPY,
        responseType: 'ANALYZED'
      }
    ];

    const detailedMetrics = await calculateDetailedMetrics(runtime, context);
    
    expect(detailedMetrics).toHaveProperty('recentTrend');
    expect(detailedMetrics).toHaveProperty('confidenceScore');
    expect(detailedMetrics).toHaveProperty('lastStateChange');
    expect(typeof detailedMetrics.confidenceScore).toBe('number');
    expect(detailedMetrics.confidenceScore).toBeLessThanOrEqual(1);
    expect(detailedMetrics.confidenceScore).toBeGreaterThanOrEqual(0);
  });

  it('should calculate trend correctly based on interaction history', async () => {
    const runtime = createMockRuntime();
    const context = createTestContext();
    context.interactionHistory = [
      {
        timestamp: new Date(),
        action: 'MESSAGE',
        emotionalState: EmotionalState.HAPPY,
        responseType: 'ANALYZED'
      },
      {
        timestamp: new Date(),
        action: 'MESSAGE',
        emotionalState: EmotionalState.HAPPY,
        responseType: 'ANALYZED'
      },
      {
        timestamp: new Date(),
        action: 'MESSAGE',
        emotionalState: EmotionalState.HAPPY,
        responseType: 'ANALYZED'
      }
    ];

    const detailedMetrics = await calculateDetailedMetrics(runtime, context);
    expect(detailedMetrics.recentTrend).toBe('improving');
  });
}); 