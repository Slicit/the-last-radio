Feature: Listener stats
  Admins see how many people listen, over time, for the whole radio and for
  each station.

  @integration
  Scenario: Listeners are counted every 5 minutes
    Given people are listening to "Main Stage" and "Night Shift"
    Then every 5 minutes (on :00, :05, …) the number listening to each station on air is saved
    And stations with nobody listening are saved as 0, so quiet hours show on the chart
    And only the numbers are kept, never who was listening
    And the counts are kept for good

  @integration @e2e
  Scenario: Admins see listeners over time
    When Alex opens Admin
    Then a "Listeners" chart shows everyone listening across all stations, and one chart per station
    And Alex can show the last 24 hours, 7 days, 30 days or 3 months (7 days by default)
    And each chart shows the average and the peak per period, with the busiest moment
    And only admins, on the website, can see them
