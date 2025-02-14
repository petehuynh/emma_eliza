import { IAgentRuntime } from '@elizaos/core';
import {
  RelationshipContext,
  InteractionHistory,
  EmotionalState,
  type ActionType
} from '../types';

interface TimeInterval {
  start: Date;
  end: Date;
  interactions: InteractionHistory[];
}

interface EmotionalStateMetrics {
  state: EmotionalState;
  count: number;
  percentage: number;
}

interface InteractionMetrics {
  totalInteractions: number;
  timeIntervals: {
    daily: TimeInterval[];
    weekly: TimeInterval[];
  };
  emotionalStates: EmotionalStateMetrics[];
  averageSentiment: number;
  trendAnalysis: {
    overall: 'improving' | 'stable' | 'declining';
    confidence: number;
    significantEvents: Array<{
      date: Date;
      description: string;
      impact: 'positive' | 'negative' | 'neutral';
    }>;
  };
}

const calculateAverageSentiment = (interactions: InteractionHistory[]): number => {
  if (!interactions.length) return 0;

  const sentimentMap = {
    [EmotionalState.HAPPY]: 1,
    [EmotionalState.SAD]: 0.3,
    [EmotionalState.ANGRY]: 0,
    [EmotionalState.FRUSTRATED]: 0.2
  };

  const total = interactions.reduce((sum, interaction) => 
    sum + (sentimentMap[interaction.emotionalState] || 0.5), 0);

  return total / interactions.length;
};

const groupInteractionsByTimeInterval = (
  interactions: InteractionHistory[],
  intervalType: 'daily' | 'weekly'
): TimeInterval[] => {
  if (!interactions.length) return [];

  const sortedInteractions = [...interactions].sort((a, b) => 
    a.timestamp.getTime() - b.timestamp.getTime());

  const intervals: TimeInterval[] = [];
  let currentInterval: TimeInterval | null = null;

  for (const interaction of sortedInteractions) {
    const intervalStart = new Date(interaction.timestamp);
    if (intervalType === 'daily') {
      intervalStart.setHours(0, 0, 0, 0);
    } else {
      intervalStart.setHours(0, 0, 0, 0);
      intervalStart.setDate(intervalStart.getDate() - intervalStart.getDay());
    }

    const intervalEnd = new Date(intervalStart);
    if (intervalType === 'daily') {
      intervalEnd.setDate(intervalEnd.getDate() + 1);
    } else {
      intervalEnd.setDate(intervalEnd.getDate() + 7);
    }

    if (!currentInterval || interaction.timestamp >= intervalEnd) {
      currentInterval = {
        start: intervalStart,
        end: intervalEnd,
        interactions: []
      };
      intervals.push(currentInterval);
    }

    currentInterval.interactions.push(interaction);
  }

  return intervals;
};

const calculateEmotionalStateMetrics = (
  interactions: InteractionHistory[]
): EmotionalStateMetrics[] => {
  if (!interactions.length) return [];

  const stateCounts = new Map<EmotionalState, number>();
  
  interactions.forEach(interaction => {
    const count = stateCounts.get(interaction.emotionalState) || 0;
    stateCounts.set(interaction.emotionalState, count + 1);
  });

  return Array.from(stateCounts.entries()).map(([state, count]) => ({
    state,
    count,
    percentage: (count / interactions.length) * 100
  }));
};

const detectSignificantEvents = (
  intervals: TimeInterval[]
): Array<{ date: Date; description: string; impact: 'positive' | 'negative' | 'neutral' }> => {
  const events: Array<{ date: Date; description: string; impact: 'positive' | 'negative' | 'neutral' }> = [];

  intervals.forEach((interval, index) => {
    const prevInterval = intervals[index - 1];
    if (!prevInterval) return;

    const currentSentiment = calculateAverageSentiment(interval.interactions);
    const prevSentiment = calculateAverageSentiment(prevInterval.interactions);
    const sentimentChange = currentSentiment - prevSentiment;

    if (Math.abs(sentimentChange) >= 0.3) {
      events.push({
        date: interval.start,
        description: `Significant ${sentimentChange > 0 ? 'improvement' : 'decline'} in sentiment`,
        impact: sentimentChange > 0 ? 'positive' : 'negative'
      });
    }

    const currentFrequency = interval.interactions.length;
    const prevFrequency = prevInterval.interactions.length;
    const frequencyChange = currentFrequency - prevFrequency;

    if (Math.abs(frequencyChange) >= 3) {
      events.push({
        date: interval.start,
        description: `Notable ${frequencyChange > 0 ? 'increase' : 'decrease'} in interaction frequency`,
        impact: frequencyChange > 0 ? 'positive' : 'neutral'
      });
    }
  });

  return events;
};

export const analyzeInteractionHistory = async (
  runtime: IAgentRuntime,
  context: RelationshipContext
): Promise<InteractionMetrics> => {
  const { interactionHistory } = context;
  if (!interactionHistory.length) {
    return {
      totalInteractions: 0,
      timeIntervals: {
        daily: [],
        weekly: []
      },
      emotionalStates: [],
      averageSentiment: 0,
      trendAnalysis: {
        overall: 'stable',
        confidence: 0,
        significantEvents: []
      }
    };
  }

  // Group interactions by time intervals
  const dailyIntervals = groupInteractionsByTimeInterval(interactionHistory, 'daily');
  const weeklyIntervals = groupInteractionsByTimeInterval(interactionHistory, 'weekly');

  // Calculate emotional state metrics
  const emotionalStates = calculateEmotionalStateMetrics(interactionHistory);

  // Calculate average sentiment
  const averageSentiment = calculateAverageSentiment(interactionHistory);

  // Analyze trends and detect significant events
  const recentIntervals = weeklyIntervals.slice(-4);
  const recentSentiments = recentIntervals.map(interval => 
    calculateAverageSentiment(interval.interactions));

  const trendAnalysis = {
    overall: 'stable' as 'improving' | 'stable' | 'declining',
    confidence: 0,
    significantEvents: detectSignificantEvents(weeklyIntervals)
  };

  // Determine overall trend
  if (recentSentiments.length >= 2) {
    const sentimentChanges = recentSentiments
      .slice(1)
      .map((sentiment, i) => sentiment - recentSentiments[i]);
    
    const averageChange = sentimentChanges.reduce((sum, change) => sum + change, 0) / 
      sentimentChanges.length;

    trendAnalysis.overall = averageChange > 0.1 ? 'improving' : 
      averageChange < -0.1 ? 'declining' : 'stable';
    
    trendAnalysis.confidence = Math.min(1, Math.abs(averageChange) * 2);
  }

  return {
    totalInteractions: interactionHistory.length,
    timeIntervals: {
      daily: dailyIntervals,
      weekly: weeklyIntervals
    },
    emotionalStates,
    averageSentiment,
    trendAnalysis
  };
}; 