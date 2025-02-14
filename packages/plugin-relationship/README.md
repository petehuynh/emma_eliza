# @elizaos/plugin-relationship

A plugin enabling agents to monitor and build relationships via reciprocity.

## Description

The Relationship plugin empowers your Eliza agent with relationship management capabilities. It tracks and adapts to user interactions over time, managing relationship states, emotional analysis, and response modes to create more personalized and contextually appropriate interactions.

## Installation

```bash
pnpm install @elizaos/plugin-relationship
```

## Usage

```typescript
import { relationshipPlugin } from "@elizaos/plugin-relationship";
const character = {
    // ... other character config
    plugins: [relationshipPlugin],
};
```

## Core Features

### Relationship States
- Manages different relationship levels (stranger, acquaintance, friend)
- Tracks interaction history and relationship progression
- Adapts behavior based on relationship context

### Emotional Intelligence
- Analyzes sentiment and emotional patterns
- Adjusts responses based on emotional context
- Maintains emotional state history

### User Evaluation
- Calculates credibility scores
- Tracks interaction quality
- Manages trust metrics

### Response Adaptation
- Dynamically adjusts communication style
- Provides contextually appropriate responses
- Maintains conversation continuity

## Components

### Providers
- **Time Provider**: Manages interaction timestamps
- **Relationship Provider**: Handles relationship context and metrics

### Evaluators
- **Goal Evaluator**: Tracks relationship objectives
- **Feeling Evaluator**: Processes emotional context

## Dependencies

- @elizaos/core: workspace:*

## License

This plugin is part of the Eliza project. See the main project repository for license information.
```
