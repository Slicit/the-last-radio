Feature: Broadcast hours
  A station can be limited to days and hours, in its own timezone.

  @unit
  Scenario Outline: Whether a station is open
    Given a station open <days> from <start> to <end> in Europe/Paris
    When it is <local time> in Paris
    Then the station is <state>

    Examples:
      | days    | start | end   | local time    | state                          |
      | Mon–Fri | 08:00 | 18:00 | Monday 07:59  | closed, opens today at 8:00    |
      | Mon–Fri | 08:00 | 18:00 | Monday 08:00  | open until 18:00               |
      | Mon–Fri | 08:00 | 18:00 | Monday 18:00  | closed, opens tomorrow at 8:00 |
      | Mon–Fri | 08:00 | 18:00 | Friday 19:00  | closed, opens Monday at 8:00   |
      | Fri     | 22:00 | 02:00 | Saturday 1:30 | open until 02:00               |
      | Fri     | 22:00 | 02:00 | Saturday 2:00 | closed, opens Friday at 22:00  |
      | every   | 00:00 | 00:00 | any time      | open all day                   |

  @manual
  Scenario: The song on air at closing time plays to its end
    Given a song is on air when the station closes
    Then it plays to the end, the page says "Last song of the day"
    And no new song starts; the stream then goes off air

  @e2e
  Scenario: A closed station says when it opens
    Given Night Shift is closed
    Then its page shows "Closed · opens tomorrow at 22:00" and keeps its queue
    And "Add a song" says songs added now play when it opens
    And the home card and the player bar say it's closed

  @manual
  Scenario: Listeners who stay tuned in hear the opening
    Given a listener kept the player open overnight
    When the station opens
    Then the music starts on its own
