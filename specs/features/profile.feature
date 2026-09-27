Feature: Profile and appearance
  People choose how the radio looks and how others see them.

  @e2e @integration
  Scenario: Choosing a theme
    Given Sam is signed in
    When Sam picks a theme under Theme in the profile menu
    Then the radio switches to it at once:
      | Night   | dark, the default                                                    |
      | Light   | after Pennylane: teal ink, mint surfaces, green accents, Manrope      |
      | Vintage | an old wooden radio: sepia paper, walnut, an amber dial glow, Fraunces |
    And it stays that way on Sam's other devices

  @e2e @integration
  Scenario: The radio's default theme
    Given Alex is an admin
    When Alex picks a theme under "Default theme" in Admin
    Then signed-out visitors see the radio in it
    And new accounts start with it
    But people who already have an account keep the theme they have

  @manual
  Scenario: No flash of the wrong theme
    Given Sam chose Light
    When Sam reloads any page
    Then it never flashes the dark theme first

  @e2e @integration
  Scenario: Setting a profile photo
    When Sam opens "Edit profile" and uploads a photo
    Then it appears, cropped square, in the header and the profile dialog
    And "Remove" takes it away again

  @integration
  Scenario: Profile photos are handled safely
    Then only JPEG, PNG, WebP and GIF files are accepted, judged by their content, not their name or declared type
    And files over 5 MB are refused
    And every photo is re-encoded to a 256×256 WebP; the original is never stored
    And camera metadata (EXIF, GPS) is stripped
    And oversized images (decompression bombs) are refused
    And photos are served with nosniff and a sandboxing Content-Security-Policy
    And someone can change their photo at most 10 times an hour

  @integration
  Scenario: Changing your display name
    When Sam renames themselves "Sammy" in "Edit profile"
    Then songs Sam added show "added by Sammy"
    And names must be 2 to 40 characters
