import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvaluationAction } from '../../src/actions/userEvaluation';
import { type IAgentRuntime, type Memory, type State, type IMemoryManager } from '@elizaos/core';
import { SystemState, RelationshipState, ResponseMode, EmotionalState } from '../../src/types';

describe('userEvaluation Action', () => {
  let mockRuntime: IAgentRuntime;
  let mockMessage: Memory;
  let mockState: State;
  let mockMessageManager: IMemoryManager;

  beforeEach(() => {
    mockState = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      agentId: '123e4567-e89b-12d3-a456-426614174001',
      roomId: '123e4567-e89b-12d3-a456-426614174002',
      bio: '',
      lore: '',
      messageDirections: '',
      postDirections: '',
      actors: '',
      recentMessages: '',
      recentMessagesData: [],
      userEvaluation: {
        sentiment: 'neutral',
        emotion: 'calm',
        intensity: 0.5
      }
    };

    mockMessageManager = {
      runtime: null as unknown as IAgentRuntime,
      tableName: 'messages',
      constructor: Function,
      createMemory: vi.fn().mockResolvedValue(undefined),
      getMemories: vi.fn().mockResolvedValue([{
        currentState: SystemState.USER_EVALUATION,
        relationshipState: RelationshipState.STRANGER,
        responseMode: ResponseMode.INITIAL,
        emotionalState: EmotionalState.HAPPY,
        credibilityScore: 5,
        lastInteraction: new Date(),
        interactionHistory: []
      }]),
      addEmbeddingToMemory: vi.fn().mockResolvedValue({}),
      getCachedEmbeddings: vi.fn().mockResolvedValue([]),
      getMemoryById: vi.fn().mockResolvedValue(null),
      getMemoriesByRoomIds: vi.fn().mockResolvedValue([]),
      searchMemoriesByEmbedding: vi.fn().mockResolvedValue([]),
      removeMemory: vi.fn().mockResolvedValue(undefined),
      removeAllMemories: vi.fn().mockResolvedValue(undefined),
      countMemories: vi.fn().mockResolvedValue(0)
    };

    mockRuntime = {
      agentId: '123e4567-e89b-12d3-a456-426614174001',
      messageManager: mockMessageManager,
      composeState: vi.fn().mockResolvedValue(mockState)
    } as unknown as IAgentRuntime;

    mockMessageManager.runtime = mockRuntime;

    mockMessage = {
      id: '123e4567-e89b-12d3-a456-426614174003',
      userId: '123e4567-e89b-12d3-a456-426614174000',
      agentId: '123e4567-e89b-12d3-a456-426614174001',
      roomId: '123e4567-e89b-12d3-a456-426614174002',
      content: {
        text: 'Test message',
        state: mockState
      }
    };
  });

  // Validation Tests
  it('should validate when in USER_EVALUATION state', async () => {
    const result = await userEvaluationAction.validate(mockRuntime, mockMessage);
    expect(result).toBe(true);
  });

  it('should not validate without userId', async () => {
    const { userId, ...messageWithoutUserId } = mockMessage;
    const result = await userEvaluationAction.validate(mockRuntime, messageWithoutUserId as Memory);
    expect(result).toBe(false);
  });

  it('should not validate in wrong state', async () => {
    mockRuntime.messageManager.getMemories = vi.fn().mockResolvedValue([{
      currentState: SystemState.IDLE
    }]);
    const result = await userEvaluationAction.validate(mockRuntime, mockMessage);
    expect(result).toBe(false);
  });

  it('should handle validation errors gracefully', async () => {
    mockRuntime.messageManager.getMemories = vi.fn().mockRejectedValue(new Error('Database error'));
    const result = await userEvaluationAction.validate(mockRuntime, mockMessage);
    expect(result).toBe(false);
  });

  // Handler Tests
  it('should successfully evaluate user message', async () => {
    mockMessage.content.text = 'I am feeling great today!';
    
    await userEvaluationAction.handler(mockRuntime, mockMessage);

    expect(mockRuntime.messageManager.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          relationshipState: expect.any(String),
          credibilityScore: expect.any(Number),
          responseMode: expect.any(String)
        })
      }),
      true
    );
  });

  it('should handle missing user data gracefully', async () => {
    mockRuntime.messageManager.getMemories = vi.fn().mockResolvedValue([]);

    await expect(userEvaluationAction.handler(mockRuntime, mockMessage))
      .rejects
      .toThrow('No relationship context found');
  });

  it('should update user evaluation state', async () => {
    const mockHistory = [
      {
        timestamp: new Date(),
        action: 'MESSAGE',
        emotionalState: EmotionalState.HAPPY,
        responseType: 'AUTOMATIC'
      }
    ];

    mockRuntime.messageManager.getMemories = vi.fn().mockResolvedValue([{
      currentState: SystemState.USER_EVALUATION,
      relationshipState: RelationshipState.STRANGER,
      responseMode: ResponseMode.INITIAL,
      emotionalState: EmotionalState.HAPPY,
      credibilityScore: 5,
      lastInteraction: new Date(),
      interactionHistory: mockHistory
    }]);

    await userEvaluationAction.handler(mockRuntime, mockMessage);

    expect(mockRuntime.messageManager.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          relationshipState: expect.any(String),
          credibilityScore: expect.any(Number),
          responseMode: expect.any(String)
        })
      }),
      true
    );
  });

  it('should handle API errors gracefully', async () => {
    mockRuntime.messageManager.getMemories = vi.fn().mockRejectedValue(new Error('Evaluation error'));

    await expect(userEvaluationAction.handler(mockRuntime, mockMessage))
      .rejects
      .toThrow('Failed to evaluate user');
  });

  it('should maintain data consistency', async () => {
    const initialState = { ...mockState };
    
    await userEvaluationAction.handler(mockRuntime, mockMessage);

    expect(mockRuntime.messageManager.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          previousState: initialState
        })
      }),
      true
    );
  });

  // Additional Edge Cases
  it('should handle empty message text', async () => {
    mockMessage.content.text = '';
    
    await userEvaluationAction.handler(mockRuntime, mockMessage);

    expect(mockRuntime.messageManager.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          relationshipState: expect.any(String),
          credibilityScore: expect.any(Number)
        })
      }),
      true
    );
  });

  it('should handle boundary credibility scores', async () => {
    mockRuntime.messageManager.getMemories = vi.fn().mockResolvedValue([{
      currentState: SystemState.USER_EVALUATION,
      relationshipState: RelationshipState.STRANGER,
      responseMode: ResponseMode.INITIAL,
      emotionalState: EmotionalState.HAPPY,
      credibilityScore: 10, // Maximum score
      lastInteraction: new Date(),
      interactionHistory: []
    }]);

    await userEvaluationAction.handler(mockRuntime, mockMessage);

    expect(mockRuntime.messageManager.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          credibilityScore: expect.any(Number)
        })
      }),
      true
    );
  });
}); 