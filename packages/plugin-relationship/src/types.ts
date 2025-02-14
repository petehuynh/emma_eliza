import { type UUID, type Content } from "@elizaos/core";

// Core Enums
export enum EmotionalState {
  HAPPY = 'happy',
  SAD = 'sad',
  ANGRY = 'angry',
  FRUSTRATED = 'frustrated'
}

export enum RelationshipState {
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

export enum SystemState {
  IDLE = 'idle',
  MONITORING = 'monitoring',
  EMOTION_ANALYSIS = 'emotion_analysis',
  USER_EVALUATION = 'user_evaluation',
  RESPONSE_MODE = 'response_mode'
}

export enum ResponseMode {
  INITIAL = 'initial',
  ONGOING = 'ongoing',
  DISENGAGEMENT = 'disengagement'
}

export type ActionType = 'MESSAGE' | 'STATE_UPDATE' | 'EMOTION_UPDATE' | 'TRANSITION';
export type ResponseType = 'NONE' | 'ANALYZED' | 'TRANSITION' | 'AUTOMATIC' | 'MANUAL';

// Database Types
export interface DatabaseContent extends Content {
  emotionalState?: EmotionalState;
  action?: ActionType;
  responseType?: ResponseType;
}

export interface DatabaseMemory {
  userId: UUID;
  agentId: UUID;
  roomId: UUID;
  content: DatabaseContent;
  createdAt?: number;
}

// Core Interfaces
export interface RelationshipContext {
  userId: UUID;
  currentState: SystemState;
  emotionalState: EmotionalState;
  relationshipState: RelationshipState;
  responseMode: ResponseMode;
  credibilityScore: number;
  lastInteraction: Date;
  interactionHistory: InteractionHistory[];
}

export interface InteractionHistory {
  timestamp: Date;
  action: ActionType;
  emotionalState: EmotionalState;
  responseType: ResponseType;
}

export interface UserCredibility {
  score: number;
  profileReview: ProfileReview;
  historyAnalysis: HistoryAnalysis;
  interactionFrequency: number;
  averageSentiment: number;
}

export interface ProfileReview {
  accountAge: number;
  followerCount: number;
  followingCount: number;
  verificationStatus: boolean;
}

export interface HistoryAnalysis {
  pastInteractions: number;
  positiveInteractions: number;
  negativeInteractions: number;
  lastInteractionDate: Date;
}

export interface RelationshipMetrics {
  credibilityScore: number;
  interactionFrequency: number;
  averageSentiment: number;
}

// Database Adapter Types
export interface DatabaseQuery {
  roomId: UUID;
  agentId: UUID;
  tableName: string;
  count?: number;
  start?: number;
  end?: number;
  unique?: boolean;
}

export interface MessageQuery {
  roomId: UUID;
  start?: number;
  end?: number;
  count?: number;
  unique?: boolean;
}
