Feature: Adding songs
  Signed-in listeners add songs by searching for them by name, or by pasting
  a link. Each station limits how many songs one person can add in a window.

  Background:
    Given Sam is signed in on the Main Stage page

  @e2e
  Scenario: Searching for a song by name
    When Sam types "nina simone feeling good" in "Add a song"
    Then a dropdown lists matching songs with thumbnail, title, artist, length and views
    And the first addable song is highlighted

  @e2e
  Scenario: Adding a song from the search results
    When Sam picks a song from the dropdown, by click or with Enter
    Then the song is added instantly
    And Sam sees "“<title>” added" with its place in line, e.g. "It's 3rd in line."
    And the search box is cleared

  @e2e
  Scenario: Songs that can't be added say why
    Given a song is on air and another is queued
    When Sam searches for them
    Then they appear greyed out as "On air now" and "Already in line"
    And songs longer than the station limit appear as "Over 10 min"
    And keyboard selection skips them

  @e2e
  Scenario: The card says where songs can come from
    Then "Add a song" says you can search by artist or title on YouTube or SoundCloud
    And that links from YouTube, SoundCloud, Bandcamp, Mixcloud and more work too

  @e2e @unit
  Scenario: Searching SoundCloud instead of YouTube
    When Sam switches "Search on" to "SoundCloud" and searches
    Then the results come from SoundCloud and say so
    And the choice is remembered in this browser
    And a SoundCloud song picked from the results is added instantly, and recognised as the same song if its link is pasted later

  @unit @integration @e2e
  Scenario: SoundCloud samples are marked
    Given SoundCloud only lets us play a 30-second preview of "Get Lucky" (a Go+ song)
    Then it shows a bright "SAMPLE" pill in search results, now playing, the player bar, Up next, History and Songs
    And hovering it says only 30 seconds of the song can be played
    And AI assistants are told it's only a 30-second sample
    # Search results only carry the length (samples are exactly 30 s); a pasted link is checked
    # by its formats (SoundCloud offers only "…_preview" ones for samples).

  @unit @e2e
  Scenario: Search still answers when YouTube can't be reached
    Given YouTube is reached through a proxy (YOUTUBE_PROXY) that is down, or a YouTube search fails
    When Sam searches YouTube for "daft punk"
    Then Sam gets SoundCloud results, with "YouTube isn't reachable right now, so here are SoundCloud results"
    And while the proxy doesn't answer (checked in 2 seconds, every 30 at most), searches go straight to SoundCloud
    And after a failed YouTube search, YouTube rests a minute before being tried again
    And AI assistants' searches fall back the same way, and say so

  @e2e
  Scenario: The results open below the search box, not over it
    When results appear
    Then the list starts under the search box, which stays visible and editable

  @e2e
  Scenario: Pasting a link
    When Sam pastes a YouTube link into "Add a song"
    Then the dropdown offers "Add this link"

  @integration
  Scenario: Songs have a per-station limit per person
    Given Main Stage allows 3 songs per 10 minutes
    And Sam added 3 songs in the last 10 minutes
    When Sam tries to add another
    Then it's refused with "You've added your 3 songs for now. You can add another in ~N min."
    And the search box is replaced by "You can add another song in m:ss"
    But admins have no limit

  @integration
  Scenario: A removed song still counts toward the limit
    Given Sam added a song and removed it
    Then it still counts until it ages out of the window

  @integration
  Scenario: The same song can't be queued twice
    Given "Feeling Good" is already in line
    When anyone adds it again, by search, link or add-again
    Then they see "That song is already in line"

  @integration
  Scenario: Songs over the station's length limit are refused
    When Sam adds a 12 minute song to a station that takes up to 10
    Then Sam sees "That song is too long for this station (up to 10 min)"

  @integration
  Scenario: Only public music links are fetched
    When someone adds a link to a private or internal address (localhost, 10.x, 169.254.x, a LAN name)
    Then it's refused with "That link points to a private address"
    And links with a username or password are refused
    And pages from unsupported sites are refused with "That site isn't supported"

  @integration
  Scenario: Adding while a station is closed
    Given Main Stage is closed until 8:00
    When Sam adds a song
    Then it is queued and plays after the station opens
