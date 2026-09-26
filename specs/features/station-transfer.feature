Feature: Moving a station
  A station, with everything it remembers, fits in one file: export it here,
  import it there (say, from a test radio to the real one).

  @e2e @integration
  Scenario: Exporting a station
    Given Alex is an admin
    When Alex clicks Export on a station's settings page
    Then Alex downloads "<slug>-<date>.lastradio.json"
    And it holds the station's settings, who may listen (people and domains), its songs,
      every time a song was lined up with how it ended and who voted it down, and the upvotes
    And the people it mentions, by display name and email (former listeners without one)
    And only admins can export, from the website

  @e2e @integration
  Scenario: Importing a station
    Given Alex has a station file
    When Alex opens Admin, clicks Import and picks the file
    Then Alex sees the station's name, how many plays, songs, people and upvotes it holds
    And a free address is suggested (the file's own, or with -2 if it's taken), and a name
    When Alex clicks Import
    Then a new station exists with the same settings, queue, history, song records and top players
    And Alex lands on its settings page, with a summary of what was imported

  @integration
  Scenario: People are matched by email
    Given a station file mentions Sam and Robin
    And Sam has an account here with the same email, and Robin doesn't
    When the file is imported
    Then Sam's songs, votes, upvotes and memberships are Sam's here
    And Robin's keep Robin's name, on an account nobody can sign in to
    And former listeners stay former listeners

  @integration
  Scenario: What an import never does
    Then it never changes an existing station: an address already in use is refused
    And songs this radio already knows are reused, not duplicated or changed
    And a file that isn't a station export, or mentions songs or people it doesn't describe, is refused
    And a song that was on air when the file was made goes back to the front of the line
    And files up to 50 MB are accepted, only from admins on the website
