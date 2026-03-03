#!/usr/bin/env python3
"""Quick setup for honest collaboration experiment"""
import requests
import time
import json

BASE_URL = "https://sync.parc.land"
ROOM_ID = f"honest-{int(time.time())}"

requests.packages.urllib3.disable_warnings()

def make_request(method, endpoint, token=None, data=None, retries=3):
    for attempt in range(retries):
        try:
            url = f"{BASE_URL}{endpoint}"
            headers = {}
            if token:
                headers["Authorization"] = f"Bearer {token}"
            if data:
                headers["Content-Type"] = "application/json"

            if method == "POST":
                response = requests.post(url, headers=headers, json=data, verify=False, timeout=10)
            elif method == "GET":
                response = requests.get(url, headers=headers, verify=False, timeout=10)

            return response
        except requests.exceptions.Timeout:
            if attempt < retries - 1:
                time.sleep(1)
            continue
        except Exception as e:
            print(f"Request error: {e}")
            return None
    return None

# Create room
print(f"Creating room: {ROOM_ID}")
response = make_request("POST", "/rooms", data={"id": ROOM_ID})
if not response or response.status_code != 201:
    print(f"Failed to create room: {response.status_code if response else 'no response'}")
    exit(1)

data = response.json()
view_token = data.get("view_token")
room_token = data.get("token")

print(f"✓ Room created: {ROOM_ID}")
print(f"✓ View token: {view_token}")
print(f"\n{'='*80}")
print("DASHBOARD LINK:")
print(f"{'='*80}")
print(f"https://sync.parc.land/#!/room/{ROOM_ID}?token={view_token}")
print(f"{'='*80}\n")

# Register agents (simple, no vocab for now)
agents = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "henry", "iris", "jack"]
agent_tokens = {}

print("Registering agents...")
for agent_name in agents:
    response = make_request("POST", f"/rooms/{ROOM_ID}/agents", data={
        "id": agent_name,
        "name": agent_name.title(),
        "role": "agent"
    })

    if response and response.status_code == 201:
        token = response.json().get("token")
        agent_tokens[agent_name] = token
        print(f"  ✓ {agent_name}")
    else:
        print(f"  ✗ {agent_name} (failed)")

print(f"\nRegistered {len(agent_tokens)}/10 agents")
print("\nAgent tokens:")
for name, token in agent_tokens.items():
    print(f"  {name}: {token}")
