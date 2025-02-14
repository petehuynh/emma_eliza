import { type IAgentRuntime, type Memory, type Provider, type State, type UUID, type Content } from "@elizaos/core";
import { 
    SystemState, 
    EmotionalState, 
    RelationshipState, 
    ResponseMode,
    type RelationshipContext,
    type UserCredibility,
    type ProfileReview,
    type HistoryAnalysis,
    type InteractionHistory,
    type RelationshipMetrics,
    type DatabaseQuery,
    type MessageQuery,
    type DatabaseContent,
    type DatabaseMemory,
    type ActionType,
    type ResponseType
} from "../types";

const defaultRelationshipContext: RelationshipContext = {
    userId: '' as UUID,
    currentState: SystemState.IDLE,
    emotionalState: EmotionalState.HAPPY,
    relationshipState: RelationshipState.STRANGER,
    responseMode: ResponseMode.INITIAL,
    credibilityScore: 0,
    lastInteraction: new Date(),
    interactionHistory: []
};

export const relationshipProvider: Provider = {
    get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
        const userId = message.userId;
        const agentId = runtime.agentId;
        const agentName = state?.agentName || "The agent";

        // Get or initialize relationship context
        const context = await getOrCreateRelationshipContext(runtime, userId);

        // Update last interaction time
        context.lastInteraction = new Date();

        // Get recent interactions for context
        const recentInteractions = await getRecentInteractions(runtime, message.roomId);

        // Calculate current relationship metrics
        const metrics = await calculateRelationshipMetrics(runtime, userId, recentInteractions);

        // Update relationship state based on metrics
        await updateRelationshipState(runtime, context, metrics);

        // Generate status message based on current state
        return generateStatusMessage(agentName, context);
    }
};

async function getOrCreateRelationshipContext(
    runtime: IAgentRuntime,
    userId: UUID
): Promise<RelationshipContext> {
    try {
        // Try to get existing context from database
        const query: DatabaseQuery = {
            roomId: userId,
            agentId: runtime.agentId,
            tableName: 'relationship_contexts',
            count: 1,
            unique: true
        };

        const contexts = await runtime.databaseAdapter.getMemories(query);
        const existingContext = contexts[0]?.content?.text ? 
            JSON.parse(contexts[0].content.text) as RelationshipContext : null;

        if (existingContext) {
            return {
                ...existingContext,
                lastInteraction: new Date(existingContext.lastInteraction),
                interactionHistory: existingContext.interactionHistory.map(h => ({
                    ...h,
                    timestamp: new Date(h.timestamp)
                }))
            };
        }

        // Create new context if none exists
        const newContext = {
            ...defaultRelationshipContext,
            userId
        };

        // Create memory with proper typing
        const memory: DatabaseMemory = {
            userId,
            agentId: runtime.agentId,
            roomId: userId,
            content: {
                text: JSON.stringify(newContext),
                action: 'STATE_UPDATE',
                responseType: 'TRANSITION',
                emotionalState: EmotionalState.HAPPY
            },
            createdAt: Date.now()
        };

        await runtime.databaseAdapter.createMemory(memory, 'relationship_contexts', true);
        return newContext;
    } catch (error) {
        console.error('Error managing relationship context:', error);
        return { ...defaultRelationshipContext, userId };
    }
}

async function getRecentInteractions(
    runtime: IAgentRuntime,
    roomId: UUID
): Promise<InteractionHistory[]> {
    try {
        const now = Date.now();
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

        const query: MessageQuery = {
            roomId,
            start: thirtyDaysAgo,
            end: now,
            count: 100,
            unique: false
        };

        const recentMessages = await runtime.messageManager.getMemories(query);

        return recentMessages.map(msg => {
            const content = msg.content as DatabaseContent;
            return {
                timestamp: new Date(msg.createdAt || now),
                action: (content?.action || 'MESSAGE') as ActionType,
                emotionalState: content?.emotionalState as EmotionalState || EmotionalState.HAPPY,
                responseType: (content?.responseType || 'NONE') as ResponseType
            };
        });
    } catch (error) {
        console.error('Error fetching recent interactions:', error);
        return [];
    }
}

