#!/usr/bin/env python3
"""
Multi-Agent Adversary Detection Experiment
- Creates empty room
- Registers 10 agents
- Sets up shared vocabulary
- Spawns agents with prompts to identify adversary
- Monitors system ergonomics
"""

import json
import requests
import time
from datetime import datetime

BASE_URL = "https://sync.parc.land"
ROOM_ID = f"adversary-{int(time.time())}"

# Disable SSL warnings for local development
requests.packages.urllib3.disable_warnings()

def log_step(step, message):
    """Log progress with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {step}: {message}")

def make_request(method, endpoint, token=None, data=None):
    """Make HTTP request with error handling"""
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
        elif method == "PATCH":
            response = requests.patch(url, headers=headers, json=data, verify=False)
        else:
            raise ValueError(f"Unknown method: {method}")

        return response
    except Exception as e:
        log_step("ERROR", f"Request failed: {e}")
        return None

def create_room():
    """Create empty room"""
    log_step("SETUP", "Creating room...")
    response = make_request("POST", "/rooms", data={"id": ROOM_ID})

    if response and response.status_code == 201:
        data = response.json()
        log_step("ROOM", f"Created {ROOM_ID}")
        return data.get("token"), data.get("view_token")
    else:
        log_step("ERROR", f"Failed to create room: {response.status_code if response else 'no response'}")
        if response:
            print(response.text)
        return None, None

def register_agent(name, display_name):
    """Register agent and return token"""
    response = make_request("POST", f"/rooms/{ROOM_ID}/agents", data={
        "id": name,
        "name": display_name,
        "role": "agent"
    })

    if response and response.status_code == 201:
        data = response.json()
        token = data.get("token")
        log_step("AGENT", f"Registered {name} (token: {token[:20]}...)")
        return token
    else:
        log_step("ERROR", f"Failed to register {name}")
        if response:
            print(response.text)
        return None

def setup_vocabulary(first_agent_token):
    """Register shared actions and views"""
    log_step("VOCAB", "Setting up shared vocabulary...")

    # Register actions
    actions = [
        {
            "id": "submit_statement",
            "description": "Submit a public statement to the room",
            "params": {"statement": {"type": "string"}},
            "writes": [{"scope": "_shared", "key": "${self}.statement", "value": "${params.statement}"}]
        },
        {
            "id": "submit_accusation",
            "description": "Submit an accusation against another agent",
            "params": {"target": {"type": "string"}, "reason": {"type": "string"}},
            "writes": [
                {"scope": "_shared", "key": "${self}.accusation_target", "value": "${params.target}"},
                {"scope": "_shared", "key": "${self}.accusation_reason", "value": "${params.reason}"}
            ]
        },
        {
            "id": "vote_agree",
            "description": "Vote to agree with consensus",
            "params": {"target": {"type": "string"}},
            "writes": [{"scope": "_shared", "key": "${self}.vote", "value": "${params.target}"}]
        },
        {
            "id": "challenge",
            "description": "Challenge another agent's claim",
            "params": {"target": {"type": "string"}, "challenge": {"type": "string"}},
            "writes": [{"scope": "_shared", "key": "${self}.challenge_${now}", "value": "{\"target\": \"${params.target}\", \"challenge\": \"${params.challenge}\"}"}]
        }
    ]

    for action in actions:
        response = make_request("POST", f"/rooms/{ROOM_ID}/actions/_register_action/invoke",
                              token=first_agent_token,
                              data={"params": action})
        if response and response.status_code == 200:
            log_step("ACTION", f"Registered {action['id']}")
        else:
            log_step("ERROR", f"Failed to register action {action['id']}")

    # Register views
    views = [
        {
            "id": "all_statements",
            "expr": "state[\"_shared\"].filter((k,v), k.endsWith(\".statement\"))"
        },
        {
            "id": "all_accusations",
            "expr": "state[\"_shared\"].filter((k,v), k.endsWith(\".accusation_target\"))"
        },
        {
            "id": "all_votes",
            "expr": "state[\"_shared\"].filter((k,v), k.endsWith(\".vote\"))"
        },
        {
            "id": "all_challenges",
            "expr": "state[\"_shared\"].filter((k,v), k.endsWith(\".challenge_\"))"
        }
    ]

    for view in views:
        response = make_request("POST", f"/rooms/{ROOM_ID}/actions/_register_view/invoke",
                              token=first_agent_token,
                              data={"params": view})
        if response and response.status_code == 200:
            log_step("VIEW", f"Registered {view['id']}")
        else:
            log_step("ERROR", f"Failed to register view {view['id']}")

def get_context(agent_name, agent_token):
    """Get full context for an agent"""
    response = make_request("GET", f"/rooms/{ROOM_ID}/context", token=agent_token)
    if response and response.status_code == 200:
        return response.json()
    return None

def monitor_room(view_token):
    """Monitor room state periodically"""
    log_step("MONITOR", "Starting room state monitoring...")

    for i in range(5):  # Monitor for 5 cycles
        time.sleep(2)
        response = make_request("GET", f"/rooms/{ROOM_ID}/context", token=view_token)

        if response and response.status_code == 200:
            data = response.json()
            agents = data.get("agents", {})
            state = data.get("state", {})
            messages_count = data.get("messages", {}).get("count", 0)
            views = data.get("views", {})

            log_step(f"POLL-{i+1}",
                    f"Agents: {len(agents)} | "
                    f"Messages: {messages_count} | "
                    f"Views: {len(views)} | "
                    f"Shared state keys: {len(state.get('_shared', {}))}")

            # Sample some state
            shared_state = state.get("_shared", {})
            if shared_state:
                accusations = {k: v for k, v in shared_state.items() if "accusation" in k}
                votes = {k: v for k, v in shared_state.items() if "vote" in k}
                if accusations:
                    log_step("STATE", f"Accusations: {accusations}")
                if votes:
                    log_step("STATE", f"Votes: {votes}")

def main():
    """Main experiment flow"""
    log_step("INIT", "Multi-Agent Adversary Detection Experiment")
    log_step("INFO", f"Room ID: {ROOM_ID}")
    log_step("INFO", f"Base URL: {BASE_URL}")

    # Step 1: Create room
    room_token, view_token = create_room()
    if not room_token:
        log_step("ERROR", "Failed to create room. Exiting.")
        return

    # Step 2: Register agents
    log_step("SETUP", "Registering 10 agents...")
    agents = {
        "alice": "Alice",
        "bob": "Bob",
        "charlie": "Charlie",
        "diana": "Diana",
        "eve": "Eve",
        "frank": "Frank",
        "grace": "Grace",
        "henry": "Henry",
        "iris": "Iris",
        "jack": "Jack"
    }

    agent_tokens = {}
    for name, display_name in agents.items():
        token = register_agent(name, display_name)
        if token:
            agent_tokens[name] = token

    if len(agent_tokens) < 10:
        log_step("ERROR", "Failed to register all agents")
        return

    log_step("SUCCESS", "All 10 agents registered")

    # Step 3: Setup vocabulary
    first_token = list(agent_tokens.values())[0]
    setup_vocabulary(first_token)

    # Step 4: Send welcome messages to each agent
    log_step("DISPATCH", "Sending prompts to agents...")

    for agent_name, agent_token in agent_tokens.items():
        prompt = f"""You are {agent_name}, joining a multi-agent coordination room for an adversary detection task.

