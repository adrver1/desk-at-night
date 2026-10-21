---
name: to-questionnaire
description: Turn a question Adriaen can't answer alone into a questionnaire for someone else to fill in, such as an operator, the control room lead or a manager on the platform.
disable-model-invocation: true
---

Turn something the user can't answer alone into a **questionnaire**: a document they hand to one person to fill in, or go through together in a meeting. The recipient holds knowledge the user lacks, for example what really happens on a night shift, which alarms flood, or which KPIs management watches.

**Grill the send, not the subject.** Ask the user only about the send, which they can always answer:

1. **Who is it going to?** Role, expertise and relationship to the user, in one exchange. This sets the tone and how much context the document must carry.
2. **What do you need back?** The specific decisions or facts the user needs from this person, in one exchange.
3. **Write it.** Questions aimed at the gap between 1 and 2, most important first, grouped under `##` themes when there are more than a handful. Each question is one idea with an answer stub (`>`) under it, plus a one-line _why this matters_ only where it could be misread.

Save it to `/mnt/project-files/control-room-game/questionnaires/<slug>.md` and attach it. **Never put it in the repo**: it is about a real platform and its people.

Structure:

```md
# <Title>

**Purpose:** why this exists and the decision riding on it.
**From:** <user> · **To:** <recipient> · **How your answers will be used:** <where they go>

## Context
One paragraph for someone who hasn't seen the game. Enough to answer well.

## How to answer
Rough effort and deadline. "I don't know" and partial answers are useful.

## <Theme>
### <Question>
_Why this matters: ..._
>

## Anything else?
```

Adapted from Matt Pocock's `to-questionnaire` skill (MIT, https://github.com/mattpocock/skills).
