Feature: Connect your AI
  Listeners connect an AI assistant (MCP) or a script (API key) to their
  account, and it acts as them within their usual limits.

  @e2e @integration
  Scenario: Creating an API key
    Given Sam is on "Connect your AI"
    When Sam creates a key named "Laptop" with "Listen & add songs"
    Then the full key is shown once, with a copy button
    And afterwards only its first characters are shown, with when it was last used

  @integration
  Scenario: What a key can do
    Then a "Read only" key can list stations, see what's playing, the queue, song stats and search
    And a "Listen & add songs" key can also add songs, downvote and skip its owner's songs
    And no key can manage keys, stations, users or anything admin, even an admin's key

  @integration
  Scenario: Revoking a key
    When Sam revokes a key
    Then requests with it are refused at once

  @integration
  Scenario: Connecting an assistant with OAuth
    Given an assistant registers itself (dynamic client registration)
    And sends Sam to the consent page
    When Sam clicks "Allow"
    Then the assistant gets a code, exchanges it with its PKCE verifier, and receives a 1-hour access token and a refresh token
    And the app appears under "Connected apps"

  @e2e
  Scenario: The consent page
    Then it names the app, the account it will act as, and what it will be able to do
    And it says where Sam will be sent back to
    And "Deny" sends Sam back with access_denied

  @integration
  Scenario: OAuth is strict
    Then only S256 PKCE is accepted and a wrong verifier fails
    And a code works once, within 10 minutes, for the redirect it was issued to
    And redirects must be https, or http to the user's own machine (any port)
    And refresh tokens rotate; replaying a spent one revokes the whole connection
    And "Disconnect" revokes every token the app holds

  @integration
  Scenario: The assistant's tools
    Then an assistant can list_stations, now_playing, get_queue, song_stats and search_songs
    And with "Listen & add songs" it can also add_song (by link, song id or name), upvote, downvote, undo_downvote and skip_my_song
    And stations can be named by slug or name; an unknown one lists the real ones

  @integration
  Scenario: Asking an assistant to add a song that's already there
    Given "Sexy Boy" is on air
    When the assistant is asked to add "air sexy boy"
    Then it's told "“AIR - Sexy Boy …” is on air now" instead of queueing another upload of it

  @integration
  Scenario: Assistants can't use browser sessions
    Then /mcp only accepts bearer tokens
    And without one it answers 401 with a pointer to the OAuth metadata

  @integration @e2e
  Scenario: Exploring the API without MCP
    Then /api/openapi.json describes every REST endpoint (OpenAPI 3.1), with auth, scopes, paging and errors
    And request bodies come from the same validators the API uses
    And a test fails if a route is added without being documented
    And the "Developers" page shows it for people, and pages point to it (rel="service-desc")
