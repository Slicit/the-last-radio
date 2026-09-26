Feature: Long lists come in pages
  Every list that can grow (up next, history, songs, feedback, users) shows
  20 at a time by default, up to 100, so pages stay fast.

  @integration @e2e
  Scenario: Paging through a long queue
    Given 25 songs are lined up
    Then "Up next" shows songs 1–20, numbered in play order, with "1–20 of 25 songs"
    When Sam goes to the next page
    Then it shows songs 21–25, still numbered 21 to 25
    And the tab still says "Up next (25)"

  @integration
  Scenario: Choosing how many per page
    Then lists offer 20, 50 or 100 per page
    And asking the API for more than 100 is refused

  @integration
  Scenario: Pages everywhere lists grow
    Then History, Songs, the admin feedback inbox and the admin users list page the same way
    And "already in line" checks still see songs beyond the first page
