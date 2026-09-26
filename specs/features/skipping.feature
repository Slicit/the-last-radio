Feature: Skipping and downvotes
  Admins can skip instantly, whoever added a song can skip their own, and
  listeners can vote a song off.

  @integration
  Scenario: An admin skips the song on air
    When an admin clicks "Skip"
    Then the song stops within about a second and the next one starts
    And history shows it "skipped by an admin"

  @integration
  Scenario: Skipping your own song
    Given Sam added the song on air
    When Sam clicks "Skip my song"
    Then it's skipped and history shows "skipped by its adder"

  @integration
  Scenario: Players can't skip other people's songs
    When Sam tries to skip a song Kim added
    Then Sam is told "Only the person who added this song can skip it. Vote instead!"

  @integration @e2e
  Scenario: Only people listening can vote
    Given Sam is signed in but not listening to Main Stage
    Then "Vote to skip" is disabled with the hint "Tune in to vote"
    When Sam starts listening
    Then Sam can vote

  @integration
  Scenario: Enough votes skip the song
    Given Main Stage skips at 50% of listeners and 4 people are listening
    When 2 listeners vote to skip
    Then the song is skipped and history shows "voted off"

  @integration
  Scenario: A vote can be taken back, and counts once
    When Sam votes twice
    Then Sam's vote counts once
    When Sam takes the vote back
    Then it no longer counts

  @integration
  Scenario: Listeners leaving can tip the vote
    Given 1 of 2 needed votes is cast
    When enough listeners leave that 1 vote is now half of them
    Then the song is skipped without anyone voting again

  @integration
  Scenario: Votes are tied to the song they were cast on
    When a vote arrives for a song that already ended
    Then it's refused with "That song already ended" and doesn't count for the next song

  @integration
  Scenario: Voting can be turned off per station
    Given a station's vote threshold is 0%
    Then votes are refused with "Skip votes are off on this station"

  @e2e
  Scenario: Between two songs, the next one is announced instead of dead air
    Given a song was just skipped and the next one is lined up
    Then the page shows "Up next" with that song and "Coming up in a moment…", not "Dead air"
    And the player bar says "Changing songs…"
    And the page checks every second until the next song is on air
