Feature: Accounts
  People sign up with an email and a password. The very first account on a
  fresh install becomes the admin; everyone after that is a player.

  @e2e @integration
  Scenario: The first account becomes the admin
    Given nobody has an account yet
    When Alex registers with a display name, an email and a password
    Then Alex is signed in
    And Alex is an admin

  @integration
  Scenario: Later accounts are players
    Given an admin already exists
    When Sam registers
    Then Sam is a player

  @e2e
  Scenario: Signing in and out
    Given Sam has an account
    When Sam signs in with the right email and password
    Then the header shows Sam's name
    When Sam signs out from the profile menu
    Then the header offers "Sign in" and "Join"

  @integration
  Scenario: A wrong password gives the same answer as an unknown email
    When someone signs in with a wrong password
    Or someone signs in with an email nobody registered
    Then both see "Wrong email or password"
    And both take about as long, so timing doesn't reveal who has an account

  @integration
  Scenario: Too many wrong passwords lock the account for a while
    Given Sam has an account
    When someone enters a wrong password for Sam 5 times
    Then the 6th attempt is refused with "Too many wrong passwords for this account"
    And even the right password is refused for 15 minutes
    And a successful sign-in resets the count

  @integration
  Scenario: Registrations are rate limited per network
    When 5 accounts have been created from the same IP within an hour
    Then the next registration from that IP is refused

  @unit @integration
  Scenario: Passwords are stored salted and hashed
    When anyone registers
    Then only an argon2id hash of the password is stored
    And every hash has its own random salt
    And the password must be 8 to 200 characters

  @integration
  Scenario: Registering an email twice
    Given sam@example.com is registered
    When someone registers sam@example.com again
    Then they see "That email is already registered"

  @e2e
  Scenario: Signing in from a page returns you to it
    Given Sam is signed out on the Main Stage page
    When Sam clicks "Sign in" in "Add a song" and signs in
    Then Sam is back on the Main Stage page
