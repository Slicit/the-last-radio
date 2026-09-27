Feature: Privacy
  The radio tells people what it keeps, keeps as little as it can, and lets
  them take their data away. French law applies (GDPR, loi Informatique et Libertés).

  @e2e
  Scenario: Reading the privacy notice
    When anyone opens "Privacy & cookies" from the footer
    Then they see, in French or English, who is responsible, what's kept and why and for how long,
      what's never collected, every cookie and storage key, who sees what, their rights and the CNIL
    And the date it was last updated

  @e2e @integration
  Scenario: Acknowledging the notice when signing up
    When Sam signs up
    Then Sam must tick "I've read the privacy & cookies notice"
    And the version Sam acknowledged is recorded

  @e2e @integration
  Scenario: Acknowledging a new or changed notice when signing in
    Given the notice changed since Sam last acknowledged it
    When Sam signs in
    Then Sam sees "Before you continue" with a link to the notice (not a blocking cookie modal)
    And continues after "I've read it, continue"
    And people already signed in see a small "Our privacy & cookies notice was updated" banner instead

  @integration
  Scenario: No consent banner
    Then the only cookie is the strictly necessary sign-in cookie, and local-storage keys hold preferences
    And there are no trackers, ads or third-party cookies, so no consent banner is needed

  @e2e @integration
  Scenario: Downloading my data
    When Sam clicks "Download my data" in "Edit profile"
    Then Sam gets a JSON file with the account, songs added, downvotes, feedback and API access
    And no password, session or key material is in it

  @e2e @integration
  Scenario: Deleting my account
    When Sam clicks "Delete my account" and confirms with the password
    Then Sam's email, password, photo, sessions, keys and feedback are erased
    And everything Sam did on the stations stays, credited to "Former listener": the songs added
      (even those still in line), plays, skip votes and upvotes, so history, song records,
      Alfred's scores and top players don't change
    And Sam can't sign in any more
    But the only admin can't delete their account until someone else is admin

  @unit
  Scenario: The privacy notice stays true
    When the database schema changes
    Then a test fails until the notice has been reviewed and the data inventory fingerprint updated
    And the notice's version is the same on the page and on the server

  @manual
  Scenario: Logs don't grow forever
    Then each service's logs rotate at 10 MB, keeping 3 files
