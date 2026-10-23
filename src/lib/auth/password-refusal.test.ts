import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GENERIC_PASSWORD_MESSAGE,
  LEAKED_PASSWORD_MESSAGE,
  isPasswordRefusal,
  passwordRefusalMessage,
} from "./password-refusal";

// Plain words for a refused password (Adam, 23 Oct 2026). The messages below
// are Supabase's own, as its Auth server writes them.

const LENGTH = "Password should be at least 10 characters.";
const LOWER_UPPER_DIGITS =
  "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.";
const ALL_FOUR =
  "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~.";
const LETTERS_DIGITS =
  "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.";
const PWNED = "Password is known to be weak and easy to guess, please choose a different one.";

const weak = (reasons: string[], message: string) => ({ code: "weak_password", reasons, message });

describe("which errors are about the password", () => {
  test("weak and same-as-before passwords are", () => {
    assert.ok(isPasswordRefusal({ code: "weak_password" }));
    assert.ok(isPasswordRefusal({ code: "same_password" }));
  });
  test("rate limits, sessions and no error at all are not", () => {
    assert.ok(!isPasswordRefusal({ code: "over_email_send_rate_limit" }));
    assert.ok(!isPasswordRefusal({ code: "session_not_found" }));
    assert.ok(!isPasswordRefusal({ message: "fetch failed" }));
    assert.ok(!isPasswordRefusal(null));
  });
});

describe("the message under the password box", () => {
  test("a leaked password", () => {
    assert.equal(passwordRefusalMessage(weak(["pwned"], PWNED)), LEAKED_PASSWORD_MESSAGE);
    assert.equal(
      LEAKED_PASSWORD_MESSAGE,
      "This password appears on public lists of passwords leaked from other websites over the years. Please choose a different one.",
    );
  });

  test("too short, with the length Supabase is set to", () => {
    assert.equal(passwordRefusalMessage(weak(["length"], LENGTH)), "Your password needs at least 10 characters.");
  });

  test("missing character types, as Supabase is set", () => {
    assert.equal(
      passwordRefusalMessage(weak(["characters"], LOWER_UPPER_DIGITS)),
      "Please include a lowercase letter, a capital letter and a number.",
    );
    assert.equal(
      passwordRefusalMessage(weak(["characters"], ALL_FOUR)),
      "Please include a lowercase letter, a capital letter, a number and a symbol.",
    );
    assert.equal(passwordRefusalMessage(weak(["characters"], LETTERS_DIGITS)), "Please include a letter and a number.");
  });

  test("more than one reason gives each, shortest fix first", () => {
    assert.equal(
      passwordRefusalMessage(weak(["length", "characters", "pwned"], `${LENGTH} ${LOWER_UPPER_DIGITS} ${PWNED}`)),
      `Your password needs at least 10 characters. Please include a lowercase letter, a capital letter and a number. ${LEAKED_PASSWORD_MESSAGE}`,
    );
  });

  test("anything else is the general message, never Supabase's words", () => {
    assert.equal(passwordRefusalMessage(weak([], "Password is weird.")), GENERIC_PASSWORD_MESSAGE);
    assert.equal(passwordRefusalMessage(weak(["something-new"], "Password is weird.")), GENERIC_PASSWORD_MESSAGE);
    assert.equal(passwordRefusalMessage(weak(["length"], "Password is too short.")), GENERIC_PASSWORD_MESSAGE);
    assert.equal(
      passwordRefusalMessage({ code: "same_password", message: "New password should be different from the old password." }),
      GENERIC_PASSWORD_MESSAGE,
    );
    assert.equal(GENERIC_PASSWORD_MESSAGE, "That password can't be used. Please try a different one.");
  });
});

// Every place a password is set uses these, and puts the result under the box.
describe("where it is used", () => {
  const actions = readFileSync(new URL("../actions/auth.ts", import.meta.url), "utf8");

  test("sign-up and set or change password both turn a refusal into plain words", () => {
    const signUp = actions.slice(actions.indexOf("supabase.auth.signUp("), actions.indexOf("// The rate limit deserves"));
    assert.match(signUp, /isPasswordRefusal\(signUpError\)/);
    assert.match(signUp, /passwordError: passwordRefusalMessage\(signUpError\)/);
    const update = actions.slice(actions.indexOf("supabase.auth.updateUser({ password })"));
    assert.match(update, /isPasswordRefusal\(error\)/);
    assert.match(update, /passwordError: passwordRefusalMessage\(error\)/);
  });

  test("a refused sign-up hands back what was typed, but never the password", () => {
    const keep = actions.slice(actions.indexOf("function signupValues"), actions.indexOf("export async function login"));
    assert.doesNotMatch(keep, /password/i);
    assert.match(actions, /return \{ \.\.\.result, values: signupValues\(formData\) \};/);
  });

  test("both forms show it under the password box", () => {
    for (const file of ["../../components/signup/SignupForm.tsx", "../../components/account/ChangePasswordForm.tsx"]) {
      const form = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.match(form, /state\.passwordError && \(|state\.passwordError \?/);
      assert.match(form, /id="password-error"/);
    }
  });
});