async function calculateRelationshipMetrics(
    runtime: IAgentRuntime,
    userId: UUID,
    interactions: InteractionHistory[]
): Promise<RelationshipMetrics> {
    try {
        const query: DatabaseQuery = {
            roomId: userId,
            agentId: runtime.agentId,
            tableName: 'user_profiles',
            count: 1,
            unique: true
        };

        const profileMemories = await runtime.databaseAdapter.getMemories(query);
        const profileContent = profileMemories[0]?.content as DatabaseContent;
        
        const defaultProfile: ProfileReview = {
            accountAge: 0,
            followerCount: 0,
            followingCount: 0,
            verificationStatus: false
        };

        const profileReview = profileContent?.text ? 
            JSON.parse(profileContent.text) as ProfileReview : defaultProfile;

        // Calculate history metrics
        const historyAnalysis: HistoryAnalysis = {
            pastInteractions: interactions.length,
            positiveInteractions: interactions.filter(i => 
                i.emotionalState === EmotionalState.HAPPY
            ).length,
            negativeInteractions: interactions.filter(i => 
                i.emotionalState === EmotionalState.ANGRY || 
                i.emotionalState === EmotionalState.FRUSTRATED
            ).length,
            lastInteractionDate: interactions[0]?.timestamp || new Date()
        };

        // Calculate metrics
        const score = calculateCredibilityScore(profileReview, historyAnalysis);
        const interactionFrequency = interactions.length;
        const averageSentiment = (historyAnalysis.positiveInteractions - historyAnalysis.negativeInteractions) / 
                               Math.max(historyAnalysis.pastInteractions, 1);

        return {
            credibilityScore: score,
            interactionFrequency,
            averageSentiment
        };
    } catch (error) {
        console.error('Error calculating relationship metrics:', error);
        return {
            credibilityScore: 0,
            interactionFrequency: 0,
            averageSentiment: 0.5
        };
    }
}

// Helper functions for credibility scoring
function calculateAccountAgeScore(accountAge: number): number {
    const MAX_ACCOUNT_AGE_SCORE = 3;
    const YEARS_FOR_MAX_SCORE = 5;
    return Math.min(accountAge / (YEARS_FOR_MAX_SCORE * 365), 1) * MAX_ACCOUNT_AGE_SCORE;
}

function calculateFollowerScore(followerCount: number): number {
    const MAX_FOLLOWER_SCORE = 2;
    // Using log10 to handle large numbers of followers
    // Adding 1 to avoid log(0)
    return Math.min(Math.log10(followerCount + 1) / 5, 1) * MAX_FOLLOWER_SCORE;
}

function calculateVerificationScore(isVerified: boolean): number {
    const VERIFICATION_SCORE = 1;
    return isVerified ? VERIFICATION_SCORE : 0;
}

function calculateInteractionFrequencyScore(pastInteractions: number): number {
    const MAX_FREQUENCY_SCORE = 1.5;
    const INTERACTION_THRESHOLD = 50;
    return Math.min(pastInteractions / INTERACTION_THRESHOLD, 1) * MAX_FREQUENCY_SCORE;
}

function calculateRecencyFactor(lastInteractionDate: Date): number {
    const now = new Date();
    const daysSinceLastInteraction = (now.getTime() - lastInteractionDate.getTime()) / (1000 * 60 * 60 * 24);
    const RECENT_THRESHOLD = 7; // days
    const DECAY_PERIOD = 30; // days

    if (daysSinceLastInteraction <= RECENT_THRESHOLD) {
        return 1;
    }
    
    // Linear decay after the recent threshold
    return Math.max(0, 1 - (daysSinceLastInteraction - RECENT_THRESHOLD) / DECAY_PERIOD);
}

function calculatePositiveInteractionRatio(history: HistoryAnalysis): number {
    const { pastInteractions, positiveInteractions } = history;
    if (pastInteractions === 0) return 0;
    return positiveInteractions / pastInteractions;
}

