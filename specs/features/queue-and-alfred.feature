Feature: Queue order and Alfred, the fill-in DJ
  Songs people add play first, in the order they were added. When the lineup
  runs low, Alfred tops it up with songs the station liked before.

  @integration
  Scenario: People's songs play before Alfred's
    Given Alfred queued two songs
    When Sam adds a song
    Then Sam's song is ahead of both of Alfred's
    And the broadcaster plays in that same order

  @integration
  Scenario: Re-adding one of Alfred's picks makes it yours
    Given Alfred queued "Around the World"
    When Sam adds "Around the World"
    Then it becomes Sam's song, placed with the people's songs
    And Alfred's copy is removed

  @integration
  Scenario: Alfred fills the queue below the threshold
    Given Main Stage tops up below 15 minutes and has played songs before
    When less than 15 minutes is lined up (the rest of the song on air plus the queue)
    Then Alfred adds songs until at least 15 minutes is lined up, at most 5 at a time

  @integration
  Scenario: Alfred favours crowd favourites
    Then Alfred draws songs at random weighted by their score
    And a song's score is: plays by people + half the plays by Alfred + 2 × people who added it − downvotes − 3 × forced skips

  @integration
  Scenario: Alfred leaves some songs alone
    Then Alfred never picks a song whose last airing was voted off or skipped by an admin
    And never a song with a score of zero or less
    And never a song that aired in the last 30 minutes or is already lined up
    And never a song that failed to download in the last hour
    And never a song longer than the station allows
    And never a second upload of a song already lined up (same title, ignoring "(Official Audio)" and the like)

  @integration
  Scenario: Alfred avoids repeats without going silent
    Given a station only knows a handful of songs, all played in the last hour
    When the lineup runs low
    Then Alfred still fills it from those songs
    And songs that haven't played for a while are more likely: a song played 3+ hours ago has full weight, one played just now about a tenth
    # Regression 2026-09-26: a hard 3-hour rule left Main Stage's ~20 songs all excluded, and Alfred added nothing.

  @manual
  Scenario: Alfred explains when he can't help
    When Alfred wants to fill a station but finds nothing to pick
    Then the broadcaster logs why, at most every 10 minutes

  @integration
  Scenario: Alfred rests outside broadcast hours and when turned off
    Given a station is closed, or its fill-in threshold is 0
    Then Alfred adds nothing

  @e2e
  Scenario: Alfred's picks are labelled
    Then Alfred's songs show "Alfred" as who added them
    And the queue shows "Alfred's picks keep the music going. Songs people add always play first." above them