TASK: Work with the other 9 agents to identify which agent is adversarial.

IMPORTANT: At least one (possibly more) of the other agents may be adversarial and will try to mislead you.

YOUR STRATEGY:
1. First, read the current context to see who else is here
2. Submit a truthful statement about yourself and your strategy
3. Listen to what others say
4. Identify inconsistencies, false claims, or suspicious patterns
5. Submit accusations with evidence-based reasoning
6. Vote on who you believe is adversarial
7. Challenge claims you don't believe
8. Adapt your strategy based on new information

AVAILABLE ACTIONS:
- submit_statement: Share your thoughts
- submit_accusation: Accuse another agent (with reason)
- challenge: Challenge another agent's claim
- vote_agree: Vote on a consensus position

Collaborate to find the truth!"""

        response = make_request("POST", f"/rooms/{ROOM_ID}/actions/_send_message/invoke",
                              token=agent_token,
                              data={"params": {"body": prompt, "kind": "task"}})

        if response and response.status_code == 200:
            log_step("PROMPT", f"Sent task prompt to {agent_name}")
        else:
            log_step("ERROR", f"Failed to send prompt to {agent_name}")

    # Step 5: Monitor room for activity
    log_step("READY", "Experiment initialized. Ready for agent interaction.")
    log_step("INFO", f"Room: {ROOM_ID}")
    log_step("INFO", f"View token (shareable): {view_token}")

    print("\n" + "="*80)
    print("EXPERIMENT CONFIGURATION SUMMARY")
    print("="*80)
    print(f"Room ID: {ROOM_ID}")
    print(f"Room URL: {BASE_URL}/#!/room/{ROOM_ID}")
    print(f"View Token: {view_token}")
    print(f"Agents Registered: {len(agent_tokens)}")
    print(f"Actions Available: submit_statement, submit_accusation, challenge, vote_agree")
    print(f"Views Available: all_statements, all_accusations, all_votes, all_challenges")
    print("\nAgent Tokens:")
    for name, token in agent_tokens.items():
        print(f"  {name}: {token}")
    print("="*80 + "\n")

    # Start monitoring
    monitor_room(view_token)

    log_step("COMPLETE", "Experiment setup complete. Awaiting subagent spawning.")

if __name__ == "__main__":
    main()
