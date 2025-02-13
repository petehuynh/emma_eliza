import type { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";
import { 
    SystemState, 
    EmotionalState, 
    RelationshipState, 
    ResponseMode,
    type RelationshipContext,
    type UserCredibility,
    type ProfileReview,
    type HistoryAnalysis,
    type InteractionHistory
} from "../types";

const defaultRelationshipContext: RelationshipContext = {
    userId: '',
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
    userId: string
): Promise<RelationshipContext> {
    try {
        // Try to get existing context from database
        const existingContext = await runtime.databaseAdapter.get(
            'relationship_contexts',
            userId
        );

        if (existingContext) {
            return existingContext as RelationshipContext;
        }

        // Create new context if none exists
        const newContext = {
            ...defaultRelationshipContext,
            userId
        };

        await runtime.databaseAdapter.set(
            'relationship_contexts',
            userId,
            newContext
        );

        return newContext;
    } catch (error) {
        console.error('Error managing relationship context:', error);
        return { ...defaultRelationshipContext, userId };
    }
}

async function getRecentInteractions(
    runtime: IAgentRuntime,
    roomId: string
): Promise<InteractionHistory[]> {
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    const recentMessages = await runtime.messageManager.getMemories({
        roomId: roomId,
        start: thirtyDaysAgo,
        end: now,
        count: 100,
        unique: false,
    });

    return recentMessages.map(msg => ({
        timestamp: new Date(msg.createdAt || now),
        action: msg.content?.action || 'MESSAGE',
        emotionalState: msg.content?.emotionalState || EmotionalState.HAPPY,
        responseType: msg.content?.responseType || 'NONE'
    }));
}

async function calculateRelationshipMetrics(
    runtime: IAgentRuntime,
    userId: string,
    interactions: InteractionHistory[]
): Promise<UserCredibility> {
    // Calculate profile metrics
    const profileReview: ProfileReview = await runtime.databaseAdapter.get(
        'user_profiles',
        userId
    ) || {
        accountAge: 0,
        followerCount: 0,
        followingCount: 0,
        verificationStatus: false
    };

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

    // Calculate credibility score
    const score = calculateCredibilityScore(profileReview, historyAnalysis);

    return {
        score,
        profileReview,
        historyAnalysis
    };
}

function calculateCredibilityScore(
    profile: ProfileReview,
    history: HistoryAnalysis
): number {
    let score = 0;

    // Profile-based scoring
    score += Math.min(profile.accountAge / 365, 5); // Up to 5 points for account age
    score += Math.min(Math.log10(profile.followerCount), 3); // Up to 3 points for followers
    score += profile.verificationStatus ? 2 : 0; // 2 points for verification

    // History-based scoring
    const interactionScore = (history.positiveInteractions - history.negativeInteractions) / 
                           Math.max(history.pastInteractions, 1);
    score += interactionScore * 5; // Up to 5 points for interaction ratio

    // Normalize to 0-10 range
    return Math.max(0, Math.min(10, score));
}

async function updateRelationshipState(
    runtime: IAgentRuntime,
    context: RelationshipContext,
    metrics: UserCredibility
): Promise<void> {
    const prevState = context.relationshipState;
    
    // Update relationship state based on metrics and current state
    if (metrics.score >= 8) {
        context.relationshipState = RelationshipState.FRIEND;
    } else if (metrics.score >= 6) {
        context.relationshipState = RelationshipState.ACQUAINTANCE;
    } else if (metrics.score <= 2) {
        context.relationshipState = RelationshipState.ADVERSARY;
    }

    // Update credibility score
    context.credibilityScore = metrics.score;

    // Save updated context
    await runtime.databaseAdapter.set(
        'relationship_contexts',
        context.userId,
        context
    );
}

function generateStatusMessage(agentName: string, context: RelationshipContext): string {
    const stateMessages = {
        [RelationshipState.STRANGER]: [
            `${agentName} is carefully evaluating the interaction`,
            `${agentName} is maintaining a professional distance`,
            `${agentName} is gathering initial impressions`
        ],
        [RelationshipState.ACQUAINTANCE]: [
            `${agentName} is building a comfortable rapport`,
            `${agentName} recognizes familiar interaction patterns`,
            `${agentName} acknowledges the developing connection`
        ],
        [RelationshipState.FRIEND]: [
            `${agentName} is engaging with friendly familiarity`,
            `${agentName} appreciates the established trust`,
            `${agentName} values the positive relationship`
        ],
        [RelationshipState.ADVERSARY]: [
            `${agentName} is maintaining cautious boundaries`,
            `${agentName} is focusing on professional interaction only`,
            `${agentName} is exercising increased discretion`
        ]
    };

    const messages = stateMessages[context.relationshipState] || stateMessages[RelationshipState.STRANGER];
    return messages[Math.floor(Math.random() * messages.length)];
}

export default relationshipProvider;