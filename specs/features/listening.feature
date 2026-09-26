Feature: Listening
  Everyone hears the same stream at the same moment. Listening needs no account.

  @e2e
  Scenario: Tuning in from a station page
    Given Main Stage is playing a song
    When a visitor clicks "Listen live"
    Then the player bar appears at the bottom with the station and song
    And audio plays

  @manual
  Scenario: The player keeps playing while browsing
    Given a visitor is listening to Main Stage
    When they open the home page, the Admin page or another station's page
    Then the music keeps playing without a gap
    # Check in a browser: navigate around while listening.

  @e2e
  Scenario: Listening over plain HTTP on a local network
    Given the radio is served over http on a LAN address
    When a visitor starts listening
    Then the page keeps working and the listener is counted
    # Regression: crypto.randomUUID is missing outside secure contexts and used to blank the page.

  @integration
  Scenario: Listener counts come from the players themselves
    Given a player sends a heartbeat every 20 seconds while playing
    Then the station counts each listening browser once
    And a browser stops counting 45 seconds after its last heartbeat

  @integration
  Scenario: One network can't inflate the listener count
    When one IP address claims more than 5 listeners on a station
    Then the extra ones are not counted

  @manual
  Scenario: The stream never drops between songs
    Given a station is on air
    When a song ends and the next starts, or the queue runs empty
    Then listeners stay connected; gaps are filled with silence
    # The broadcaster feeds one continuous encoder; check an HLS player stays connected across songs.

  @manual
  Scenario: Songs are loudness-normalised
    Then every song airs at about -14 LUFS with peaks below -1.5 dBTP
