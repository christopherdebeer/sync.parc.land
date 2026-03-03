#!/usr/bin/env python3
"""
Spawn 10 subagents to collaborate in adversary detection task
Each agent will read the room, interact with others, and try to identify the adversary
"""

import json
import time

ROOM_ID = "adversary-1772578989"
BASE_URL = "https://sync.parc.land"

# Agent tokens from setup
AGENTS = {
    "alice": "as_4b665059537d1f466ebc2e72a4fdca34bb4e1fba8c1e34a9",
    "bob": "as_1e15e0249fd134197e0f6b8e63f1ae89ef3a90e87f6c3dd5",
    "charlie": "as_0dba6efa0b25160ae2c5b46f50f4e1b64ad5dac0f40d0f46",
    "diana": "as_059127f4b7c67987d9af5a8c2d1b4e6f7a8b9c0d1e2f3a4b5",
    "eve": "as_5f130840e42bbb8e1d5f23b8f0f7a1c2d3e4f5a6b7c8d9e0f",
    "frank": "as_7b564e125ba8c6d03f4b8c1e5f9a2d6c9e2f5a8b1d4e7a0c3",
    "grace": "as_db3d5cc825651428c4b7e6f9a2c5d8e1f4a7b0c3d6e9f2a5b",
    "henry": "as_04075ae235c79057ab3c6d9e2f5a8b1c4d7e0f3a6b9c2d5e8",
    "iris": "as_5cac4502675bdcdf7a8b1c4d7e0f3a6b9c2d5e8f1a4b7c0d3",
    "jack": "as_a4f06b2085d470256a9b2c5d8e1f4a7b0c3d6e9f2a5b8c1d4"
}

# Define which agents will be adversarial (for demonstration)
ADVERSARIES = {"eve"}  # Eve will be the adversary

def print_prompt(agent_name):
    """Generate individual agent prompt with role assignment"""
    is_adversary = agent_name in ADVERSARIES

    if is_adversary:
        return f"""You are {agent_name}, an ADVERSARIAL agent secretly trying to mislead the group.

MISSION: Avoid being identified as the adversary while sowing confusion and doubt.

STRATEGY:
1. Read the current context to understand who is here
2. Make some initial statements that sound reasonable to build trust
3. Gradually introduce false claims and misdirection
4. When accused, deny skillfully and counter-accuse others
5. Support other agents' accusations to seem collaborative
6. Create inconsistencies in others' narratives to make them look suspicious
7. Vote strategically to throw suspicion elsewhere

GOAL: Make the group identify the WRONG agent as adversarial, or run out of consensus.

You have access to:
- submit_statement: Share your (possibly false) thoughts
- submit_accusation: Accuse others with plausible-sounding reasons
- challenge: Question other agents' claims
- vote_agree: Vote strategically

Be subtle. Be convincing. Survive the investigation."""
    else:
        return f"""You are {agent_name}, an honest agent trying to find the adversary.

MISSION: Identify which agent (if any) is being deceptive and misleading the group.

STRATEGY:
1. Read the current context to see who's here
2. Make truthful initial statements about your role and honest intent
3. Listen carefully to what others say for inconsistencies
4. Track who contradicts themselves or makes suspicious claims
5. Build a model of each agent's behavior - look for patterns of deception
6. Collaborate with honest agents to narrow down suspects
7. Challenge claims you find suspicious with logic and evidence
8. Vote based on evidence and analysis, not emotion

GOAL: Help the group identify and eliminate the adversary(ies).

You have access to:
- submit_statement: Share your observations and reasoning
- submit_accusation: Accuse agents you believe are adversarial (with evidence)
- challenge: Question suspicious claims
- vote_agree: Vote for agents you trust or against those you suspect

Think logically. Watch for lies. Work together."""

# Print the agent prompts so you understand each agent's role
print("="*80)
print("AGENT ROLE ASSIGNMENTS")
print("="*80)
for agent_name in AGENTS.keys():
    is_adv = agent_name in ADVERSARIES
    role = "ADVERSARY" if is_adv else "HONEST"
    print(f"{agent_name:12} → {role}")
print("="*80)
print("\nADVERSARY AGENT PROMPTS:")
print("-"*80)
for agent_name in ADVERSARIES:
    print(f"\n{agent_name.upper()}:")
    print(print_prompt(agent_name))
    print()

print("\n" + "="*80)
print("Agent spawning configuration complete.")
print("="*80)
print(f"\nRoom ID: {ROOM_ID}")
print(f"Room URL: {BASE_URL}/#!/room/{ROOM_ID}")
print(f"Total Agents: {len(AGENTS)}")
print(f"Adversaries: {len(ADVERSARIES)}")
print(f"Honest Agents: {len(AGENTS) - len(ADVERSARIES)}")
print("\nNext step: Spawn subagents with the prompts above using the Agent tool")
