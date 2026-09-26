Feature: Song records
  Every station keeps a record of each song it played: plays, people who
  added it, downvotes and skips. People browse it; Alfred uses it.

  @integration
  Scenario: A song's record
    Then each song shows plays, how many people added it, downvotes, skips and when it last played
    And plays count only airings that reached the end
    And every skip vote counts as a downvote, even if the song wasn't skipped

  @e2e
  Scenario: Browsing a station's songs
    When Sam opens the "Songs" tab
    Then songs can be sorted by "Most played", "Crowd favourites", "Most downvoted" and "Recently played"
    And songs Alfred won't replay say why: "Voted off", "Admin skipped it" or "Too many downvotes"

  @e2e @integration
  Scenario: Adding a song again
    Given "Derezzed" played earlier
    When Sam clicks "Add again" on it in Songs or History
    Then it's added instantly, under the usual limit and duplicate rules
    And songs on air, in line or too long show "On air", "In line" or "Too long" instead of the button

  @integration
  Scenario: Top players count people only
    Then "Top players" ranks people by songs of theirs that aired
    And Alfred never appears in it
