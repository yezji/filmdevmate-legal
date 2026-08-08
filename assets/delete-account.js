/*
 * Self-serve account deletion for FilmDevMate, required by Google Play's User Data policy:
 * an app that lets users create an account must offer a deletion path on the web too, not
 * only inside the app.
 *
 * The user signs in against the production Supabase project the app itself uses, then this
 * calls the very same `delete_own_account` RPC the in-app "회원 탈퇴" screen calls
 * (SupabaseUserApi.deleteOwnAccount / Repositories.swift). That RPC is `security definer`
 * and deletes `auth.users` for `auth.uid()`, so every public-schema row cascades with it —
 * meaning this page and the app can never drift into deleting different things.
 *
 * No Supabase JS SDK: GoTrue and PostgREST are plain HTTP, and a CDN-free page keeps the
 * static host (GitHub Pages) as the only thing that has to stay up. The anon key below is
 * the same public key shipped inside the app binaries — it grants nothing on its own; the
 * user's own JWT is what authorizes the delete.
 *
 * Localized copy comes from window.DA_STRINGS, set inline by each language's page.
 */
(function () {
  "use strict";

  var SUPABASE_URL = "https://ujjylfyqfhsgdrornllj.supabase.co";
  var SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqanlsZnlxZmhzZ2Ryb3JubGxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjgwNzEsImV4cCI6MjEwMDE0NDA3MX0.n-f_1krB5GQJoUrwV0RpTeBtVKGj8wGy2mypMCT6-go";

  var S = window.DA_STRINGS || {};

  // Kept in a closure only — never localStorage/sessionStorage, so closing the tab ends the
  // session and a shared computer can't leave a usable token behind.
  var accessToken = null;

  function $(id) {
    return document.getElementById(id);
  }

  function show(step) {
    ["step-signin", "step-confirm", "step-done"].forEach(function (id) {
      $(id).hidden = id !== step;
    });
  }

  function setError(message) {
    var box = $("da-error");
    box.textContent = message || "";
    box.hidden = !message;
  }

  function setBusy(busy) {
    Array.prototype.forEach.call(
      document.querySelectorAll("button, input"),
      function (el) {
        el.disabled = busy;
      }
    );
    if (!busy) syncConfirmButton();
  }

  /** The page's own URL with hash and query stripped — what GoTrue redirects back to. */
  function selfUrl() {
    return location.origin + location.pathname;
  }

  function api(path, options) {
    options = options || {};
    var headers = { apikey: SUPABASE_ANON_KEY };
    if (accessToken) headers.Authorization = "Bearer " + accessToken;
    if (options.body) headers["Content-Type"] = "application/json";
    return fetch(SUPABASE_URL + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body,
    });
  }

  // --- Sign-in -------------------------------------------------------------

  function signInWithProvider(provider) {
    location.href =
      SUPABASE_URL +
      "/auth/v1/authorize?provider=" +
      provider +
      "&redirect_to=" +
      encodeURIComponent(selfUrl());
  }

  function signInWithPassword(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    api("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({
        email: $("da-email").value.trim(),
        password: $("da-password").value,
      }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error_description || body.msg || S.errorSignIn);
          return body;
        });
      })
      .then(function (body) {
        accessToken = body.access_token;
        return enterConfirmStep();
      })
      .catch(function (err) {
        setError(err.message || S.errorSignIn);
      })
      .then(function () {
        setBusy(false);
      });
  }

  /**
   * GoTrue's `/authorize` redirect hands the session back in the URL fragment
   * (`#access_token=…`). Read it, then wipe it from the address bar so the token isn't
   * sitting in history or in anything the user might copy-paste.
   */
  function consumeRedirectFragment() {
    var hash = location.hash.replace(/^#/, "");
    if (!hash) return false;
    var params = new URLSearchParams(hash);
    var token = params.get("access_token");
    var error = params.get("error_description") || params.get("error");
    history.replaceState(null, "", selfUrl());
    if (error) {
      setError(error);
      return false;
    }
    if (!token) return false;
    accessToken = token;
    return true;
  }

  // --- Confirm -------------------------------------------------------------

  function enterConfirmStep() {
    return api("/auth/v1/user")
      .then(function (res) {
        if (!res.ok) throw new Error(S.errorSession);
        return res.json();
      })
      .then(function (user) {
        $("da-account").textContent = user.email || user.id;
        $("da-confirm-input").value = "";
        $("da-confirm-check").checked = false;
        syncConfirmButton();
        show("step-confirm");
      });
  }

  function syncConfirmButton() {
    var typed = $("da-confirm-input").value.trim().toUpperCase();
    $("da-delete-button").disabled = !(
      $("da-confirm-check").checked && typed === String(S.confirmWord).toUpperCase()
    );
  }

  function deleteAccount() {
    setError(null);
    setBusy(true);
    api("/rest/v1/rpc/delete_own_account", { method: "POST", body: "{}" })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) {
            throw new Error(text || S.errorDelete);
          });
        }
        accessToken = null;
        show("step-done");
      })
      .catch(function (err) {
        setError(err.message || S.errorDelete);
      })
      .then(function () {
        setBusy(false);
      });
  }

  // --- Wiring --------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", function () {
    $("da-google").addEventListener("click", function () {
      signInWithProvider("google");
    });
    $("da-apple").addEventListener("click", function () {
      signInWithProvider("apple");
    });
    $("da-password-form").addEventListener("submit", signInWithPassword);
    $("da-confirm-input").addEventListener("input", syncConfirmButton);
    $("da-confirm-check").addEventListener("change", syncConfirmButton);
    $("da-delete-button").addEventListener("click", deleteAccount);
    $("da-cancel-button").addEventListener("click", function () {
      accessToken = null;
      setError(null);
      show("step-signin");
    });

    if (consumeRedirectFragment()) {
      setBusy(true);
      enterConfirmStep()
        .catch(function (err) {
          setError(err.message || S.errorSession);
          show("step-signin");
        })
        .then(function () {
          setBusy(false);
        });
    }
  });
})();
