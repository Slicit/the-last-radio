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
    Given "Team Room" allows the domain "acme.test"
    When Vera signs up as vera@acme.test and clicks the link in the confirmation email
    Then "Team Room" appears for Vera
    But until she confirms, it doesn't: anyone could type an address they don't own

  @integration @e2e
  Scenario: Managing who may listen from the station editor
    Given Alex edits the private station "Team Room"
    When Alex types a domain (with or without the @) under "Email domains" and clicks Add or presses Enter
    Then "@acme.test added" shows, and the domain is listed with everyone at that domain who has an account
    And people not confirmed yet are marked so, with "Mark confirmed" for when email isn't set up
    And the rest of the station form is neither saved nor lost
    When Alex removes the domain, its people lose access (unless added by name)
    # Regression 2026-09-26: the domain's Add button was a form inside the editor's form and saved the station instead.

  @integration
  Scenario: Confirming an email
    Then signing up sends a confirmation link, valid once for 24 hours
    And the email comes as HTML (the radio's logo and a "Confirm my email" button) and as plain text,
      ending with why it was sent, what to do if it wasn't you, the privacy notice and who runs the radio
    And "Send confirmation email" in the profile sends a new one
    And no address gets more than 3 emails (sign-up included): the next is refused with
      "We've sent several emails to this address already. Try again in 30 min.", and it unlocks 30 minutes after the last
    And a link stops working if the account's email changed since
    And without email set up (SMTP_URL), admins can "Mark verified" by hand, and the station editor says so

  @e2e
  Scenario: A banner reminds people to confirm their email
    Given Vera is signed in and hasn't confirmed her email, and the radio can send email
    Then a banner under the header says to confirm it, and why (private stations open to her domain)
    When Vera clicks "Send confirmation email"
    Then it says the link was sent to her address, and to check the spam folder
    And it can be hidden until the next page load; it's gone once the address is confirmed

  @integration
  Scenario: Admins see every station
    Then admins see and manage private stations whether or not they're members
