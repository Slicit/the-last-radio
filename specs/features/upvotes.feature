Feature: Upvotes
  Listeners ask to hear a song more. Alfred listens.

  @e2e @integration
  Scenario: Upvoting a song
    Given Sam is signed in on a station
    When Sam clicks the thumbs-up on the song on air, or on a song in History or Songs
    Then the song shows one more upvote and the button stays pressed
    And Sam sees "Upvoted: Alfred will play it more" with the upvotes left today
    And clicking it again takes the upvote back

  @e2e @integration
  Scenario: Three upvotes a day
    Given Sam upvoted 3 songs in the last 24 hours, on any stations
    Then the other thumbs-up buttons are disabled with "No upvotes left today"
    And the API refuses a 4th with when more are available
    But taking one back gives it back

  @integration
  Scenario: Upvoted songs come back more often
    Then each upvote adds 2 to a song's score, like someone adding it
    And Alfred's weighted draw picks upvoted songs more often
    And song records show the number of upvotes

  @integration
  Scenario: What can be upvoted
    Then only songs a station has played or lined up can be upvoted there, once per person
    And private stations only for people who can see them
    And AI assistants can upvote the song on air or a song from song_stats
