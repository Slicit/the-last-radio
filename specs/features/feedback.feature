Feature: Feedback
  Listeners tell the people running the radio what they think; admins triage.

  @e2e @integration
  Scenario: Sending feedback
    Given Sam is signed in
    When Sam opens "Send feedback" from the profile menu, picks "Idea" and writes a message
    Then Sam sees "Thanks! Your feedback was sent."
    And the message appears under "What you've sent" as "Not read yet"

  @integration
  Scenario: Three messages a day
    Given Sam sent 3 messages in the last 24 hours
    Then the form says "You've sent 3 today, thank you!" and is disabled
    And the API refuses a 4th with when the next one frees up

  @integration
  Scenario: Messages have to say something
    Then messages under 10 characters or over 2000 are refused

  @e2e @integration
  Scenario: Admins triage feedback
    Given there is unread feedback
    Then the Admin page shows it first with an "N unread" badge
    When Alex votes it up, marks it read and archives it
    Then its score is 1, it moves to "Archived", and the unread count drops
    And Sam sees it as "Archived"

  @integration
  Scenario: Feedback is private
    Then players see only their own feedback
    And only admins, from the website, can open the inbox
