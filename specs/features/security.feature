Feature: Security
  Protections that apply everywhere.

  @integration
  Scenario: Rate limits
    Then each IP gets at most 600 requests a minute across the API
    And sign-in is limited per IP (30 per 15 min) and per account (5 failures per 15 min)
    And registrations (5 an hour), OAuth client registrations (10 an hour), token requests (60 a minute) are limited per IP
    And each AI assistant token gets 120 MCP requests a minute
    And search is limited to 30 a minute per person
    And a refused request says when to try again, with a Retry-After header

  @integration
  Scenario: Cross-site requests can't ride on a session
    When a page on another site makes a signed-in request that changes something
    Then it's refused with "Cross-site request refused"

  @integration
  Scenario: Large requests are refused
    Then request bodies over 64 KB are refused with "That request is too large"

  @e2e
  Scenario: Pages can't be framed or sniffed
    Then every page is served with a Content-Security-Policy that forbids framing
    And X-Frame-Options DENY, X-Content-Type-Options nosniff and a strict Referrer-Policy

  @integration
  Scenario: Secrets are never stored in the clear
    Then sessions, API keys, OAuth tokens and codes are stored only as SHA-256 hashes
    And passwords only as salted argon2id hashes

  @manual
  Scenario: Internal services aren't exposed
    Then only the web port is published; Postgres listens on localhost only
    And mediamtx's API and RTSP port are reachable only inside the stack
