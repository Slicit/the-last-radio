Feature: Song health check
  Songs disappear from YouTube and SoundCloud. Once a week each song is
  re-checked; songs that are gone are marked, never deleted.

  @integration
  Scenario: Songs are re-checked about once a week
    Given the broadcaster checks a small batch of songs every hour
    Then each song a station knows is checked when it was never checked, or not for 7 days
    And songs already known to be gone aren't checked again

  @unit @integration
  Scenario: A song that's gone is marked unavailable
    When yt-dlp says a song is unavailable, private, removed or not found
    Then the song is marked "No longer available" with the reason
    But it stays in History and Songs, with its record

  @integration
  Scenario: A hiccup never marks a song
    When the check fails for another reason (network, rate limit, timeout)
    Then the song is left as it is and checked again the next day

  @integration
  Scenario: A download that fails at airtime also marks the song
    When the broadcaster can't fetch a queued song and the error means it's gone
    Then the song is marked unavailable straight away

  @integration
  Scenario: Unavailable songs stay out of the way
    Then Alfred never picks them
    And adding one by "Add again" explains "“<title>” is no longer available. Search for it by name to find another copy."

  @e2e
  Scenario: Finding another copy
    Given "Vanished Hit" is no longer available
    When Sam clicks "Find it" next to it
    Then the "Add a song" box searches for "Vanished Hit"

  @manual
  Scenario: A song that comes back
    When someone adds a working link to a song that was marked unavailable
    Then the mark is cleared
