# Topic Voting Auto Self-Vote

A Discourse theme component that automatically casts a vote for users on topics they create in voting-enabled categories.

## Why Use This?

This component is designed for communities that use [Topic Voting](https://meta.discourse.org/t/discourse-topic-voting/40121) but **do not limit the number of votes** users can cast. In these communities, there's no strategic reason for users to withhold their vote from their own ideas—they should always vote for topics they create.

Rather than requiring users to manually click the vote button after creating a topic, this component handles it automatically, ensuring every user's topic starts with their own vote.

## Features

- **Automatic voting on topic creation** — When a user creates a new topic in a voting-enabled category, their vote is cast immediately
- **Instant UI feedback** — The vote button updates without requiring a page refresh
- **Category filtering** — Optionally limit auto-voting to specific categories
- **Group exclusions** — Exclude specific user groups from auto self-voting
- **Retroactive voting** — Optionally auto-vote when users visit their own older unvoted topics

## Settings

| Setting | Description |
|---------|-------------|
| **auto_vote_categories** | Categories where auto-voting is enabled. Leave empty to enable for all voting-enabled categories. |
| **excluded_groups** | Groups excluded from auto self-voting. Users in these groups will not have votes automatically cast. |
| **auto_vote_on_visit** | When enabled, also auto-votes when users visit their own older topics that they haven't voted on yet. |

## Installation

1. Go to **Admin** → **Customize** → **Themes**
2. Click **Install** and select **From a git repository**
3. Enter the repository URL
4. Add the component to your active theme

## Requirements

- Discourse 3.1.0 or higher
- [Topic Voting](https://meta.discourse.org/t/discourse-topic-voting/40121) plugin enabled

## License

MIT
