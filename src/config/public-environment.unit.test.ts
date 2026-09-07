import { describe, expect, it } from "vitest";

import { parsePublicEnvironment } from "./public-environment";

describe("parsePublicEnvironment", () => {
  it("uses safe defaults when local configuration is absent", () => {
    expect(parsePublicEnvironment({})).toEqual({
      environment: "local",
      debug: false,
      googleScopes: [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      ],
    });
  });

  it("parses public values and comma/space-separated scopes", () => {
    expect(
      parsePublicEnvironment({
        VITE_FOCUSDESK_ENV: "development",
        VITE_FOCUSDESK_DEBUG: "yes",
        VITE_FOCUSDESK_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
        VITE_FOCUSDESK_GOOGLE_SCOPES: "scope-one, scope-two scope-three",
        VITE_FOCUSDESK_API_BASE_URL: " https://api.example.test ",
      }),
    ).toEqual({
      environment: "development",
      debug: true,
      googleClientId: "client.apps.googleusercontent.com",
      googleScopes: ["scope-one", "scope-two", "scope-three"],
      apiBaseUrl: "https://api.example.test",
    });
  });

  it("does not expose non-VITE values", () => {
    expect(
      parsePublicEnvironment({
        GOOGLE_REFRESH_TOKEN: "should-not-be-used",
        FOCUSDESK_PRIVATE_API_TOKEN: "should-not-be-used",
      }),
    ).toEqual({
      environment: "local",
      debug: false,
      googleScopes: [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      ],
    });
  });
});
