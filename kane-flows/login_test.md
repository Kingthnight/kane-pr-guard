---
mode: testing
max_steps: 30
url: http://localhost:3000
tags: [smoke, auth, login]
variables:
  email:
    value: "test@example.com"
  password:
    value: "password123"
    secret: true
  wrong_password:
    value: "wrong-password-xyz"
    secret: true
---

# Login: invalid password is rejected, valid user reaches the dashboard

Two cases in one file. Wrong password runs first so the browser is still on
the login page for the successful sign-in. Builder must seed a user with
email `test@example.com` and password `password123`.

Override the start URL in CI with:
`kane-cli testmd run login_test.md --url "$BASE_URL" --override-start-url "$BASE_URL" --agent --headless`

## Case A — wrong password shows an error
Open the login page at the start URL (or `/login` if needed). Verify the email and password fields are visible.
Enter {{email}} in the email or username field and {{wrong_password}} in the password field, then submit the login form.
Verify the user is not signed in and does not land on the dashboard.
Verify a visible error message is shown that indicates the password or credentials are incorrect.

## Case B — valid user signs in and lands on the dashboard
On the same login page, clear the password field if needed, enter {{email}} in the email or username field and {{password}} in the password field, then submit the login form.
Verify the user lands on the dashboard (or the app's signed-in home screen) and is clearly signed in (for example a dashboard heading, account menu, or welcome state is visible).
