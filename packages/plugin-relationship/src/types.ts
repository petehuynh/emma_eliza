// Core Enums
enum EmotionalState {
  HAPPY = 'happy',
  SAD = 'sad',
  ANGRY = 'angry',
  FRUSTRATED = 'frustrated'
}

enum RelationshipState {
  STRANGER = 'stranger',
  ACQUAINTANCE = 'acquaintance',
  FRIEND = 'friend',
  FAMILY = 'family',
  BUSINESS = 'business',
  ADVERSARY = 'adversary',
  COMPETITOR = 'competitor',
  PARTNER = 'partner',
  ENEMY = 'enemy',
  UNKNOWN = 'unknown'
}

enum SystemState {
  IDLE = 'idle',
  MONITORING = 'monitoring',
  EMOTION_ANALYSIS = 'emotion_analysis',
  USER_EVALUATION = 'user_evaluation',
  RESPONSE_MODE = 'response_mode'
}

enum ResponseMode {
  INITIAL = 'initial',
  ONGOING = 'ongoing',
  DISENGAGEMENT = 'disengagement'
}

// Interfaces
interface RelationshipContext {
  userId: string;
  currentState: SystemState;
  emotionalState: EmotionalState;
  relationshipState: RelationshipState;
  responseMode: ResponseMode;
  credibilityScore: number;
  lastInteraction: Date;
  interactionHistory: InteractionHistory[];
}

interface InteractionHistory {
  timestamp: Date;
  action: string;
  emotionalState: EmotionalState;
  responseType: string;
}

interface UserCredibility {
  score: number;
  profileReview: ProfileReview;
  historyAnalysis: HistoryAnalysis;
}

interface ProfileReview {
  accountAge: number;
  followerCount: number;
  followingCount: number;
  verificationStatus: boolean;
}

interface HistoryAnalysis {
  pastInteractions: number;
  positiveInteractions: number;
  negativeInteractions: number;
  lastInteractionDate: Date;
}
