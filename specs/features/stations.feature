Feature: Stations
  An admin creates stations. Each active station is one shared live stream
  with its own playlist, rules and history.

  @e2e
  Scenario: An admin creates a station
    Given Alex is an admin on the Admin page
    When Alex clicks "New station", names it "Night Shift" and sets 5 songs per person
    Then Alex lands on "Night Shift"'s own editor page, ready for people, domains and hours
    And "Night Shift" is listed in Admin with address "night-shift"
    And the station starts streaming within seconds, playing silence until someone adds a song

  @e2e
  Scenario: Unsaved station changes aren't lost by accident
    Given Alex is editing a station
    Then its settings are grouped in sections: General, Song rules, Who can listen, Broadcast hours, Alfred
    And an "Unsaved changes" bar with Discard and Save appears only once something changed
    And leaving the page (or closing the tab) with unsaved changes asks first

  @e2e
  Scenario: Listeners see every active station on the home page
    Given the stations "Main Stage" and "Night Shift" are active
    When someone opens the home page
    Then both stations are shown with what's playing, listeners and queue length

  @integration
  Scenario: A disabled station disappears for listeners
    Given "Night Shift" is disabled
    Then players don't see it in the list and can't open it
    But admins still see it, marked disabled

  @integration
  Scenario: Only admins manage stations, and only from the website
    Then players can't create or edit stations
    And API keys and AI assistants can't either, even an admin's
