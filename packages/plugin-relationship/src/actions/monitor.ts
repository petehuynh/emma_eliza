import { type IAgentRuntime, type Memory, type Action, type UUID } from "@elizaos/core";
import {
  SystemState,
  EmotionalState,
  RelationshipState,
  ResponseMode,
  type RelationshipContext,
  type InteractionHistory,
  type ActionType,
  type ResponseType
} from "../types";

interface MonitoringState {
  isActive: boolean;
  lastUpdate: Date;
  userId: UUID;
  roomId: UUID;
  updateInterval: number; // in milliseconds
  retryAttempts: number;
  maxRetries: number;
}

const DEFAULT_UPDATE_INTERVAL = 5000; // 5 seconds
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second

// Add monitoring error types
interface MonitoringError extends Error {
  code: string;
  recoverable: boolean;
  context?: unknown;
}

class MonitorStateError extends Error implements MonitoringError {
  code: string;
  recoverable: boolean;
  context?: unknown;

  constructor(message: string, code: string, recoverable = true, context?: unknown) {
    super(message);
    this.name = 'MonitorStateError';
    this.code = code;
    this.recoverable = recoverable;
    this.context = context;
  }
}

// Add state recovery utilities
interface StateRecoveryOptions {
  maxAttempts: number;
  backoffMs: number;
  maxBackoffMs: number;
}

const DEFAULT_RECOVERY_OPTIONS: StateRecoveryOptions = {
  maxAttempts: 3,
  backoffMs: 1000,
  maxBackoffMs: 5000
};

async function attemptStateRecovery(
  runtime: IAgentRuntime,
  monitoringState: MonitoringState,
  options: Partial<StateRecoveryOptions> = {}
): Promise<boolean> {
  const recoveryOptions = { ...DEFAULT_RECOVERY_OPTIONS, ...options };
  let currentBackoff = recoveryOptions.backoffMs;

  for (let attempt = 1; attempt <= recoveryOptions.maxAttempts; attempt++) {
    try {
      await updateMonitoringState(runtime, monitoringState);
      console.log(`State recovery successful on attempt ${attempt}`);
      return true;
    } catch (error) {
      if (error instanceof MonitorStateError && !error.recoverable) {
        console.error('Unrecoverable monitoring state error:', error);
        return false;
      }

      console.warn(`Recovery attempt ${attempt} failed:`, error);
      
      if (attempt === recoveryOptions.maxAttempts) {
        console.error('State recovery failed after max attempts');
        return false;
      }

      await new Promise(resolve => setTimeout(resolve, currentBackoff));
      currentBackoff = Math.min(currentBackoff * 2, recoveryOptions.maxBackoffMs);
    }
  }

  return false;
}

// Enhanced monitoring action
export const monitorAction: Action = {
  name: "MONITOR_SOCIAL",
  similes: ["TRACK_RELATIONSHIP", "OBSERVE_INTERACTIONS", "WATCH_SOCIAL"],
  description: "Sets up real-time monitoring of relationship states and updates",

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    try {
      const contexts = await runtime.databaseAdapter.getMemories({
        roomId: message.roomId,
        tableName: "relationship_contexts",
        agentId: runtime.agentId,
        count: 1
      });

      const context = contexts[0] as unknown as RelationshipContext;

      if (!context) {
        throw new MonitorStateError(
          'No relationship context found for monitoring',
          'MISSING_CONTEXT',
          false
        );
      }

      if (context.currentState === SystemState.MONITORING) {
        console.log("Already in monitoring state");
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error validating monitor action:", error);
      return false;
    }
  },

  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const monitoringState: MonitoringState = {
      isActive: true,
      lastUpdate: new Date(),
      userId: message.userId,
      roomId: message.roomId,
      updateInterval: DEFAULT_UPDATE_INTERVAL,
      retryAttempts: 0,
      maxRetries: MAX_RETRY_ATTEMPTS
    };

    try {
      // Initialize monitoring with recovery options
      await initializeMonitoring(runtime, message, monitoringState);

      // Enhanced monitoring loop with state recovery
      const monitoringLoop = async () => {
        if (!monitoringState.isActive) return;

        try {
          await updateMonitoringState(runtime, monitoringState);
          monitoringState.retryAttempts = 0; // Reset retry counter on success
        } catch (error) {
          console.error("Error in monitoring loop:", error);
          monitoringState.retryAttempts++;

          if (monitoringState.retryAttempts >= monitoringState.maxRetries) {
            // Attempt state recovery before giving up
            const recovered = await attemptStateRecovery(runtime, monitoringState);
            
            if (!recovered) {
              monitoringState.isActive = false;
              await handleMonitoringFailure(runtime, monitoringState);
              return;
            }
            
            monitoringState.retryAttempts = 0; // Reset after recovery
          }

          // Exponential backoff for retries
          const backoffTime = Math.min(
            1000 * Math.pow(2, monitoringState.retryAttempts),
            30000
          );
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        }

        if (monitoringState.isActive) {
          setTimeout(monitoringLoop, monitoringState.updateInterval);
        }
      };

      // Start monitoring loop
      monitoringLoop();

      return {
        success: true,
        state: monitoringState
      };
    } catch (error) {
      if (error instanceof MonitorStateError) {
        throw error;
      }

      throw new MonitorStateError(
        'Failed to initialize monitoring',
        'INIT_FAILED',
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
          text: "Let's start monitoring our interactions",
          action: "MONITOR_SOCIAL"
        }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Starting relationship monitoring...",
          action: "STATE_UPDATE",
          emotionalState: EmotionalState.HAPPY,
          responseType: "ANALYZED"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Can you keep track of our conversation?",
          action: "MONITOR_SOCIAL"
        }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "I'll monitor our interaction patterns and relationship development.",
          action: "STATE_UPDATE",
          emotionalState: EmotionalState.HAPPY,
          responseType: "ANALYZED"
        }
      }
    ]
  ]
};

