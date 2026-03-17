# #pull-requests Channel Conventions

Reference for posting and reacting in the `#pull-requests` channel (`C09DWRVAZ33`).

## Posting a PR

Use this format — one line of context, then the PR link. Nothing more.

```
LLE-XXXX: short description
<GitHub PR URL>
```

Examples from the channel:
- `LLE-8234: fix workflow corruption and add graceful recovery\nhttps://github.com/lleverage-ai/lleverage/pull/4044`
- `LLE-8215: fix duplicate requests in parallel for-each loops\nhttps://github.com/lleverage-ai/lleverage/pull/4035`

If the PR is urgent and needs immediate review, prefix with `:rotating_light:` and tag the reviewer:
```
:rotating_light: @reviewer
LLE-XXXX: short description
<GitHub PR URL>
```

If there's no Linear ticket, use a short descriptive line instead:
```
Remove Run Code Cloud action from agent
<GitHub PR URL>
```

If someone specific is a code owner or should review, tag them on a separate line after the link:
```
LLE-XXXX: short description
<GitHub PR URL>
@reviewer code owner
```

## PR Review Reactions

Use these emoji reactions on PR messages to signal review status:

| Reaction | Emoji name | Meaning |
|----------|-----------|---------|
| :eyes: | `eyes` | "I'm looking at this" — react when you start reviewing |
| :speech_balloon: | `speech_balloon` | "I've left comments" — react after posting review comments on the PR |
| :white_check_mark: | `white_check_mark` | "Approved" — react when you've approved the PR |

These reactions give the author quick visibility into where their PR is in the review cycle without needing to check GitHub.

## When to Use This Reference

- Posting a new PR to `#pull-requests`
- Reacting to someone else's PR in the channel
- Asking Claude to post or react to PRs on your behalf
