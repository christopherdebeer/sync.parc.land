#!/bin/bash

# Multi-Agent Adversary Detection Experiment
# Creates empty room and spawns 10 agents to collaborate while identifying adversaries

set -e

BASE_URL="http://sync.parc.land"
ROOM_ID="adversary-$(date +%s)"

echo "=== Creating room: $ROOM_ID ==="
ROOM_RESPONSE=$(curl -s -X POST "$BASE_URL/rooms" \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$ROOM_ID\"}")

echo "Room response: $ROOM_RESPONSE"

ROOM_TOKEN=$(echo "$ROOM_RESPONSE" | jq -r '.token')
VIEW_TOKEN=$(echo "$ROOM_RESPONSE" | jq -r '.view_token')

echo "Room ID: $ROOM_ID"
echo "Room token: $ROOM_TOKEN"
echo "View token: $VIEW_TOKEN"

# Create agents
AGENTS=("alice" "bob" "charlie" "diana" "eve" "frank" "grace" "henry" "iris" "jack")

echo ""
echo "=== Registering 10 agents ==="

for agent_name in "${AGENTS[@]}"; do
  echo "Registering $agent_name..."
  AGENT_RESPONSE=$(curl -s -X POST "$BASE_URL/rooms/$ROOM_ID/agents" \
    -H "Content-Type: application/json" \
    -d "{\"id\": \"$agent_name\", \"name\": \"$(echo $agent_name | sed 's/\b./\U&/g')\", \"role\": \"agent\"}")

  AGENT_TOKEN=$(echo "$AGENT_RESPONSE" | jq -r '.token')
  echo "  $agent_name token: $AGENT_TOKEN"
  echo "$agent_name:$AGENT_TOKEN" >> /tmp/agents_$ROOM_ID.txt
done

echo ""
echo "=== Setting up shared vocabulary ==="

# Get agent token for first agent to bootstrap vocabulary
FIRST_AGENT=$(echo "${AGENTS[0]}")
FIRST_TOKEN=$(grep "^$FIRST_AGENT:" /tmp/agents_$ROOM_ID.txt | cut -d: -f2)

# Register actions for agents to use
echo "Registering submit_statement action..."
curl -s -X POST "$BASE_URL/rooms/$ROOM_ID/actions/_register_action/invoke" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRST_TOKEN" \
  -d '{
    "params": {
      "id": "submit_statement",
      "description": "Submit a public statement to the room",
      "params": {"statement": {"type": "string"}},
      "writes": [{"scope": "_shared", "key": "${self}.statement", "value": "${params.statement}"}]
    }
  }' > /dev/null

echo "Registering submit_accusation action..."
curl -s -X POST "$BASE_URL/rooms/$ROOM_ID/actions/_register_action/invoke" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRST_TOKEN" \
  -d '{
    "params": {
      "id": "submit_accusation",
      "description": "Submit an accusation that another agent is the adversary",
      "params": {"target": {"type": "string"}, "reason": {"type": "string"}},
      "writes": [
        {"scope": "_shared", "key": "${self}.accusation_target", "value": "${params.target}"},
        {"scope": "_shared", "key": "${self}.accusation_reason", "value": "${params.reason}"}
      ]
    }
  }' > /dev/null

echo "Registering vote_agree action..."
curl -s -X POST "$BASE_URL/rooms/$ROOM_ID/actions/_register_action/invoke" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRST_TOKEN" \
  -d '{
    "params": {
      "id": "vote_agree",
      "description": "Vote to agree with a consensus position",
      "params": {"target": {"type": "string"}},
      "writes": [{"scope": "_shared", "key": "${self}.vote", "value": "${params.target}"}]
    }
  }' > /dev/null

echo "Registering challenge action..."
curl -s -X POST "$BASE_URL/rooms/$ROOM_ID/actions/_register_action/invoke" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRST_TOKEN" \
  -d '{
    "params": {
      "id": "challenge",
      "description": "Challenge another agents claim with evidence or logic",
      "params": {"target": {"type": "string"}, "challenge": {"type": "string"}},
      "writes": [{"scope": "_shared", "key": "${self}.challenge_${now}", "value": "{\"target\": \"${params.target}\", \"challenge\": \"${params.challenge}\"}"}]
    }
  }' > /dev/null

# Register views
echo "Registering statements view..."
curl -s -X POST "$BASE_URL/rooms/$ROOM_ID/actions/_register_view/invoke" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRST_TOKEN" \
  -d '{
    "params": {
      "id": "all_statements",
      "expr": "state[\"_shared\"].filter((k,v), k.endsWith(\".statement\"))"
    }
  }' > /dev/null

echo "Registering accusations view..."
curl -s -X POST "$BASE_URL/rooms/$ROOM_ID/actions/_register_view/invoke" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRST_TOKEN" \
  -d '{
    "params": {
      "id": "all_accusations",
      "expr": "state[\"_shared\"].filter((k,v), k.endsWith(\".accusation_target\") || k.endsWith(\".accusation_reason\"))"
    }
  }' > /dev/null

echo ""
echo "=== Configuration complete ==="
echo "Room: $ROOM_ID"
echo "Room token: $ROOM_TOKEN"
echo "View token: $VIEW_TOKEN"
echo "Agent tokens saved to: /tmp/agents_$ROOM_ID.txt"
echo ""
echo "Ready to spawn subagents with prompts!"
