import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_SITE_URL, authRedirectFor } from "../src/supabase.js";

test("Android localhost confirmation opens the website, not the WebView origin", () => {
  assert.equal(authRedirectFor("https://localhost/"), PUBLIC_SITE_URL);
  assert.equal(authRedirectFor("https://localhost/index.html?code=1#access_token=secret"), PUBLIC_SITE_URL);
  assert.equal(PUBLIC_SITE_URL, "https://abdibochubbz.github.io/adhd-flow/");
});

test("local preview confirmation also uses the website", () => {
  assert.equal(authRedirectFor("http://127.0.0.1:47321/"), PUBLIC_SITE_URL);
  assert.equal(authRedirectFor("http://[::1]:47321/still"), PUBLIC_SITE_URL);
});

test("the published site keeps its own address and drops the token hash", () => {
  assert.equal(
    authRedirectFor("https://abdibochubbz.github.io/adhd-flow/index.html#access_token=secret"),
    "https://abdibochubbz.github.io/adhd-flow/index.html",
  );
});
