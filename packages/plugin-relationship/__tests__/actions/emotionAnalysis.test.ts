import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  emotionAnalysisAction,
  determineDominantEmotion,
  calculateConfidence,
  calculateIntensity,
  extractEmotionalTriggers,
  estimateEmotionalDuration,
  getRelatedEmotionWords,
  calculateEmotionScore
} from '../../src/actions/emotionAnalysis';
import { EmotionalState, SystemState, RelationshipState, ResponseMode, type RelationshipContext } from '../../src/types';
import type { IAgentRuntime, Memory, UUID } from '@elizaos/core';

// Mock data
const mockUserId = '123e4567-e89b-12d3-a456-426614174000' as UUID;
const mockAgentId = '987fcdeb-51a2-43d7-9876-543210987000' as UUID;
const mockRoomId = mockUserId;

const mockContext: RelationshipContext = {
  userId: mockUserId,
  currentState: SystemState.EMOTION_ANALYSIS,
  emotionalState: EmotionalState.HAPPY,
  relationshipState: RelationshipState.ACQUAINTANCE,
  responseMode: ResponseMode.ONGOING,
  credibilityScore: 0.8,
  lastInteraction: new Date(),
  interactionHistory: []
};

const mockContextMemory: Memory = {
  id: '111e4567-e89b-12d3-a456-426614174000' as UUID,
  userId: mockUserId,
  agentId: mockAgentId,
  roomId: mockRoomId,
  createdAt: Date.now(),
  content: {
    text: JSON.stringify(mockContext),
    action: 'CONTEXT_UPDATE'
  }
};

const mockMemory: Memory = {
  id: '222e4567-e89b-12d3-a456-426614174000' as UUID,
  userId: mockUserId,
  agentId: mockAgentId,
  roomId: mockRoomId,
  createdAt: Date.now(),
  content: {
    text: "I'm feeling really happy about my promotion!",
    action: 'USER_MESSAGE'
  }
};

const mockAnalysisMemory: Memory = {
  id: '333e4567-e89b-12d3-a456-426614174000' as UUID,
  userId: mockUserId,
  agentId: mockAgentId,
  roomId: mockRoomId,
  createdAt: Date.now(),
  content: {
    text: 'Analysis result: The user appears happy and excited.',
    action: 'ANALYSIS_RESULT'
  }
};

const mockInvalidMemory: Memory = {
  id: '444e4567-e89b-12d3-a456-426614174000' as UUID,
  userId: mockUserId,
  agentId: mockAgentId,
  roomId: mockRoomId,
  createdAt: Date.now(),
  content: {
    text: '',
    action: 'INVALID'
  }
};

// Mock runtime
const mockMessageManager = {
  createMemory: vi.fn(),
  getMemories: vi.fn()
};

const mockDatabaseAdapter = {
  getMemories: vi.fn(),
  createMemory: vi.fn()
};

const mockRuntime = {
  agentId: mockAgentId,
  messageManager: mockMessageManager,
  databaseAdapter: mockDatabaseAdapter
} as unknown as IAgentRuntime;

describe('Emotion Analysis Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mock responses
    mockDatabaseAdapter.getMemories.mockResolvedValue([mockContextMemory]);
    mockMessageManager.createMemory.mockResolvedValue(undefined);
    mockMessageManager.getMemories.mockResolvedValue([mockAnalysisMemory]);
  });

  describe('validate', () => {
    it('should return false for messages without text content', async () => {
      const result = await emotionAnalysisAction.validate(mockRuntime, mockInvalidMemory);
      expect(result).toBe(false);
    });

    it('should return false when context is not in EMOTION_ANALYSIS state', async () => {
      const invalidContext = { ...mockContext, currentState: SystemState.IDLE };
      const invalidContextMemory = {
        ...mockContextMemory,
        content: { text: JSON.stringify(invalidContext), action: 'CONTEXT_UPDATE' }
      };
      mockDatabaseAdapter.getMemories.mockResolvedValueOnce([invalidContextMemory]);
      
      const result = await emotionAnalysisAction.validate(mockRuntime, mockMemory);
      expect(result).toBe(false);
    });

    it('should return true for valid message and context', async () => {
      const result = await emotionAnalysisAction.validate(mockRuntime, mockMemory);
      expect(result).toBe(true);
    });
  });

  describe('handler', () => {
    it('should analyze emotions and update context', async () => {
      const result = await emotionAnalysisAction.handler(mockRuntime, mockMemory);
      
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('emotionalState');
      expect(result).toHaveProperty('analysis');
      
      // Verify memory creation calls
      expect(mockMessageManager.createMemory).toHaveBeenCalledTimes(2);
      expect(mockMessageManager.getMemories).toHaveBeenCalledTimes(2);
      
      // Verify context update
      expect(mockDatabaseAdapter.createMemory).toHaveBeenCalledTimes(1);
    });

    it('should handle missing context gracefully', async () => {
      mockDatabaseAdapter.getMemories.mockResolvedValueOnce([]);
      
      await expect(emotionAnalysisAction.handler(mockRuntime, mockMemory))
        .rejects
        .toThrow();
    });
  });
});

