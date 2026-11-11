// The optional passkey account in a real Chrome, through its virtual WebAuthn
// authenticator: creating an account, the session cookie, adding and
// withdrawing a submission, an account's agent key, signing out and in,
// passkeys, deleting the account, and that receipts work throughout.
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { messages } from "../../src/web/i18n/index.ts";
import { checks, seenContext } from "./checks.mjs";

const AUTHENTICATOR = {
  protocol: "ctap2",
  transport: "internal",
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
};

export async function accountSuite({ browser, base: BASE, dir: DIR, screens: SCREENS }) {
  const { check, report } = checks();
  const en = messages("en");
  const a = en.account;
  const secret = () => "gds1_" + Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64url");

  async function submitByApi(file) {
    const s = secret();
    const response = await fetch(`${BASE}/api/submissions`, { method: "POST", headers: { authorization: `Receipt ${s}` }, body: readFileSync(`${DIR}/${file}`) });
    if (response.status !== 201) throw new Error(`setup upload ${file}: ${response.status}`);
    return s;
  }
  const statusOf = async (receipt) => (await (await fetch(`${BASE}/api/submission`, { headers: { authorization: `Receipt ${receipt}` } })).json()).submission?.status;
  const mySubmissions = async (key) => {
    const response = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_my_submissions", arguments: { key } } }),
    });
    const body = await response.json();
    return body.result?.isError ? null : JSON.parse(body.result.content[0].text).submissions;
  };

  try {
    const first = await submitByApi("b.csv");
    const second = await submitByApi("b.csv");

    const context = await seenContext(browser, { locale: "en-US", viewport: { width: 1024, height: 800 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId: phone } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTHENTICATOR });
    const message = () => page.locator("[data-testid=account-message]").first().textContent({ timeout: 10000 });
    const waitForMessage = (text) =>
      page
        .locator("[data-testid=account-message]", { hasText: text })
        .first()
        .waitFor({ timeout: 10000 })
        .then(() => true, () => false);
    const sessionCookie = async () => (await context.cookies(BASE)).find((cookie) => cookie.name === "__Host-gds_session");

    // Signed out: the default, and the page says what an account would keep.
    await page.goto(`${BASE}/#account`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: a.storedHeading }).waitFor();
    check("signed out is the default, with no cookie", (await sessionCookie()) === undefined);
    check("the tab marks the account page", (await page.getByRole("navigation").getByRole("button", { name: en.app.account }).getAttribute("aria-current")) === "page");
    check("the page says an account is optional", (await page.getByText(a.optional, { exact: true }).count()) === 1);

    // Creating an account with a passkey.
    await page.getByRole("button", { name: a.create }).click();
    check("a passkey creates an account and signs in", await waitForMessage(a.done.register), await message().catch(() => ""));
    await page.getByRole("heading", { name: a.yours }).waitFor();
    const cookie = await sessionCookie();
    check(
      "the session cookie is HttpOnly, Secure and SameSite=Strict",
      cookie && cookie.httpOnly && cookie.secure && cookie.sameSite === "Strict" && cookie.path === "/" && !cookie.domain.startsWith("."),
      JSON.stringify(cookie),
    );
    check("the page's scripts can't read it", !(await page.evaluate(() => document.cookie)).includes("gds_session"));
    const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId: phone });
    check("the passkey is discoverable", credentials.length === 1 && credentials[0].isResidentCredential, JSON.stringify(credentials.map((c) => c.isResidentCredential)));

    // Requests from another site are refused, even with the cookie.
    const forged = await fetch(`${BASE}/api/account/delete`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json", cookie: `${cookie.name}=${cookie.value}` },
      body: "{}",
    });
    check("another site can't act with the session", forged.status === 403, String(forged.status));

    // Adding a submission with its receipt, on the account page.
    await page.getByRole("textbox", { name: a.addField }).fill(first);
    await page.getByRole("button", { name: a.add, exact: true }).click();
    check("a receipt adds its submission", await waitForMessage(a.done.claim));
    check("the account lists it", (await page.locator("[data-testid=account-submissions] .rows li").count()) === 1);
    check("the field is cleared", (await page.getByRole("textbox", { name: a.addField }).inputValue()) === "");

    // An account's agent key reads the account's submissions, including ones added later.
    await page.getByRole("button", { name: a.createKey }).click();
    const key = (await page.locator("[data-testid=account-key-value]").textContent({ timeout: 10000 })) ?? "";
    check("a new key is shown once", /^gdsr_[A-Za-z0-9_-]{43}$/.test(key), key);
    check("the key reads the account's submission", (await mySubmissions(key))?.length === 1);

    // Adding from the lookup on the Submit page.
    await page.getByRole("navigation").getByRole("button", { name: en.app.submit }).click();
    await page.getByRole("textbox", { name: en.a11y.receiptField, exact: true }).fill(second);
    await page.getByRole("button", { name: en.status.check, exact: true }).click();
    await page.locator("[data-testid=status]").waitFor();
    await page.getByRole("button", { name: a.offerSignedIn }).click();
    const added = await page
      .locator("[data-testid=keep-in-account]")
      .getByText(a.inAccount)
      .waitFor({ timeout: 10000 })
      .then(() => true, () => false);
    check("a looked-up submission can be added from the Submit page", added);
    check("the key reads a submission added after it was made", (await mySubmissions(key))?.length === 2);

    // Withdrawing from the account, after a second press.
    await page.getByRole("link", { name: a.open }).click();
    await page.getByRole("heading", { name: a.yours }).waitFor();
    await page.locator("[data-testid=account-submissions] .rows li").first().getByRole("button", { name: a.withdraw }).click();
    check("withdrawing asks first, focusing the safe choice", await page.getByRole("button", { name: a.keep }).evaluate((b) => b === document.activeElement));
    await page.getByRole("button", { name: a.confirm, exact: true }).click();
    check("the account withdraws a submission", await waitForMessage(a.done.withdraw));
    check("its receipt sees it withdrawn", (await statusOf(first)) === "withdrawn" && (await statusOf(second)) === "completed");

    // The signed-in page at phone width.
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("the signed-in page fits a phone", overflow <= 0, `${overflow}px`);
    await page.screenshot({ path: `${SCREENS}/account-signed-in.png`, fullPage: true });
    await page.setViewportSize({ width: 1024, height: 800 });

    // Signing out, then in again with the same passkey.
    await page.getByRole("button", { name: a.signOut }).click();
    check("signing out ends the session", (await waitForMessage(a.done.signOut)) && (await sessionCookie()) === undefined);
    await page.getByRole("button", { name: a.signIn }).click();
    check("the passkey signs in again", await waitForMessage(a.done.signIn), await message().catch(() => ""));
    check("the account is as it was", (await page.locator("[data-testid=account-submissions] .rows li").count()) === 2);

    // Passkeys: the same authenticator can't be added twice; another one can.
    await page.getByRole("button", { name: a.addPasskey }).click();
    check("the same authenticator isn't added twice", await waitForMessage(en.issues["api.passkeyExists"]), await message().catch(() => ""));
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: phone });
    const { authenticatorId: laptop } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTHENTICATOR });
    await page.getByRole("button", { name: a.addPasskey }).click();
    check("another device's passkey is added", await waitForMessage(a.done.addPasskey), await message().catch(() => ""));
    check("both passkeys are listed", (await page.locator("[data-testid=account-passkeys] .rows li").count()) === 2);
    await page.locator("[data-testid=account-passkeys] .rows li").first().getByRole("button", { name: a.remove }).click();
    await page.getByRole("button", { name: a.confirm, exact: true }).click();
    check("a passkey is removed", await waitForMessage(a.done.removePasskey));
    check("the last passkey can't be removed", (await page.locator("[data-testid=account-passkeys]").getByRole("button", { name: a.remove }).count()) === 0);

    // Deleting the account: the submissions stay, and their receipts still work.
    await page.getByRole("button", { name: a.delete }).click();
    await page.getByRole("button", { name: a.confirm, exact: true }).click();
    check("the account is deleted and signed out", (await waitForMessage(a.done.delete)) && (await sessionCookie()) === undefined);
    check("its submissions stay, and their receipts still work", (await statusOf(first)) !== undefined && (await statusOf(second)) !== undefined);
    check("its agent key no longer reads anything", (await mySubmissions(key)) === null);
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: laptop });

    check("no page errors", errors.length === 0, errors.join("; "));
    await context.close();
  } catch (error) {
    check("account check ran to the end", false, String(error).slice(0, 400));
  }
  return report("account");
}