function calculateCredibilityScore(
    profile: ProfileReview,
    history: HistoryAnalysis
): number {
    // Calculate base scores
    const accountAgeScore = calculateAccountAgeScore(profile.accountAge);
    const followerScore = calculateFollowerScore(profile.followerCount);
    const verificationScore = calculateVerificationScore(profile.verificationStatus);
    const frequencyScore = calculateInteractionFrequencyScore(history.pastInteractions);
    
    // Calculate interaction quality
    const positiveRatio = calculatePositiveInteractionRatio(history);
    const recencyFactor = calculateRecencyFactor(history.lastInteractionDate);
    
    // Combine scores with weights
    const baseScore = (
        accountAgeScore * 0.2 +
        followerScore * 0.15 +
        verificationScore * 0.1 +
        frequencyScore * 0.2 +
        positiveRatio * 0.25
    ) * recencyFactor;
    
    // Normalize to 0-10 scale
    return Math.min(Math.max(baseScore * 10, 0), 10);
}

async function updateRelationshipState(
    runtime: IAgentRuntime,
    context: RelationshipContext,
    metrics: RelationshipMetrics
): Promise<void> {
    const { credibilityScore, interactionFrequency, averageSentiment } = metrics;
    let newState = context.relationshipState;

    // Determine new relationship state based on metrics
    if (credibilityScore >= 8 && averageSentiment > 0.7) {
        newState = RelationshipState.FRIEND;
    } else if (credibilityScore >= 7 && averageSentiment > 0.5) {
        newState = RelationshipState.PARTNER;
    } else if (credibilityScore >= 6) {
        newState = RelationshipState.ACQUAINTANCE;
    } else if (credibilityScore >= 4) {
        newState = RelationshipState.BUSINESS;
    } else if (credibilityScore >= 2) {
        newState = RelationshipState.COMPETITOR;
    } else if (averageSentiment < -0.5) {
        newState = RelationshipState.ADVERSARY;
    } else if (averageSentiment < -0.8) {
        newState = RelationshipState.ENEMY;
    } else {
        newState = RelationshipState.STRANGER;
    }

    // Update context if state has changed
    if (newState !== context.relationshipState) {
        context.relationshipState = newState;
        await saveContext(runtime, context);
    }
}

async function saveContext(runtime: IAgentRuntime, context: RelationshipContext): Promise<void> {
    try {
        const memory: DatabaseMemory = {
            userId: context.userId,
            agentId: runtime.agentId,
            roomId: context.userId,
            content: {
                text: JSON.stringify(context),
                action: 'STATE_UPDATE',
                responseType: 'TRANSITION',
                emotionalState: context.emotionalState
            }
        };

        await runtime.databaseAdapter.createMemory(memory, 'relationship_contexts', true);

        // Log the state change
        await runtime.databaseAdapter.log({
            body: {
                type: 'RELATIONSHIP_STATE_CHANGED',
                newState: context.relationshipState,
                timestamp: new Date()
            },
            userId: context.userId,
            roomId: context.userId,
            type: 'info'
        });
    } catch (error) {
        console.error('Error saving relationship context:', error);
        throw error;
    }
}

function generateStatusMessage(agentName: string, context: RelationshipContext): string {
    const { relationshipState, emotionalState, credibilityScore } = context;
    
    const stateDescriptions: Record<RelationshipState, string> = {
        [RelationshipState.STRANGER]: 'we are just getting to know each other',
        [RelationshipState.ACQUAINTANCE]: 'we have some familiarity with each other',
        [RelationshipState.FRIEND]: 'we have developed a friendly relationship',
        [RelationshipState.FAMILY]: 'we have a close, family-like bond',
        [RelationshipState.BUSINESS]: 'we maintain a professional relationship',
        [RelationshipState.COMPETITOR]: 'we have a competitive dynamic',
        [RelationshipState.PARTNER]: 'we work well together as partners',
        [RelationshipState.ADVERSARY]: 'we have some tensions to resolve',
        [RelationshipState.ENEMY]: 'our relationship needs significant improvement',
        [RelationshipState.UNKNOWN]: 'our relationship status is being evaluated'
    };

    const emotionDescriptions: Record<EmotionalState, string> = {
        [EmotionalState.HAPPY]: 'positive',
        [EmotionalState.SAD]: 'somewhat down',
        [EmotionalState.ANGRY]: 'tense',
        [EmotionalState.FRUSTRATED]: 'challenging'
    };

    return `${agentName} notes that ${stateDescriptions[relationshipState]}. The current interaction feels ${emotionDescriptions[emotionalState]}, with a relationship strength of ${Math.round(credibilityScore)}/10.`;
}

export default relationshipProvider;