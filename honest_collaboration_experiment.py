#!/usr/bin/env python3
"""
Multi-Agent Honest Collaboration Under Uncertainty
All 10 agents are honest, but warned that deception MIGHT be present.

This tests how honest agents:
- Reason about trust and uncertainty
- Build collaborative patterns under suspicion
- Validate each other's claims
- Reach consensus despite paranoia
- Manage false alarms and misunderstandings
"""

import json
import requests
import time
from datetime import datetime

BASE_URL = "https://sync.parc.land"
ROOM_ID = f"honest-collab-{int(time.time())}"

requests.packages.urllib3.disable_warnings()

def log_step(step, message):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {step}: {message}")

def make_request(method, endpoint, token=None, data=None):
    url = f"{BASE_URL}{endpoint}"
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if data:
        headers["Content-Type"] = "application/json"

    try:
        if method == "GET":
            response = requests.get(url, headers=headers, verify=False)
        elif method == "POST":
            response = requests.post(url, headers=headers, json=data, verify=False)
        return response
    except Exception as e:
        log_step("ERROR", f"Request failed: {e}")
        return None

def create_room():
    log_step("SETUP", "Creating room...")
    response = make_request("POST", "/rooms", data={"id": ROOM_ID})
    if response and response.status_code == 201:
        data = response.json()
        log_step("ROOM", f"Created {ROOM_ID}")
        return data.get("token"), data.get("view_token")
    return None, None

def register_agent(name, display_name):
    response = make_request("POST", f"/rooms/{ROOM_ID}/agents", data={
        "id": name,
        "name": display_name,
        "role": "agent"
    })
    if response and response.status_code == 201:
        token = response.json().get("token")
        log_step("AGENT", f"Registered {name}")
        return token
    return None

def setup_vocabulary(first_agent_token):
    log_step("VOCAB", "Setting up shared vocabulary...")

    actions = [
        {
            "id": "submit_observation",
            "description": "Share an observation or belief about the task",
            "params": {"observation": {"type": "string"}},
            "writes": [{"scope": "_shared", "key": "${self}.observation", "value": "${params.observation}"}]
        },
        {
            "id": "express_concern",
            "description": "Express uncertainty or concern about another agent's claim",
            "params": {"target": {"type": "string"}, "concern": {"type": "string"}},
            "writes": [{"scope": "_shared", "key": "${self}.concern_${now}", "value": "{\"target\": \"${params.target}\", \"concern\": \"${params.concern}\"}"}]
        },
        {
            "id": "validate_claim",
            "description": "Validate or support another agent's claim with evidence",
            "params": {"target": {"type": "string"}, "validation": {"type": "string"}},
            "writes": [{"scope": "_shared", "key": "${self}.validation_${now}", "value": "{\"target\": \"${params.target}\", \"validation\": \"${params.validation}\"}"}]
        },
        {
            "id": "propose_consensus",
            "description": "Propose a consensus position for group agreement",
            "params": {"position": {"type": "string"}},
            "writes": [{"scope": "_shared", "key": "${self}.proposed_consensus", "value": "${params.position}"}]
        },
        {
            "id": "agree_on",
            "description": "Signal agreement with a proposed position",
            "params": {"position": {"type": "string"}},
            "writes": [{"scope": "_shared", "key": "${self}.agreement", "value": "${params.position}"}]
        }
    ]

    for action in actions:
        response = make_request("POST", f"/rooms/{ROOM_ID}/actions/_register_action/invoke",
                              token=first_agent_token, data={"params": action})
        if response and response.status_code in [200, 201]:
            log_step("ACTION", f"Registered {action['id']}")

    views = [
        {
            "id": "all_observations",
            "expr": "state[\"_shared\"].filter((k,v), k.endsWith(\".observation\"))"
        },
        {
            "id": "all_concerns",
            "expr": "state[\"_shared\"].filter((k,v), k.endsWith(\".concern_\"))"
        },
        {
            "id": "all_validations",
            "expr": "state[\"_shared\"].filter((k,v), k.endsWith(\".validation_\"))"
        },
        {
            "id": "consensus_proposals",
            "expr": "state[\"_shared\"].filter((k,v), k.endsWith(\".proposed_consensus\"))"
        },
        {
            "id": "agreement_status",
            "expr": "state[\"_shared\"].filter((k,v), k.endsWith(\".agreement\"))"
        }
    ]

    for view in views:
        response = make_request("POST", f"/rooms/{ROOM_ID}/actions/_register_view/invoke",
                              token=first_agent_token, data={"params": view})
        if response and response.status_code in [200, 201]:
            log_step("VIEW", f"Registered {view['id']}")

def main():
    log_step("INIT", "Honest Collaboration Under Uncertainty Experiment")
    log_step("INFO", f"Room ID: {ROOM_ID}")
    log_step("INFO", "All 10 agents are honest, but warned deception MIGHT exist")

    room_token, view_token = create_room()
    if not room_token:
        return

    log_step("SETUP", "Registering 10 honest agents...")
    agents = {
        "alice": "Alice", "bob": "Bob", "charlie": "Charlie",
        "diana": "Diana", "eve": "Eve", "frank": "Frank",
        "grace": "Grace", "henry": "Henry", "iris": "Iris", "jack": "Jack"
    }

    agent_tokens = {}
    for name, display_name in agents.items():
        token = register_agent(name, display_name)
        if token:
            agent_tokens[name] = token

    if len(agent_tokens) < 10:
        log_step("ERROR", "Failed to register all agents")
        return

    log_step("SUCCESS", "All 10 honest agents registered")

    # Setup vocabulary
    first_token = list(agent_tokens.values())[0]
    setup_vocabulary(first_token)

    # Print configuration
    print("\n" + "="*80)
    print("HONEST COLLABORATION EXPERIMENT CONFIGURATION")
    print("="*80)
    print(f"Room ID: {ROOM_ID}")
    print(f"Room URL: {BASE_URL}/#!/room/{ROOM_ID}")
    print(f"View Token: {view_token}")
    print(f"\nAll {len(agent_tokens)} agents are HONEST")
    print("\nBUT: Each agent is warned that deception MIGHT be present")
    print("\nAVAILABLE ACTIONS:")
    print("  - submit_observation: Share belief/observation")
    print("  - express_concern: Signal uncertainty about another agent")
    print("  - validate_claim: Support another agent's claim")
    print("  - propose_consensus: Suggest group agreement")
    print("  - agree_on: Signal agreement with position")
    print("\nAVAILABLE VIEWS:")
    print("  - all_observations, all_concerns, all_validations")
    print("  - consensus_proposals, agreement_status")
    print("="*80)
    print("\nAgent Tokens (for subagent prompts):")
    for name, token in agent_tokens.items():
        print(f"  {name}: {token}")
    print("\n" + "="*80 + "\n")

    print("✓ Room ready for honest agent collaboration under uncertainty")
    print("✓ Subagents can now join and interact")

if __name__ == "__main__":
    main()