async function initializeMonitoring(
  runtime: IAgentRuntime,
  message: Memory,
  monitoringState: MonitoringState
): Promise<void> {
  // Get current context
  const contexts = await runtime.databaseAdapter.getMemories({
    roomId: message.roomId,
    tableName: "relationship_contexts",
    agentId: runtime.agentId,
    count: 1
  });

  const context = contexts[0] as unknown as RelationshipContext;

  // Update context state
  const updatedContext = {
    ...context,
    currentState: SystemState.MONITORING,
    lastInteraction: new Date(),
    interactionHistory: [
      ...context.interactionHistory,
      {
        timestamp: new Date(),
        action: "STATE_UPDATE",
        emotionalState: context.emotionalState,
        responseType: "ANALYZED"
      }
    ],
    text: JSON.stringify({
      state: "monitoring_initialized",
      timestamp: new Date().toISOString()
    })
  };

  // Save updated context
  await runtime.databaseAdapter.createMemory(
    {
      userId: message.userId,
      agentId: runtime.agentId,
      roomId: message.roomId,
      content: updatedContext
    },
    "relationship_contexts",
    true
  );
}

// Enhanced monitoring state update
async function updateMonitoringState(
  runtime: IAgentRuntime,
  monitoringState: MonitoringState
): Promise<void> {
  try {
    // Get current context
    const contexts = await runtime.databaseAdapter.getMemories({
      roomId: monitoringState.roomId,
      tableName: "relationship_contexts",
      agentId: runtime.agentId,
      count: 1
    });

    const context = contexts[0] as unknown as RelationshipContext;
    
    if (!context) {
      throw new MonitorStateError(
        'Context not found during update',
        'MISSING_CONTEXT',
        true
      );
    }

    // Get new messages since last update
    const messages = await runtime.messageManager.getMemories({
      roomId: monitoringState.roomId,
      start: monitoringState.lastUpdate.getTime(),
      count: 50
    });

    if (messages.length > 0) {
      // Process new messages and update context
      const updatedContext = await processNewMessages(runtime, context, messages);
      
      // Validate updated context
      if (!updatedContext.emotionalState || !updatedContext.relationshipState) {
        throw new MonitorStateError(
          'Invalid context after update',
          'INVALID_CONTEXT',
          true
        );
      }

      // Update last update timestamp
      monitoringState.lastUpdate = new Date();
    }
  } catch (error) {
    if (error instanceof MonitorStateError) {
      throw error;
    }

    throw new MonitorStateError(
      'Failed to update monitoring state',
      'UPDATE_FAILED',
      true,
      { originalError: error }
    );
  }
}

async function processNewMessages(
  runtime: IAgentRuntime,
  context: RelationshipContext,
  messages: Memory[]
): Promise<RelationshipContext> {
  const updatedContext = { ...context };
  
  for (const message of messages) {
    // Add message to interaction history
    updatedContext.interactionHistory.push({
      timestamp: new Date(),
      action: (message.content.action || 'MESSAGE') as ActionType,
      emotionalState: (message.content.emotionalState || context.emotionalState) as EmotionalState,
      responseType: (message.content.responseType || 'NONE') as ResponseType
    });

    // Update emotional state if provided
    if (message.content.emotionalState) {
      updatedContext.emotionalState = message.content.emotionalState as EmotionalState;
    }
  }

  // Trim history if it gets too long (keep last 100 interactions)
  if (updatedContext.interactionHistory.length > 100) {
    updatedContext.interactionHistory = updatedContext.interactionHistory.slice(-100);
  }

  return updatedContext;
}

// Enhanced monitoring failure handler
async function handleMonitoringFailure(
  runtime: IAgentRuntime,
  monitoringState: MonitoringState
): Promise<void> {
  try {
    // Log failure
    console.error('Monitoring failed for user:', monitoringState.userId);

    // Create failure record
    await runtime.databaseAdapter.createMemory(
      {
        userId: monitoringState.userId,
        agentId: runtime.agentId,
        roomId: monitoringState.roomId,
        content: {
          text: JSON.stringify({
            userId: monitoringState.userId,
            timestamp: new Date().toISOString(),
            retryAttempts: monitoringState.retryAttempts,
            lastUpdate: monitoringState.lastUpdate
          }),
          action: 'MONITORING_FAILURE'
        }
      },
      'monitoring_failures'
    );

    // Update relationship context to indicate monitoring failure
    const contexts = await runtime.databaseAdapter.getMemories({
      roomId: monitoringState.roomId,
      tableName: 'relationship_contexts',
      agentId: runtime.agentId,
      count: 1
    });

    if (contexts[0]) {
      const context = contexts[0] as unknown as RelationshipContext;
      context.currentState = SystemState.IDLE;
      
      // Save updated context
      await runtime.databaseAdapter.createMemory(
        {
          userId: monitoringState.userId,
          agentId: runtime.agentId,
          roomId: monitoringState.roomId,
          content: {
            text: JSON.stringify(context),
            action: 'STATE_UPDATE'
          }
        },
        'relationship_contexts',
        true // Update existing
      );
    }
  } catch (error) {
    console.error('Error handling monitoring failure:', error);
  }
}
