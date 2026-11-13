---
mode: testing
---

# Login helper

Reusable sign-in for the cart and checkout flows. This file is not an
entry point: `kane-cli testmd run` only accepts `*_test.md`. The importing
test supplies `email` and `password` (`test@example.com` / `password123`).

## Open the login page
Open the login page at the start URL. If that page is not already the login form, go to /login.
Verify the email or username field and the password field are visible.

## Submit valid credentials
Enter {{email}} in the email or username field and {{password}} in the password field, then submit the login form.
Verify the user lands on the dashboard or the signed-in home and is clearly signed in.