describe('Emotion Analysis Helper Functions', () => {
  describe('determineDominantEmotion', () => {
    it('should identify happy as dominant emotion', () => {
      const analysis = "The user is very happy and excited about their promotion.";
      const contextAnalysis = "Previous state: neutral. Current: showing clear happiness.";
      
      const result = determineDominantEmotion(analysis, contextAnalysis);
      expect(result).toBe(EmotionalState.HAPPY);
    });

    it('should identify frustrated as dominant emotion', () => {
      const analysis = "The user is extremely frustrated with the technical issues.";
      const contextAnalysis = "Previous state: neutral. Current: showing frustration.";
      
      const result = determineDominantEmotion(analysis, contextAnalysis);
      expect(result).toBe(EmotionalState.FRUSTRATED);
    });
  });

  describe('calculateConfidence', () => {
    it('should return high confidence for clear dominant emotion', () => {
      const subEmotions = [
        { emotion: EmotionalState.HAPPY, score: 0.8 },
        { emotion: EmotionalState.SAD, score: 0.1 }
      ];
      
      const confidence = calculateConfidence(subEmotions);
      expect(confidence).toBeGreaterThan(0.7);
    });

    it('should return low confidence for mixed emotions', () => {
      const subEmotions = [
        { emotion: EmotionalState.HAPPY, score: 0.4 },
        { emotion: EmotionalState.SAD, score: 0.3 },
        { emotion: EmotionalState.ANGRY, score: 0.3 }
      ];
      
      const confidence = calculateConfidence(subEmotions);
      expect(confidence).toBeLessThan(0.5);
    });
  });

  describe('calculateIntensity', () => {
    it('should detect high intensity emotions', () => {
      const analysis = "I am extremely happy and absolutely delighted with the results!";
      const intensity = calculateIntensity(analysis);
      expect(intensity).toBeGreaterThan(0.7);
    });

    it('should detect low intensity emotions', () => {
      const analysis = "I am somewhat content with the outcome.";
      const intensity = calculateIntensity(analysis);
      expect(intensity).toBeLessThan(0.3);
    });
  });

  describe('extractEmotionalTriggers', () => {
    it('should identify triggers with common patterns', () => {
      const analysis = "User is happy because they got promoted. They're also excited due to the new opportunities.";
      const triggers = extractEmotionalTriggers(analysis);
      
      expect(triggers).toContain('they got promoted');
      expect(triggers).toContain('the new opportunities');
    });

    it('should handle text without triggers', () => {
      const analysis = "User appears to be in a neutral state.";
      const triggers = extractEmotionalTriggers(analysis);
      expect(triggers).toHaveLength(0);
    });
  });

  describe('estimateEmotionalDuration', () => {
    it('should estimate longer duration for deeper relationships', () => {
      const friendContext = { ...mockContext, relationshipState: RelationshipState.FRIEND };
      const strangerContext = { ...mockContext, relationshipState: RelationshipState.STRANGER };
      
      const friendDuration = estimateEmotionalDuration(EmotionalState.HAPPY, friendContext);
      const strangerDuration = estimateEmotionalDuration(EmotionalState.HAPPY, strangerContext);
      
      expect(friendDuration).toBeGreaterThan(strangerDuration);
    });

    it('should estimate appropriate durations for different emotions', () => {
      const sadDuration = estimateEmotionalDuration(EmotionalState.SAD, mockContext);
      const angryDuration = estimateEmotionalDuration(EmotionalState.ANGRY, mockContext);
      
      expect(sadDuration).toBeGreaterThan(angryDuration); // Sadness typically lasts longer than anger
    });
  });
}); 