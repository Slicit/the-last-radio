Feature: Private stations
  A station can be private: only the people an admin adds, and people whose
  confirmed email is on an allowed domain, can see it, hear it and add songs.

  @integration @e2e
  Scenario: A private station is invisible to everyone else
    Given "Team Room" is private
    Then it isn't listed for anyone else, and its page, queue, history and songs answer "No station"
    And its audio stream is refused
    And API keys, OAuth apps and AI assistants follow the same rule, since they act as their user

  @integration
  Scenario: Adding someone by email
    Given Alex is an admin editing "Team Room"
    When Alex adds sam@example.com under "People"
    Then Sam sees "Team Room" with a lock, can listen and add songs
    And adding an email nobody registered says "Nobody has an account with that email yet"

  @integration @e2e
  Scenario: Letting a whole email domain in
    Given "Team Room" allows the domain "slic.it"
    When Vera signs up as vera@slic.it and clicks the link in the confirmation email
    Then "Team Room" appears for Vera
    But until she confirms, it doesn't: anyone could type an address they don't own

  @integration
  Scenario: Confirming an email
    Then signing up sends a confirmation link, valid once for 24 hours
    And "Send confirmation email" in the profile sends a new one (3 an hour at most)
    And a link stops working if the account's email changed since
    And without email set up (SMTP_URL), admins can "Mark verified" by hand, and the station editor says so

  @integration
  Scenario: Admins see every station
    Then admins see and manage private stations whether or not they're members
