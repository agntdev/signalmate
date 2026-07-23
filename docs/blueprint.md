# Trading Signal Bot — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that delivers private trading signals (buy/sell suggestions) to invited users via direct messages. Signals are sent live as they arrive and as a daily digest. Access is invite-only and free for subscribers.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- individual traders
- private subscribers

## Success criteria

- Subscribers receive live trading signals in DMs
- Daily digest is delivered to all active subscribers
- Invite link system works with single-use and reusable links
- User commands for settings/history/unsubscribe function correctly

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **Invite Link** (command, actor: user, command: /invite:<token>) — User clicks invite link to join the service
- **/start** (command, actor: user, command: /start) — Open main menu for existing subscribers
- **/help** (command, actor: user, command: /help) — Show command list and usage help
- **/unsubscribe** (command, actor: user, command: /unsubscribe) — Cancel subscription and delete account
- **/links** (command, actor: user, command: /links) — Show invite status and link history
- **/settings** (command, actor: user, command: /settings) — Configure digest timing and notification preferences
- **/history** (command, actor: user, command: /history) — View recent trading signals

## Flows

### Onboarding
_Trigger:_ invite:<token>

1. User clicks invite link
2. Bot verifies link validity
3. User is added to subscriber list
4. Welcome DM is sent with usage help and disclaimer

_Data touched:_ User, Invite Link

### Live Signal Delivery
_Trigger:_ new_signal

1. Signal is created by admin
2. Bot sends DM to all active subscribers
3. DM includes signal details and quick actions

_Data touched:_ Signal

### Digest Delivery
_Trigger:_ daily_digest

1. Check digest schedule
2. Compile day's signals
3. Send digest DM to all active subscribers

_Data touched:_ Signal, Digest

### User Settings
_Trigger:_ /settings

1. Show current settings
2. User selects digest timing
3. Preferences are saved

_Data touched:_ User

### Signal History
_Trigger:_ /history

1. Show recent signals
2. User can view specific signal details

_Data touched:_ Signal

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: persistent)_ — Telegram account with subscription status and preferences
  - fields: telegram_id, invite_status, digest_schedule, notification_mute
- **Invite Link** _(retention: persistent)_ — Metadata for invite links (single-use or reusable)
  - fields: token, created_by, is_single_use, activation_status
- **Signal** _(retention: persistent)_ — Trading signal details including asset, action, price, and confidence
  - fields: timestamp, asset, action, price, confidence, notes, source
- **Digest** _(retention: persistent)_ — Collection of signals for a specific time window
  - fields: window_start, window_end, signals

## Integrations

- **Telegram** (required) — Bot API messaging for private DMs and notifications
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Create and manage invite links
- Create and schedule trading signals
- View subscriber statistics
- Configure digest schedule defaults

## Notifications

- Live signal notifications to subscribers
- Daily digest notifications
- Invite link activation notifications

## Permissions & privacy

- Only invited users can receive signals
- User data is stored securely
- No financial data is collected or processed
- Users can unsubscribe at any time

## Edge cases

- Failed message delivery retry
- Invalid or expired invite links
- User timezone detection failure
- Signal creation during maintenance window

## Required tests

- Verify invite link onboarding flow
- Test live signal delivery to multiple users
- Validate digest compilation and delivery
- Test user settings persistence
- Confirm unsubscribe functionality

## Assumptions

- Invite links are single-use by default
- Digest is sent at 18:00 local time by default
- Signal format includes minimum required fields
- Telegram profile timezone is used when available
