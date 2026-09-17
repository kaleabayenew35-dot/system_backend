# Dama — Token Backend Integration Guide

Your server must expose one endpoint:

```http
POST {your_backend_url}/dama
Content-Type: application/json
```

Dama calls this endpoint for game events. The request body always contains an `action` field. Your server should respond with `{ "ok": true }` or an action-specific payload.

## Supported actions

### `get_balance`
Request:
```json
{
  "action": "get_balance",
  "phone": "0911234567",
  "username": "Abebe"
}
```

Response:
```json
{
  "ok": true,
  "balance": 1500,
  "username": "Abebe"
}
```

### `deduct`
Deduct the requested `amount` from the player's balance.

### `credit`
Credit the requested `amount` to the player's balance.

### `loss`
Informational callback for a lost game. No balance change is required.

### `refund`
Refund the requested `amount` to the player.

### `owner_fee`
Record the house commission or payout for the token owner.

Example:
```json
{
  "action": "owner_fee",
  "amount": 20,
  "type": "pvp_win_fee",
  "gameId": "game_xyz"
}
```

### `ping`
Connectivity check.

```json
{ "action": "ping" }
```

Response:
```json
{ "ok": true }
```

## Notes
- Responses should be `2xx` for success.
- The callback is fire-and-forget; failures should not block gameplay.
- Phone numbers are normalized before sending.
