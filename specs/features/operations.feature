Feature: Operations

  @manual
  Scenario: Deploys don't cut songs
    Given a song is on air
    When the broadcaster is restarted (docker compose up)
    Then it stops starting new songs, lets the one on air finish, and only then exits
    And the new broadcaster picks up the queue where it was
    # Verified 2026-09-26: the restart waited 210 s for "ERA - Ameno" to end.

  @manual
  Scenario: A crash mid-song
    When the broadcaster dies while a song is on air
    Then on restart that song is marked "cut off" and the queue continues

  @manual
  Scenario: Tracks are fetched ahead of time
    Then the next two songs are downloaded while the current one plays
    And the audio cache stays under 2 GB, evicting the least recently played first

  @manual
  Scenario: Deploys never take the whole radio down
    When a new version is rolled out with scripts/deploy.sh
    Then the API and web restart in seconds, one at a time
    And the broadcaster drains while the stream server stays up, so the song on air really finishes
    And postgres and mediamtx restart only with --all
    # Regression 2026-09-26: a bare `docker compose up -d` stopped every service and waited on the drain,
    # which couldn't finish without mediamtx: the site was down for ~20 minutes.

  @manual
  Scenario: A drain gives up when nobody can hear the song
    Given the broadcaster is draining
    When the stream server has been unreachable for 5 seconds
    Then it stops waiting and exits
