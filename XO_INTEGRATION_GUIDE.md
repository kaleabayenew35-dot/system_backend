# XO — Token Backend Integration Guide

This guide describes the XO integration endpoints for the Telegram Games backend.

Your server must expose the following endpoints:

- `POST {your_backend_url}/api/xo/player-balance`
- `POST {your_backend_url}/api/xo/game-action`
- `POST {your_backend_url}/api/xo/verify`
- `POST {your_backend_url}/xo`

## Authentication

For API endpoints under `/api/xo`, XO accepts the game token via:

- Header: `X-API-Token: GT-...`
- Header: `Authorization: Bearer GT-...`
- Request body: `{ "token": "GT-..." }`
- Query string: `?token=GT-...`

For the direct callback endpoint `/xo`, the token must be provided in the request body as:

```json
{ "token": "GT-..." }
```

The token is validated against the active `game_tokens` entry and its related game must also be active.

## POST /api/xo/player-balance

Returns the player's live balance.

Request body:

```json
{
  "phone": "0911234567",
  "username": "Abebe"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "balance": 1500
  }
}
```

If the configured game token has an owner `backend_url`, requests are proxied to `{backend_url}/xo` and fallback to the local database if the owner backend is unavailable.

## POST /api/xo/game-action

Handles in-game balance actions, including `deduct`, `credit`, `loss`, and `refund`.

Request body:

```json
{
  "action": "deduct",
  "phone": "0911234567",
  "username": "Abebe",
  "playerId": "player123",
  "amount": 100,
  "fee": 0,
  "gameId": "game_xyz"
}
```

Valid actions:

- `deduct`
- `credit`
- `loss`
- `refund`

Successful response:

```json
{
  "ok": true,
  "data": {
    "balance": 1400
  }
}
```

## POST /api/xo/verify

Verifies a player and returns their profile and balance.

Request body:

```json
{
  "username": "Abebe"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "game": {
      "id": 1,
      "name": "XO"
    },
    "player": {
      "id": 10,
      "username": "Abebe",
      "phone": "0911234567",
      "balance": 1500,
      "coins": 100
    }
  }
}
```

## POST /xo

This endpoint is the direct XO callback endpoint, equivalent to the Dama `/dama` webhook.

Request body:

```json
{
  "token": "GT-...",
  "action": "get_balance",
  "phone": "0911234567",
  "username": "Abebe"
}
```

Supported actions:

- `ping`
- `get_balance`
- `deduct`
- `credit`
- `loss`
- `refund`
- `owner_fee`

Response for `ping`:

```json
{
  "ok": true,
  "message": "pong"
}
```

Response for `get_balance`:

```json
{
  "ok": true,
  "balance": 1500
}
```

## Notes

- `phone` or `username` is required for all player-specific calls.
- Responses should use `2xx` for success and include `ok: true` on successful XO callback responses.
- `owner_fee` is recorded to admin balance transactions and does not change player balance.
